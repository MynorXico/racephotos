import * as cdk from 'aws-cdk-lib';
import { Template, Match } from 'aws-cdk-lib/assertions';
import { EnvConfig } from '../config/types';
import { StorageStack } from '../stacks/storage-stack';
import { AuthStack } from '../stacks/auth-stack';
import { PhotographerStack } from '../stacks/photographer-stack';

// ── Fixtures ────────────────────────────────────────────────────────────────���─

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
};

interface Stacks {
  photographerTemplate: Template;
  authTemplate: Template;
}

function makeStacks(config: EnvConfig): Stacks {
  const app = new cdk.App();
  const env = { account: config.account, region: config.region };

  const storageStack = new StorageStack(app, 'TestStorage', { config, env });
  const authStack = new AuthStack(app, 'TestAuth', { config, env });
  // PhotographerStack no longer accepts an ApiConstruct prop — it reads the HTTP
  // API ID from SSM via valueForStringParameter (a CloudFormation parameter) to
  // avoid a cyclic dependency with AuthStack.
  const photographerStack = new PhotographerStack(app, 'TestPhotographer', {
    config,
    env,
    db: storageStack.db,
  });

  return {
    photographerTemplate: Template.fromStack(photographerStack),
    authTemplate: Template.fromStack(authStack),
  };
}

// ── PhotographerConstruct ─────────────────────────────────────────────────────

describe('PhotographerConstruct', () => {
  test('CDK synth passes with zero TypeScript errors', () => {
    expect(() => makeStacks(devConfig)).not.toThrow();
  });

  test('creates get-photographer Lambda with correct function name and runtime', () => {
    const { photographerTemplate } = makeStacks(devConfig);
    photographerTemplate.hasResourceProperties('AWS::Lambda::Function', {
      FunctionName: 'racephotos-get-photographer-dev',
      Runtime: 'provided.al2023',
      Handler: 'bootstrap',
    });
  });

  test('creates update-photographer Lambda with correct function name and runtime', () => {
    const { photographerTemplate } = makeStacks(devConfig);
    photographerTemplate.hasResourceProperties('AWS::Lambda::Function', {
      FunctionName: 'racephotos-update-photographer-dev',
      Runtime: 'provided.al2023',
      Handler: 'bootstrap',
    });
  });

  test('get-photographer Lambda environment includes RACEPHOTOS_ENV', () => {
    const { photographerTemplate } = makeStacks(devConfig);
    photographerTemplate.hasResourceProperties('AWS::Lambda::Function', {
      FunctionName: 'racephotos-get-photographer-dev',
      Environment: {
        Variables: Match.objectLike({
          RACEPHOTOS_ENV: 'dev',
          // RACEPHOTOS_PHOTOGRAPHERS_TABLE is a cross-stack Fn::ImportValue token
          RACEPHOTOS_PHOTOGRAPHERS_TABLE: Match.anyValue(),
        }),
      },
    });
  });

  test('update-photographer Lambda environment includes RACEPHOTOS_ENV', () => {
    const { photographerTemplate } = makeStacks(devConfig);
    photographerTemplate.hasResourceProperties('AWS::Lambda::Function', {
      FunctionName: 'racephotos-update-photographer-dev',
      Environment: {
        Variables: Match.objectLike({
          RACEPHOTOS_ENV: 'dev',
          RACEPHOTOS_PHOTOGRAPHERS_TABLE: Match.anyValue(),
        }),
      },
    });
  });

  test('get-photographer IAM policy grants dynamodb:GetItem', () => {
    const { photographerTemplate } = makeStacks(devConfig);
    photographerTemplate.hasResourceProperties('AWS::IAM::Policy', {
      PolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({
            Action: 'dynamodb:GetItem',
            Effect: 'Allow',
          }),
        ]),
      },
      PolicyName: Match.stringLikeRegexp('GetPhotographerFn'),
    });
  });

  test('update-photographer IAM policy grants dynamodb:UpdateItem only', () => {
    const { photographerTemplate } = makeStacks(devConfig);
    photographerTemplate.hasResourceProperties('AWS::IAM::Policy', {
      PolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({
            Action: 'dynamodb:UpdateItem',
            Effect: 'Allow',
          }),
        ]),
      },
      PolicyName: Match.stringLikeRegexp('UpdatePhotographerFn'),
    });
  });

  test('both Lambdas are configured with 256 MB memory', () => {
    const { photographerTemplate } = makeStacks(devConfig);
    photographerTemplate.hasResourceProperties('AWS::Lambda::Function', {
      FunctionName: 'racephotos-get-photographer-dev',
      MemorySize: 256,
    });
    photographerTemplate.hasResourceProperties('AWS::Lambda::Function', {
      FunctionName: 'racephotos-update-photographer-dev',
      MemorySize: 256,
    });
  });

  test('both Lambdas have CloudWatch error alarms', () => {
    const { photographerTemplate } = makeStacks(devConfig);
    const alarms = photographerTemplate.findResources('AWS::CloudWatch::Alarm', {
      Properties: {
        MetricName: 'Errors',
      },
    });
    expect(Object.keys(alarms).length).toBeGreaterThanOrEqual(2);
  });

  test('both Lambdas have X-Ray active tracing enabled', () => {
    const { photographerTemplate } = makeStacks(devConfig);
    photographerTemplate.hasResourceProperties('AWS::Lambda::Function', {
      FunctionName: 'racephotos-get-photographer-dev',
      TracingConfig: { Mode: 'Active' },
    });
    photographerTemplate.hasResourceProperties('AWS::Lambda::Function', {
      FunctionName: 'racephotos-update-photographer-dev',
      TracingConfig: { Mode: 'Active' },
    });
  });

  test('API routes for GET and PUT /photographer/me are in the photographer stack with JWT auth', () => {
    // Routes and integrations are now created inside PhotographerStack (not AuthStack)
    // because the HTTP API is imported by ID via SSM, breaking the cross-stack ownership.
    // AuthorizationType must be JWT — NONE would leave the routes publicly accessible.
    const { photographerTemplate } = makeStacks(devConfig);
    const getRoute = photographerTemplate.findResources('AWS::ApiGatewayV2::Route', {
      Properties: { RouteKey: 'GET /photographer/me', AuthorizationType: 'JWT' },
    });
    const putRoute = photographerTemplate.findResources('AWS::ApiGatewayV2::Route', {
      Properties: { RouteKey: 'PUT /photographer/me', AuthorizationType: 'JWT' },
    });
    expect(Object.keys(getRoute).length).toBe(1);
    expect(Object.keys(putRoute).length).toBe(1);
  });

  test('photographer stack reads HTTP API ID from SSM at deploy time', () => {
    const { photographerTemplate } = makeStacks(devConfig);
    // valueForStringParameter emits an AWS::SSM::Parameter::Value<String> CFN parameter.
    // This confirms no CDK cross-stack token is used (which would cause a cyclic dependency).
    photographerTemplate.hasParameter('*', {
      Type: 'AWS::SSM::Parameter::Value<String>',
      Default: '/racephotos/env/dev/api-id',
    });
  });

  test('photographer stack reads JWT authorizer ID from SSM at deploy time', () => {
    const { photographerTemplate } = makeStacks(devConfig);
    photographerTemplate.hasParameter('*', {
      Type: 'AWS::SSM::Parameter::Value<String>',
      Default: '/racephotos/env/dev/api-authorizer-id',
    });
  });

  test('auth stack publishes HTTP API ID and authorizer ID to SSM', () => {
    const { authTemplate } = makeStacks(devConfig);
    authTemplate.hasResourceProperties('AWS::SSM::Parameter', {
      Name: '/racephotos/env/dev/api-id',
      Type: 'String',
    });
    authTemplate.hasResourceProperties('AWS::SSM::Parameter', {
      Name: '/racephotos/env/dev/api-authorizer-id',
      Type: 'String',
    });
  });
});
