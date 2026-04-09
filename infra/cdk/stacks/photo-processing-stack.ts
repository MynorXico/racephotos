import * as cdk from 'aws-cdk-lib';
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
 * PhotoProcessingStack — RS-007
 *
 * Creates the photo-processor and watermark Lambdas.
 *
 * Dependencies (must be deployed first):
 *   StorageStack — S3 buckets, DynamoDB tables, SQS queues
 */
export class PhotoProcessingStack extends cdk.Stack {
  readonly photoProcessing: PhotoProcessingConstruct;

  constructor(scope: Construct, id: string, props: PhotoProcessingStackProps) {
    super(scope, id, props);

    const { config, db, storage, pipeline } = props;

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
    });
  }
}
