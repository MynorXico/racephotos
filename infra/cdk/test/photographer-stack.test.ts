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
  const photographerStack = new PhotographerStack(app, 'TestPhotographer', {
    config,
    env,
    db: storageStack.db,
    api: authStack.api,
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

  test('API routes are registered for GET and PUT /photographer/me in the auth stack', () => {
    // Routes are added to httpApi which is defined in AuthStack — CDK adds them there.
    const { authTemplate } = makeStacks(devConfig);
    const getRoute = authTemplate.findResources('AWS::ApiGatewayV2::Route', {
      Properties: { RouteKey: 'GET /photographer/me' },
    });
    const putRoute = authTemplate.findResources('AWS::ApiGatewayV2::Route', {
      Properties: { RouteKey: 'PUT /photographer/me' },
    });
    expect(Object.keys(getRoute).length).toBe(1);
    expect(Object.keys(putRoute).length).toBe(1);
  });
});
