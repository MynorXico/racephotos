import * as cdk from 'aws-cdk-lib';
import { Template, Match } from 'aws-cdk-lib/assertions';
import { AuthStack } from '../stacks/auth-stack';
import { EnvConfig } from '../config/types';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const localConfig: EnvConfig = {
  envName: 'local',
  account: '000000000000',
  region: 'us-east-1',
  rekognitionConfidenceThreshold: 0.7,
  watermarkStyle: 'text_overlay',
  photoRetentionDays: 90,
  enableDeletionProtection: false,
    sqsMaxConcurrency: 3,
  domainName: 'none',
  certificateArn: 'none',
  sesConfigurationSetName: 'none',
};

const devConfig: EnvConfig = {
  envName: 'dev',
  account: '000000000000',
  region: 'us-east-1',
  rekognitionConfidenceThreshold: 0.7,
  watermarkStyle: 'text_overlay',
  photoRetentionDays: 90,
  enableDeletionProtection: false,
    sqsMaxConcurrency: 3,
  domainName: 'none',
  certificateArn: 'none',
  sesConfigurationSetName: 'none',
};

const prodConfig: EnvConfig = {
  ...devConfig,
  envName: 'prod',
  enableDeletionProtection: true,
    sqsMaxConcurrency: 50,
  domainName: 'app.example.com',
  certificateArn: 'arn:aws:acm:us-east-1:000000000000:certificate/test',
  sesConfigurationSetName: 'none',
};

const qaConfig: EnvConfig = {
  ...devConfig,
  envName: 'qa',
};

function makeStack(config: EnvConfig): AuthStack {
  const app = new cdk.App();
  // env must be specified so valueFromLookup (SSM) returns a dummy rather than throwing.
  return new AuthStack(app, 'TestAuthStack', {
    config,
    env: { account: config.account, region: config.region },
  });
}

function makeTemplate(config: EnvConfig): Template {
  return Template.fromStack(makeStack(config));
}

// ── CognitoConstruct ──────────────────────────────────────────────────────────

describe('CognitoConstruct', () => {
  test('creates User Pool named racephotos-photographers', () => {
    const t = makeTemplate(devConfig);
    t.hasResourceProperties('AWS::Cognito::UserPool', {
      UserPoolName: 'racephotos-photographers',
    });
  });

  test('User Pool uses email as sign-in alias', () => {
    const t = makeTemplate(devConfig);
    t.hasResourceProperties('AWS::Cognito::UserPool', {
      UsernameAttributes: ['email'],
    });
  });

  test('User Pool auto-verifies email', () => {
    const t = makeTemplate(devConfig);
    t.hasResourceProperties('AWS::Cognito::UserPool', {
      AutoVerifiedAttributes: ['email'],
    });
  });

  test('User Pool has self sign-up enabled', () => {
    const t = makeTemplate(devConfig);
    t.hasResourceProperties('AWS::Cognito::UserPool', {
      AdminCreateUserConfig: {
        AllowAdminCreateUserOnly: false,
      },
    });
  });

  test('User Pool has correct password policy', () => {
    const t = makeTemplate(devConfig);
    t.hasResourceProperties('AWS::Cognito::UserPool', {
      Policies: {
        PasswordPolicy: {
          MinimumLength: 8,
          RequireUppercase: true,
          RequireLowercase: true,
          RequireNumbers: true,
          RequireSymbols: true,
        },
      },
    });
  });

  test('User Pool has email as required standard attribute', () => {
    const t = makeTemplate(devConfig);
    t.hasResourceProperties('AWS::Cognito::UserPool', {
      Schema: Match.arrayWith([
        // CDK omits AttributeDataType for standard attributes (implied by name).
        Match.objectLike({
          Name: 'email',
          Required: true,
          Mutable: true,
        }),
      ]),
    });
  });

  test('creates User Pool Client named racephotos-photographers-client', () => {
    const t = makeTemplate(devConfig);
    t.hasResourceProperties('AWS::Cognito::UserPoolClient', {
      ClientName: 'racephotos-photographers-client',
    });
  });

  test('User Pool Client has no client secret', () => {
    const t = makeTemplate(devConfig);
    t.hasResourceProperties('AWS::Cognito::UserPoolClient', {
      GenerateSecret: false,
    });
  });

  test('User Pool Client allows USER_PASSWORD_AUTH, USER_SRP_AUTH, and REFRESH_TOKEN_AUTH for local env', () => {
    const t = makeTemplate(localConfig);
    // CDK emits flows in alphabetical order within ExplicitAuthFlows.
    t.hasResourceProperties('AWS::Cognito::UserPoolClient', {
      ExplicitAuthFlows: Match.arrayWith([
        'ALLOW_USER_PASSWORD_AUTH',
        'ALLOW_USER_SRP_AUTH',
        'ALLOW_REFRESH_TOKEN_AUTH',
      ]),
    });
  });

  test('User Pool Client allows USER_SRP_AUTH and REFRESH_TOKEN_AUTH for deployed env', () => {
    const t = makeTemplate(devConfig);
    t.hasResourceProperties('AWS::Cognito::UserPoolClient', {
      ExplicitAuthFlows: Match.arrayWith(['ALLOW_USER_SRP_AUTH', 'ALLOW_REFRESH_TOKEN_AUTH']),
    });
  });

  test('USER_PASSWORD_AUTH is enabled only for local environment', () => {
    const tLocal = makeTemplate(localConfig);
    tLocal.hasResourceProperties('AWS::Cognito::UserPoolClient', {
      ExplicitAuthFlows: Match.arrayWith(['ALLOW_USER_PASSWORD_AUTH']),
    });
  });

  test('USER_PASSWORD_AUTH is NOT enabled for dev environment', () => {
    const t = makeTemplate(devConfig);
    const clients = t.findResources('AWS::Cognito::UserPoolClient');
    const [resource] = Object.values(clients);
    const flows = (resource as Record<string, Record<string, string[]>>)['Properties'][
      'ExplicitAuthFlows'
    ];
    expect(flows).not.toContain('ALLOW_USER_PASSWORD_AUTH');
  });

  test('User Pool has EMAIL_ONLY account recovery', () => {
    const t = makeTemplate(devConfig);
    t.hasResourceProperties('AWS::Cognito::UserPool', {
      AccountRecoverySetting: {
        RecoveryMechanisms: [Match.objectLike({ Name: 'verified_email', Priority: 1 })],
      },
    });
  });

  test('User Pool Client prevents user existence errors', () => {
    const t = makeTemplate(devConfig);
    t.hasResourceProperties('AWS::Cognito::UserPoolClient', {
      PreventUserExistenceErrors: 'ENABLED',
    });
  });

  // TC-001: DeletionPolicy is Retain when enableDeletionProtection is true.
  // Misconfigured removal policy on a prod User Pool would silently destroy all
  // photographer accounts on the next cdk deploy --force stack replacement.
  test('User Pool has DeletionPolicy Retain when enableDeletionProtection is true', () => {
    const t = makeTemplate(prodConfig);
    t.hasResource('AWS::Cognito::UserPool', {
      DeletionPolicy: 'Retain',
      UpdateReplacePolicy: 'Retain',
    });
  });

  // TC-002: DeletionPolicy is Delete when enableDeletionProtection is false.
  test('User Pool has DeletionPolicy Delete when enableDeletionProtection is false', () => {
    const t = makeTemplate(devConfig);
    t.hasResource('AWS::Cognito::UserPool', {
      DeletionPolicy: 'Delete',
      UpdateReplacePolicy: 'Delete',
    });
  });

  // TC-015: cognito.region must be the stack region token, not a hardcoded string.
  // Amplify uses this to locate the User Pool endpoint.
  test('CognitoConstruct region equals the stack region', () => {
    const stack = makeStack(devConfig);
    expect(stack.cognito.region).toBe(cdk.Stack.of(stack).region);
  });

  // TC-014 (partial): AuthStack cognito outputs are non-empty strings (CDK tokens are truthy).
  test('AuthStack exports cognito outputs as non-empty strings', () => {
    const stack = makeStack(devConfig);
    expect(stack.cognito.userPoolId).toBeTruthy();
    expect(stack.cognito.userPoolArn).toBeTruthy();
    expect(stack.cognito.clientId).toBeTruthy();
    expect(stack.cognito.region).toBeTruthy();
  });
});

// ── ApiConstruct ──────────────────────────────────────────────────────────────

describe('ApiConstruct', () => {
  test('creates HTTP API named racephotos-api', () => {
    const t = makeTemplate(devConfig);
    t.hasResourceProperties('AWS::ApiGatewayV2::Api', {
      Name: 'racephotos-api',
      ProtocolType: 'HTTP',
    });
  });

  test('HTTP API has CORS configured', () => {
    const t = makeTemplate(devConfig);
    t.hasResourceProperties('AWS::ApiGatewayV2::Api', {
      CorsConfiguration: Match.objectLike({
        AllowHeaders: Match.arrayWith(['Content-Type', 'Authorization']),
        AllowMethods: Match.arrayWith(['*']),
      }),
    });
  });

  test('HTTP API CORS allows custom domain when domainName is set', () => {
    const t = makeTemplate(prodConfig);
    t.hasResourceProperties('AWS::ApiGatewayV2::Api', {
      CorsConfiguration: Match.objectLike({
        AllowOrigins: ['https://app.example.com'],
      }),
    });
  });

  test('HTTP API CORS allows wildcard when no custom domain', () => {
    const t = makeTemplate(devConfig);
    t.hasResourceProperties('AWS::ApiGatewayV2::Api', {
      CorsConfiguration: Match.objectLike({
        AllowOrigins: ['*'],
      }),
    });
  });

  test('stores API URL in SSM at correct path', () => {
    const t = makeTemplate(devConfig);
    t.hasResourceProperties('AWS::SSM::Parameter', {
      Name: '/racephotos/env/dev/api-url',
      Type: 'String',
    });
  });

  test('SSM parameter path uses envName from config', () => {
    const t = makeTemplate(prodConfig);
    t.hasResourceProperties('AWS::SSM::Parameter', {
      Name: '/racephotos/env/prod/api-url',
    });
  });

  test('HTTP API CORS falls back to wildcard when domainName is real but certificateArn is a CDK dummy', () => {
    // Simulates first pipeline synth where SSM cert lookup hasn't been populated yet.
    // hasCustomDomain must be false so CORS does not lock to a domain without a cert.
    const partialConfig: EnvConfig = {
      ...prodConfig,
      domainName: 'app.example.com',
      certificateArn: 'dummy-value-for-/racephotos/env/prod/certificate-arn',
    };
    const t = makeTemplate(partialConfig);
    t.hasResourceProperties('AWS::ApiGatewayV2::Api', {
      CorsConfiguration: Match.objectLike({
        AllowOrigins: ['*'],
      }),
    });
  });

  test('HTTP API has exactly one JWT authorizer resource', () => {
    // RS-004 fix: ApiConstruct now creates HttpAuthorizer explicitly (L2 construct)
    // rather than relying on HttpJwtAuthorizer binding lazily via addRoutes().
    // This ensures the AWS::ApiGatewayV2::Authorizer resource is always present
    // in AuthStack — regardless of which route stacks have been deployed.
    const t = makeTemplate(devConfig);
    t.resourceCountIs('AWS::ApiGatewayV2::Authorizer', 1);
    t.hasResourceProperties('AWS::ApiGatewayV2::Authorizer', {
      AuthorizerType: 'JWT',
      Name: 'CognitoJwtAuthorizer',
      IdentitySource: ['$request.header.Authorization'],
      JwtConfiguration: {
        Audience: [Match.anyValue()],
        Issuer: Match.anyValue(),
      },
    });
  });

  // TC-006: CORS AllowOrigins is exactly one element — the custom domain, no wildcard leak.
  test('HTTP API CORS AllowOrigins contains exactly one entry for custom domain', () => {
    const t = makeTemplate(prodConfig);
    const apis = t.findResources('AWS::ApiGatewayV2::Api');
    const [api] = Object.values(apis);
    const origins = (api as Record<string, Record<string, Record<string, string[]>>>)['Properties'][
      'CorsConfiguration'
    ]['AllowOrigins'];
    expect(origins).toEqual(['https://app.example.com']);
  });

  // TC-007: CORS AllowOrigins is exactly ['*'] for dev when SSM returns a dummy —
  // localhost is NOT added when wildcard is already present.
  test('HTTP API CORS AllowOrigins is exactly wildcard for no-custom-domain config', () => {
    const t = makeTemplate(devConfig);
    const apis = t.findResources('AWS::ApiGatewayV2::Api');
    const [api] = Object.values(apis);
    const origins = (api as Record<string, Record<string, Record<string, string[]>>>)['Properties'][
      'CorsConfiguration'
    ]['AllowOrigins'];
    expect(origins).toEqual(['*']);
  });

  // TC-007b: when SSM resolves to a real CloudFront domain, dev also includes localhost:4200.
  test('HTTP API CORS includes localhost:4200 for dev when CloudFront domain is known', () => {
    const app = new cdk.App({
      context: {
        [`ssm:account=${devConfig.account}:parameterName=/racephotos/env/dev/frontend-origin:region=${devConfig.region}`]:
          'd1234abcdefg.cloudfront.net',
      },
    });
    const stack = new AuthStack(app, 'TestAuthStack', {
      config: devConfig,
      env: { account: devConfig.account, region: devConfig.region },
    });
    const t = Template.fromStack(stack);
    const apis = t.findResources('AWS::ApiGatewayV2::Api');
    const [api] = Object.values(apis);
    const origins = (api as Record<string, Record<string, Record<string, string[]>>>)['Properties'][
      'CorsConfiguration'
    ]['AllowOrigins'];
    expect(origins).toEqual(['https://d1234abcdefg.cloudfront.net', 'http://localhost:4200']);
  });

  // TC-007c: prod never gets localhost even when CloudFront domain is known.
  test('HTTP API CORS does not include localhost for prod', () => {
    const t = makeTemplate(prodConfig);
    const apis = t.findResources('AWS::ApiGatewayV2::Api');
    const [api] = Object.values(apis);
    const origins = (api as Record<string, Record<string, Record<string, string[]>>>)['Properties'][
      'CorsConfiguration'
    ]['AllowOrigins'];
    expect(origins).not.toContain('http://localhost:4200');
  });

  // TC-011: SSM parameter Value is a CloudFormation intrinsic (Fn::GetAtt), not a literal string.
  // httpApi.apiEndpoint resolves to an intrinsic at synth time — if it were "undefined" or a
  // static placeholder, the pipeline would inject a broken apiBaseUrl into config.json.
  test('SSM api-url parameter Value is a CloudFormation intrinsic, not a literal string', () => {
    const t = makeTemplate(devConfig);
    const params = t.findResources('AWS::SSM::Parameter', {
      Properties: { Name: '/racephotos/env/dev/api-url' },
    });
    const [param] = Object.values(params);
    const value = (param as Record<string, Record<string, unknown>>)['Properties']['Value'];
    // CDK resolves httpApi.apiEndpoint to an object (Fn::Join or Fn::GetAtt), never a plain string.
    expect(typeof value).toBe('object');
    expect(value).not.toBeNull();
  });

  // TC-012: SSM parameter path interpolates envName correctly for non-prod environments.
  test('SSM parameter path uses envName for qa environment', () => {
    const t = makeTemplate(qaConfig);
    t.hasResourceProperties('AWS::SSM::Parameter', {
      Name: '/racephotos/env/qa/api-url',
    });
  });

  // TC-013: AuthStack has exactly 5 SSM parameters:
  //   api-url + api-id + api-authorizer-id (ApiConstruct)
  //   user-pool-id + client-id (CognitoConstruct)
  // FrontendConstruct reads three via valueFromLookup; PhotographerStack reads
  // api-id and api-authorizer-id via valueForStringParameter (no cross-stack
  // CDK token dependency — RS-004 cyclic-dependency fix).
  test('AuthStack creates exactly five SSM parameters', () => {
    const t = makeTemplate(devConfig);
    t.resourceCountIs('AWS::SSM::Parameter', 5);
  });

  test('CognitoConstruct stores user-pool-id in SSM at correct path', () => {
    const t = makeTemplate(devConfig);
    t.hasResourceProperties('AWS::SSM::Parameter', {
      Name: '/racephotos/env/dev/user-pool-id',
      Type: 'String',
    });
  });

  test('CognitoConstruct stores client-id in SSM at correct path', () => {
    const t = makeTemplate(devConfig);
    t.hasResourceProperties('AWS::SSM::Parameter', {
      Name: '/racephotos/env/dev/client-id',
      Type: 'String',
    });
  });

  test('CognitoConstruct SSM parameter paths use envName from config', () => {
    const t = makeTemplate(prodConfig);
    t.hasResourceProperties('AWS::SSM::Parameter', {
      Name: '/racephotos/env/prod/user-pool-id',
    });
    t.hasResourceProperties('AWS::SSM::Parameter', {
      Name: '/racephotos/env/prod/client-id',
    });
  });

  // TC-022: No routes at synth time — AC3 requires "no routes (routes added per Lambda story)".
  // An accidental catch-all route would be deployed without auth.
  test('HTTP API has zero routes at synth time', () => {
    const t = makeTemplate(devConfig);
    t.resourceCountIs('AWS::ApiGatewayV2::Route', 0);
  });

  // TC-014 (partial): api.apiUrl output is a non-empty string.
  test('AuthStack exports api.apiUrl as a non-empty string', () => {
    const stack = makeStack(devConfig);
    expect(stack.api.apiUrl).toBeTruthy();
  });
});
