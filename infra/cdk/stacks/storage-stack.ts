import * as cdk from 'aws-cdk-lib';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as s3n from 'aws-cdk-lib/aws-s3-notifications';
import { Construct } from 'constructs';
import { EnvConfig } from '../config/types';
import { PhotoStorageConstruct } from '../constructs/photo-storage-construct';
import { DatabaseConstruct } from '../constructs/database-construct';
import { ProcessingPipelineConstruct } from '../constructs/processing-pipeline-construct';

interface StorageStackProps extends cdk.StackProps {
  config: EnvConfig;
}

/**
 * StorageStack — RS-001
 *
 * Provisions the foundational storage and messaging layer:
 *   - PhotoStorageConstruct  : raw + processed S3 buckets + CloudFront distribution
 *   - DatabaseConstruct      : 6 DynamoDB tables
 *   - ProcessingPipelineConstruct : processing + watermark SQS queues with DLQs
 *
 * Also wires the S3 ObjectCreated event from the raw bucket to the processing
 * queue here (in the stack, not in a construct) to avoid a circular dependency
 * between PhotoStorageConstruct and ProcessingPipelineConstruct.
 *
 * Exposes all construct resources as public properties so downstream Lambda
 * stacks (RS-003+) can reference table names and queue URLs without querying
 * CloudFormation at deploy time.
 */
export class StorageStack extends cdk.Stack {
  readonly photoStorage: PhotoStorageConstruct;
  readonly db: DatabaseConstruct;
  readonly pipeline: ProcessingPipelineConstruct;

  constructor(scope: Construct, id: string, props: StorageStackProps) {
    super(scope, id, props);

    const { config } = props;

    this.photoStorage = new PhotoStorageConstruct(this, 'PhotoStorage', { config });
    this.db = new DatabaseConstruct(this, 'Database', { config });
    this.pipeline = new ProcessingPipelineConstruct(this, 'ProcessingPipeline', { config });

    // ── S3 ObjectCreated → SQS processing queue ───────────────────────────────
    // Wired here (not inside either construct) to avoid circular dependency:
    // PhotoStorageConstruct does not know about SQS;
    // ProcessingPipelineConstruct does not know about S3.
    this.photoStorage.rawBucket.addEventNotification(
      s3.EventType.OBJECT_CREATED,
      new s3n.SqsDestination(this.pipeline.processingQueue),
    );
  }
}
