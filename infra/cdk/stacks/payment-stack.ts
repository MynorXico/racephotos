import * as cdk from 'aws-cdk-lib';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import { Construct } from 'constructs';
import { EnvConfig } from '../config/types';
import { DatabaseConstruct } from '../constructs/database-construct';
import { PaymentConstruct } from '../constructs/payment-construct';
import { SesConstruct } from '../constructs/ses-construct';

interface PaymentStackProps extends cdk.StackProps {
  config: EnvConfig;
  /** DatabaseConstruct from StorageStack — provides orders, purchases, photos, events, photographers tables. */
  db: DatabaseConstruct;
  /** SesConstruct from SesStack — grants SendTemplatedEmail on the verified identity. */
  ses: SesConstruct;
}

/**
 * PaymentStack — RS-010
 *
 * Creates the create-order Lambda and its API Gateway route:
 *   POST /orders  (no auth — public runner-facing)
 *
 * Dependencies (must be deployed first):
 *   StorageStack — racephotos-orders, racephotos-purchases, racephotos-photos,
 *                  racephotos-events, racephotos-photographers tables
 *   AuthStack    — HTTP API (api-id SSM param)
 *   SesStack     — verified SES identity + email templates
 *
 * sesFromAddress and approvalsUrl are resolved from SSM at deploy time using
 * valueForStringParameter (resolved by CloudFormation — not by CDK at synth time).
 */
export class PaymentStack extends cdk.Stack {
  readonly payment: PaymentConstruct;

  constructor(scope: Construct, id: string, props: PaymentStackProps) {
    super(scope, id, props);

    const { config, db, ses } = props;

    const httpApiId = ssm.StringParameter.valueForStringParameter(
      this,
      `/racephotos/env/${config.envName}/api-id`,
    );

    const sesFromAddress = ssm.StringParameter.valueForStringParameter(
      this,
      `/racephotos/env/${config.envName}/ses-from-address`,
    );

    const approvalsUrl = ssm.StringParameter.valueForStringParameter(
      this,
      `/racephotos/env/${config.envName}/approvals-url`,
    );

    this.payment = new PaymentConstruct(this, 'Payment', {
      config,
      ordersTable: db.ordersTable,
      purchasesTable: db.purchasesTable,
      photosTable: db.photosTable,
      eventsTable: db.eventsTable,
      photographersTable: db.photographersTable,
      ses,
      httpApiId,
      sesFromAddress,
      approvalsUrl,
    });
  }
}
