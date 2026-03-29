import * as cdk from 'aws-cdk-lib';
import { Template, Match } from 'aws-cdk-lib/assertions';
import { AuthStack } from '../stacks/auth-stack';
import { EnvConfig } from '../config/types';

// ── Fixtures ──────────────────────────────────────────────────────────────────

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
  const stack = new AuthStack(app, 'TestAuthStack', { config });
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

  test('User Pool Client allows USER_PASSWORD_AUTH and REFRESH_TOKEN_AUTH', () => {
    const t = makeTemplate(devConfig);
    t.hasResourceProperties('AWS::Cognito::UserPoolClient', {
      ExplicitAuthFlows: Match.arrayWith(['ALLOW_USER_PASSWORD_AUTH', 'ALLOW_REFRESH_TOKEN_AUTH']),
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
});
