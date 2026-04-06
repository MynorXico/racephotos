import * as cdk from 'aws-cdk-lib';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import { Construct } from 'constructs';
import { EnvConfig } from '../config/types';
import { DatabaseConstruct } from '../constructs/database-construct';
import { PhotographerConstruct } from '../constructs/photographer-construct';

interface PhotographerStackProps extends cdk.StackProps {
  config: EnvConfig;
  /** DatabaseConstruct from StorageStack — provides the photographers table. */
  db: DatabaseConstruct;
}

/**
 * PhotographerStack — RS-004
 *
 * Creates the GET /photographer/me and PUT /photographer/me Lambdas and
 * registers their routes on the HTTP API.
 *
 * Dependencies (must be deployed first):
 *   StorageStack — racephotos-photographers DynamoDB table
 *   AuthStack    — HTTP API + Cognito JWT authorizer
 *
 * The HTTP API ID is read from SSM via valueForStringParameter (a CloudFormation
 * parameter resolved at deploy time) rather than received as a CDK object reference.
 * This prevents the cross-stack cyclic dependency:
 *   PhotographerStack → AuthStack  (via api.httpApi CDK object prop)
 *   AuthStack → PhotographerStack  (via route integration referencing Lambda ARN)
 */
export class PhotographerStack extends cdk.Stack {
  readonly photographer: PhotographerConstruct;

  constructor(scope: Construct, id: string, props: PhotographerStackProps) {
    super(scope, id, props);

    const { config, db } = props;

    // Read the HTTP API ID from SSM at CloudFormation deploy time.
    // valueForStringParameter emits an AWS::SSM::Parameter::Value<String> CFN
    // parameter — no CDK cross-stack export/import dependency is created.
    const httpApiId = ssm.StringParameter.valueForStringParameter(
      this,
      `/racephotos/env/${config.envName}/api-id`,
    );

    this.photographer = new PhotographerConstruct(this, 'Photographer', {
      config,
      photographersTable: db.photographersTable,
      httpApiId,
    });
  }
}
