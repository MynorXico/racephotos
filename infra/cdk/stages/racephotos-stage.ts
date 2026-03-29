import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { EnvConfig } from '../config/types';
import { PlaceholderStack } from '../stacks/placeholder-stack';
import { FrontendStack } from '../stacks/frontend-stack';
import { StorageStack } from '../stacks/storage-stack';
import { AuthStack } from '../stacks/auth-stack';

interface RacePhotosStageProps extends cdk.StageProps {
  config: EnvConfig;
}

/**
 * RacePhotosStage — instantiated once per environment.
 *
 * This Stage is the unit of deployment. The pipeline deploys the same Stage
 * class to Dev, QA, Staging, and Prod — parameterised by EnvConfig.
 *
 * Stacks are added here incrementally as features are built:
 *   RS-001  → StorageStack (S3 + DynamoDB + SQS)
 *   RS-002  → AuthStack (Cognito + API Gateway) — also wires cognitoConfig + apiBaseUrl into FrontendStack
 *   RS-003  → PhotoUploadStack (Lambda + API Gateway route)
 *   RS-004  → PhotoProcessorStack (Lambda + SQS consumer)
 *   RS-005  → WatermarkStack (Lambda + S3 trigger)
 *   RS-006  → SearchStack (Lambda + API Gateway route)
 *   RS-007  → PaymentStack (Lambda + DynamoDB purchase table)
 */
export class RacePhotosStage extends cdk.Stage {
  constructor(scope: Construct, id: string, props: RacePhotosStageProps) {
    super(scope, id, props);

    const { config } = props;

    // PlaceholderStack satisfies the CDK Pipelines requirement of at least
    // one Stack per Stage alongside application stacks. Remove once real
    // application stacks replace all resources.
    new PlaceholderStack(this, 'Placeholder', { env: props.env, config });

    // StorageStack — RS-001
    // S3 buckets, DynamoDB tables, SQS queues. All Lambda stacks depend on this.
    new StorageStack(this, 'Storage', { env: props.env, config });

    // AuthStack — RS-002
    // Cognito User Pool + HTTP API Gateway. Must be created before FrontendStack
    // so its outputs (userPoolId, clientId, region, apiUrl) can be wired into
    // FrontendConstruct's config.json.
    const auth = new AuthStack(this, 'Auth', { env: props.env, config });

    // FrontendStack — Angular SPA on S3 + CloudFront.
    // Receives Cognito config and API URL from AuthStack.
    new FrontendStack(this, 'Frontend', {
      env: props.env,
      config,
      apiBaseUrl: auth.api.apiUrl,
      cognitoConfig: {
        userPoolId: auth.cognito.userPoolId,
        clientId: auth.cognito.clientId,
        region: auth.cognito.region,
      },
    });
  }
}
