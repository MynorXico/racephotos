import * as cdk from 'aws-cdk-lib';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import { Construct } from 'constructs';
import { EnvConfig } from '../config/types';
import { DatabaseConstruct } from '../constructs/database-construct';
import { PhotoStorageConstruct } from '../constructs/photo-storage-construct';
import { PhotoUploadConstruct } from '../constructs/photo-upload-construct';

interface PhotoUploadStackProps extends cdk.StackProps {
  config: EnvConfig;
  /** DatabaseConstruct from StorageStack — provides events and photos tables. */
  db: DatabaseConstruct;
  /** PhotoStorageConstruct from StorageStack — provides the raw S3 bucket. */
  storage: PhotoStorageConstruct;
}

/**
 * PhotoUploadStack — RS-006
 *
 * Creates the presign-photos Lambda and its API Gateway route:
 *   POST /events/{eventId}/photos/presign  (Cognito JWT required)
 *
 * Dependencies (must be deployed first):
 *   StorageStack — racephotos-raw-{envName} bucket, racephotos-photos table,
 *                  racephotos-events table
 *   AuthStack    — HTTP API + Cognito JWT authorizer
 *
 * The HTTP API ID and JWT authorizer ID are read from SSM via valueForStringParameter
 * (resolved at CloudFormation deploy time) to avoid cross-stack cyclic dependencies.
 */
export class PhotoUploadStack extends cdk.Stack {
  readonly photoUpload: PhotoUploadConstruct;

  constructor(scope: Construct, id: string, props: PhotoUploadStackProps) {
    super(scope, id, props);

    const { config, db, storage } = props;

    const httpApiId = ssm.StringParameter.valueForStringParameter(
      this,
      `/racephotos/env/${config.envName}/api-id`,
    );
    const httpAuthorizerId = ssm.StringParameter.valueForStringParameter(
      this,
      `/racephotos/env/${config.envName}/api-authorizer-id`,
    );

    this.photoUpload = new PhotoUploadConstruct(this, 'PhotoUpload', {
      config,
      rawBucket: storage.rawBucket,
      photosTable: db.photosTable,
      eventsTable: db.eventsTable,
      httpApiId,
      httpAuthorizerId,
    });
  }
}
