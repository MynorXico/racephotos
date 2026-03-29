import * as cdk from 'aws-cdk-lib';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import { Construct } from 'constructs';
import { EnvConfig } from '../config/types';
import { SesConstruct } from '../constructs/ses-construct';

interface SesStackProps extends cdk.StackProps {
  config: EnvConfig;
}

/**
 * SesStack — SES verified identity + email templates.
 *
 * Deployed before payment and download Lambda stacks (RS-006, RS-011) so that
 * all four SES templates exist when those Lambdas first send email.
 *
 * sesFromAddress is loaded from SSM at synth time:
 *   /racephotos/env/{envName}/ses-from-address
 *
 * This value is intentionally NOT in EnvConfig — storing a verified email
 * address in environments.ts would expose contributor addresses in version
 * control. SSM is the correct layer for this value.
 *
 * Downstream stacks obtain a reference to `stack.ses` and call
 * `stack.ses.grantSendEmail(lambdaRole)` to receive the minimum required
 * IAM permissions.
 */
export class SesStack extends cdk.Stack {
  readonly ses: SesConstruct;

  constructor(scope: Construct, id: string, props: SesStackProps) {
    super(scope, id, props);

    const { config } = props;

    // Resolve the verified sender address from SSM at synth time.
    // generate-cdk-context.sh populates cdk.context.json from SSM before each
    // synth, so a dummy value is only seen on the very first local synth before
    // seed-ssm.sh has been run.
    const sesFromAddress = ssm.StringParameter.valueFromLookup(
      this,
      `/racephotos/env/${config.envName}/ses-from-address`,
    );

    this.ses = new SesConstruct(this, 'Ses', { config, sesFromAddress });
    this.ses.addArnOutput();
  }
}
