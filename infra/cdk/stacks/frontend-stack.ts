import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { EnvConfig } from '../config/types';
import { FrontendConstruct, CognitoConfig } from '../constructs/frontend-construct';

interface FrontendStackProps extends cdk.StackProps {
  config: EnvConfig;
  /** Injected by ApiConstruct (RS-002). Placeholder until then. */
  apiBaseUrl?: string;
  /** Injected by CognitoConstruct (RS-007). Placeholder until then. */
  cognitoConfig?: CognitoConfig;
}

/**
 * FrontendStack — deploys the Angular SPA.
 *
 * Thin wrapper that gives FrontendConstruct its own CloudFormation stack,
 * keeping frontend resources isolated from backend stacks for faster deploys
 * and cleaner rollback boundaries.
 */
export class FrontendStack extends cdk.Stack {
  readonly distributionDomainName: string;

  constructor(scope: Construct, id: string, props: FrontendStackProps) {
    super(scope, id, props);

    const frontend = new FrontendConstruct(this, 'Frontend', {
      config: props.config,
      apiBaseUrl: props.apiBaseUrl,
      cognitoConfig: props.cognitoConfig,
    });

    this.distributionDomainName = frontend.distributionDomainName;
  }
}
