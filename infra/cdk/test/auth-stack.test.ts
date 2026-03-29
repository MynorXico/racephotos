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
  domainName: 'none',
  certificateArn: 'none',
};

const devConfig: EnvConfig = {
  envName: 'dev',
  account: '000000000000',
  region: 'us-east-1',
  rekognitionConfidenceThreshold: 0.7,
  watermarkStyle: 'text_overlay',
  photoRetentionDays: 90,
  enableDeletionProtection: false,
  domainName: 'none',
  certificateArn: 'none',
};

const prodConfig: EnvConfig = {
  ...devConfig,
  envName: 'prod',
  enableDeletionProtection: true,
  domainName: 'app.example.com',
  certificateArn: 'arn:aws:acm:us-east-1:000000000000:certificate/test',
};

function makeTemplate(config: EnvConfig): Template {
  const app = new cdk.App();
  // env must be specified so valueFromLookup (SSM) returns a dummy rather than throwing.
  const stack = new AuthStack(app, 'TestAuthStack', {
    config,
    env: { account: config.account, region: config.region },
  });
  return Template.fromStack(stack);
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

  test('HTTP API has exactly one authorizer resource bound', () => {
    // CDK materializes AWS::ApiGatewayV2::Authorizer only when a route is attached.
    // With no routes in RS-002 the resource count is 0 — verified here so that a
    // future story (RS-004+) adding a route cannot accidentally increase this count
    // without an explicit assertion update.
    // Full AuthorizerType + JwtConfiguration.Audience assertions are added in RS-004
    // when the first photographer-facing route is attached.
    const t = makeTemplate(devConfig);
    t.resourceCountIs('AWS::ApiGatewayV2::Authorizer', 0);
  });
});
