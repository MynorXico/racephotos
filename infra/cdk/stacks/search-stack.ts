import * as cdk from 'aws-cdk-lib';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import { Construct } from 'constructs';
import { EnvConfig } from '../config/types';
import { DatabaseConstruct } from '../constructs/database-construct';
import { PhotoStorageConstruct } from '../constructs/photo-storage-construct';
import { SearchConstruct } from '../constructs/search-construct';

interface SearchStackProps extends cdk.StackProps {
  config: EnvConfig;
  /** DatabaseConstruct from StorageStack — provides bib-index, photos, and events tables. */
  db: DatabaseConstruct;
  /** PhotoStorageConstruct from StorageStack — provides the CloudFront CDN domain. */
  storage: PhotoStorageConstruct;
}

/**
 * SearchStack — RS-009
 *
 * Creates the search Lambda and its API Gateway route:
 *   GET /events/{id}/photos/search  (no auth — public runner-facing)
 *
 * Dependencies (must be deployed first):
 *   StorageStack — racephotos-bib-index table, racephotos-photos table,
 *                  racephotos-events table, CloudFront CDN domain
 *   AuthStack    — HTTP API (api-id SSM param)
 *
 * The HTTP API ID is read from SSM via valueForStringParameter
 * (resolved at CloudFormation deploy time) to avoid cross-stack cyclic dependencies.
 * No JWT authorizer is needed — the search route is public.
 */
export class SearchStack extends cdk.Stack {
  readonly search: SearchConstruct;

  constructor(scope: Construct, id: string, props: SearchStackProps) {
    super(scope, id, props);

    const { config, db, storage } = props;

    const httpApiId = ssm.StringParameter.valueForStringParameter(
      this,
      `/racephotos/env/${config.envName}/api-id`,
    );

    this.search = new SearchConstruct(this, 'Search', {
      config,
      bibIndexTable: db.bibIndexTable,
      photosTable: db.photosTable,
      eventsTable: db.eventsTable,
      httpApiId,
      cdnDomainName: storage.cdnDomainName,
    });
  }
}
