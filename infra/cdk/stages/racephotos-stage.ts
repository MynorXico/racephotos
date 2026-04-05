import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { EnvConfig } from '../config/types';
import { PlaceholderStack } from '../stacks/placeholder-stack';
import { FrontendStack } from '../stacks/frontend-stack';
import { StorageStack } from '../stacks/storage-stack';
import { AuthStack } from '../stacks/auth-stack';
import { SesStack } from '../stacks/ses-stack';
import { PhotographerStack } from '../stacks/photographer-stack';

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
 *   RS-003  → SesStack (SES verified identity + email templates)
 *   RS-004  → PhotographerStack (GET + PUT /photographer/me)
 *   RS-005  → PhotoProcessorStack (Lambda + SQS consumer)
 *   RS-006  → WatermarkStack (Lambda + S3 trigger)
 *   RS-007  → SearchStack (Lambda + API Gateway route)
 *   RS-008  → PaymentStack (Lambda + DynamoDB purchase table)
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
    const storage = new StorageStack(this, 'Storage', { env: props.env, config });

    // AuthStack — RS-002
    // Cognito User Pool + HTTP API Gateway. Must be created before FrontendStack
    // so its outputs (userPoolId, clientId, region, apiUrl) can be wired into
    // FrontendConstruct's config.json.
    const auth = new AuthStack(this, 'Auth', { env: props.env, config });

    // SesStack — RS-003
    // SES verified sender identity + four email templates.
    // Must deploy before payment and download Lambda stacks (RS-006, RS-011)
    // that call ses:SendTemplatedEmail.
    // Assigned to a variable so future Lambda stacks can call
    // ses.ses.grantSendEmail(lambdaRole) from this stage.
    const ses = new SesStack(this, 'Ses', { env: props.env, config });

    // FrontendStack — Angular SPA on S3 + CloudFront.
    // FrontendConstruct reads apiBaseUrl, userPoolId, and clientId from SSM via
    // valueFromLookup — no cross-stack CDK token references. addDependency()
    // ensures AuthStack (which writes those SSM params) deploys first.
    // PhotographerStack — RS-004
    // GET + PUT /photographer/me. Depends on StorageStack (table) and AuthStack (API).
    const photographerStack = new PhotographerStack(this, 'Photographer', {
      env: props.env,
      config,
      db: storage.db,
      api: auth.api,
    });
    photographerStack.addDependency(storage);
    photographerStack.addDependency(auth);

    // FrontendStack — Angular SPA on S3 + CloudFront.
    // FrontendConstruct reads apiBaseUrl, userPoolId, and clientId from SSM via
    // valueFromLookup — no cross-stack CDK token references. addDependency()
    // ensures AuthStack (which writes those SSM params) deploys first.
    const frontendStack = new FrontendStack(this, 'Frontend', {
      env: props.env,
      config,
    });
    frontendStack.addDependency(auth);
  }
}
