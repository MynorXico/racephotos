import * as cdk from 'aws-cdk-lib';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import { Construct } from 'constructs';
import { EnvConfig } from '../config/types';
import { DatabaseConstruct } from '../constructs/database-construct';
import { PhotoStorageConstruct } from '../constructs/photo-storage-construct';
import { ProcessingPipelineConstruct } from '../constructs/processing-pipeline-construct';
import { PhotoProcessingConstruct } from '../constructs/photo-processing-construct';

interface PhotoProcessingStackProps extends cdk.StackProps {
  config: EnvConfig;
  /** DatabaseConstruct from StorageStack — tables */
  db: DatabaseConstruct;
  /** PhotoStorageConstruct from StorageStack — S3 buckets */
  storage: PhotoStorageConstruct;
  /** ProcessingPipelineConstruct from StorageStack — SQS queues */
  pipeline: ProcessingPipelineConstruct;
}

/**
 * PhotoProcessingStack — RS-007, RS-013
 *
 * Creates the photo-processor, watermark, and tag-photo-bibs Lambdas.
 *
 * Dependencies (must be deployed first):
 *   StorageStack — S3 buckets, DynamoDB tables, SQS queues
 *   AuthStack    — HTTP API + Cognito JWT authorizer (read from SSM at deploy time)
 */
export class PhotoProcessingStack extends cdk.Stack {
  readonly photoProcessing: PhotoProcessingConstruct;

  constructor(scope: Construct, id: string, props: PhotoProcessingStackProps) {
    super(scope, id, props);

    const { config, db, storage, pipeline } = props;

    const httpApiId = ssm.StringParameter.valueForStringParameter(
      this,
      `/racephotos/env/${config.envName}/api-id`,
    );
    const httpAuthorizerId = ssm.StringParameter.valueForStringParameter(
      this,
      `/racephotos/env/${config.envName}/api-authorizer-id`,
    );

    this.photoProcessing = new PhotoProcessingConstruct(this, 'PhotoProcessing', {
      config,
      rawBucket: storage.rawBucket,
      processedBucket: storage.processedBucket,
      photosTable: db.photosTable,
      eventsTable: db.eventsTable,
      bibIndexTable: db.bibIndexTable,
      processingQueue: pipeline.processingQueue,
      processingDlq: pipeline.processingDlq,
      watermarkQueue: pipeline.watermarkQueue,
      watermarkDlq: pipeline.watermarkDlq,
      httpApiId,
      httpAuthorizerId,
    });
  }
}
