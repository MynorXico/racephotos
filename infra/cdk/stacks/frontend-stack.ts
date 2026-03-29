import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { EnvConfig } from '../config/types';
import { FrontendConstruct } from '../constructs/frontend-construct';

interface FrontendStackProps extends cdk.StackProps {
  config: EnvConfig;
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
    });

    this.distributionDomainName = frontend.distributionDomainName;
  }
}
