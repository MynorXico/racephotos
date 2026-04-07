import * as cdk from 'aws-cdk-lib';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import { Construct } from 'constructs';
import { EnvConfig } from '../config/types';
import { DatabaseConstruct } from '../constructs/database-construct';
import { EventConstruct } from '../constructs/event-construct';

interface EventStackProps extends cdk.StackProps {
  config: EnvConfig;
  /** DatabaseConstruct from StorageStack — provides the events and photographers tables. */
  db: DatabaseConstruct;
}

/**
 * EventStack — RS-005
 *
 * Creates the five event management Lambdas and registers their routes on the HTTP API:
 *   POST /events                 — create-event (JWT required)
 *   GET  /events/{id}            — get-event (public, no auth)
 *   PUT  /events/{id}            — update-event (JWT required)
 *   PUT  /events/{id}/archive    — archive-event (JWT required)
 *   GET  /photographer/me/events — list-photographer-events (JWT required)
 *
 * Dependencies (must be deployed first):
 *   StorageStack — racephotos-events and racephotos-photographers DynamoDB tables
 *   AuthStack    — HTTP API + Cognito JWT authorizer
 *
 * The HTTP API ID and JWT authorizer ID are read from SSM via valueForStringParameter
 * (resolved at deploy time by CloudFormation) to avoid a cross-stack cyclic dependency.
 */
export class EventStack extends cdk.Stack {
  readonly events: EventConstruct;

  constructor(scope: Construct, id: string, props: EventStackProps) {
    super(scope, id, props);

    const { config, db } = props;

    // Read the HTTP API ID and JWT authorizer ID from SSM at CloudFormation deploy time.
    // valueForStringParameter emits AWS::SSM::Parameter::Value<String> CFN parameters —
    // no CDK cross-stack export/import dependency is created.
    const httpApiId = ssm.StringParameter.valueForStringParameter(
      this,
      `/racephotos/env/${config.envName}/api-id`,
    );
    const httpAuthorizerId = ssm.StringParameter.valueForStringParameter(
      this,
      `/racephotos/env/${config.envName}/api-authorizer-id`,
    );

    this.events = new EventConstruct(this, 'Event', {
      config,
      eventsTable: db.eventsTable,
      photographersTable: db.photographersTable,
      httpApiId,
      httpAuthorizerId,
    });
  }
}
