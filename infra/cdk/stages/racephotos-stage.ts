import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { EnvConfig } from '../config/types';
import { PlaceholderStack } from '../stacks/placeholder-stack';
import { FrontendStack } from '../stacks/frontend-stack';
import { StorageStack } from '../stacks/storage-stack';

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
 *   RS-001  → StorageStack (S3 + DynamoDB)
 *   RS-002  → PhotoUploadStack (Lambda + API Gateway route) — also sets apiBaseUrl
 *   RS-003  → PhotoProcessorStack (Lambda + SQS consumer)
 *   RS-004  → WatermarkStack (Lambda + S3 trigger)
 *   RS-005  → SearchStack (Lambda + API Gateway route)
 *   RS-006  → PaymentStack (Lambda + DynamoDB purchase table)
 *   RS-007  → AuthStack (Cognito) — also wires cognitoConfig into FrontendStack
 *
 * FrontendStack deploys the Angular SPA with placeholder config.json until
 * ApiConstruct (RS-002) and CognitoConstruct (RS-007) supply real values.
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
    // S3 buckets, DynamoDB tables, SQS queues, and CloudFront distribution
    // for processed photos. All Lambda stacks depend on this stack.
    new StorageStack(this, 'Storage', { env: props.env, config });

    // FrontendStack — Angular SPA on S3 + CloudFront.
    // Deployed with placeholder config.json values until RS-002 (API URL)
    // and RS-007 (Cognito) are built and wired in here.
    new FrontendStack(this, 'Frontend', { env: props.env, config });
  }
}
