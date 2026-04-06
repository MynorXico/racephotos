import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { EnvConfig } from '../config/types';
import { DatabaseConstruct } from '../constructs/database-construct';
import { ApiConstruct } from '../constructs/api-construct';
import { PhotographerConstruct } from '../constructs/photographer-construct';

interface PhotographerStackProps extends cdk.StackProps {
  config: EnvConfig;
  /** DatabaseConstruct from StorageStack — provides the photographers table. */
  db: DatabaseConstruct;
  /** ApiConstruct from AuthStack — provides the HTTP API. */
  api: ApiConstruct;
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
 */
export class PhotographerStack extends cdk.Stack {
  readonly photographer: PhotographerConstruct;

  constructor(scope: Construct, id: string, props: PhotographerStackProps) {
    super(scope, id, props);

    const { config, db, api } = props;

    this.photographer = new PhotographerConstruct(this, 'Photographer', {
      config,
      photographersTable: db.photographersTable,
      httpApi: api.httpApi,
    });
  }
}
