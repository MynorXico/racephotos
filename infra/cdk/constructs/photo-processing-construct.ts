import * as path from 'path';
import * as cdk from 'aws-cdk-lib';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as lambdaEventSources from 'aws-cdk-lib/aws-lambda-event-sources';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import { Construct } from 'constructs';

import { EnvConfig } from '../config/types';
import { ObservabilityConstruct } from './observability-construct';

interface PhotoProcessingConstructProps {
  config: EnvConfig;
  /** racephotos-raw-{envName} bucket — photo-processor reads from it; watermark reads from it */
  rawBucket: s3.Bucket;
  /** racephotos-processed-{envName} bucket — watermark Lambda writes to it */
  processedBucket: s3.Bucket;
  /** racephotos-photos DynamoDB table */
  photosTable: dynamodb.Table;
  /** racephotos-events DynamoDB table — watermark Lambda reads watermarkText */
  eventsTable: dynamodb.Table;
  /** racephotos-bib-index DynamoDB table — photo-processor writes fan-out entries */
  bibIndexTable: dynamodb.Table;
  /** racephotos-processing SQS queue — event source for photo-processor */
  processingQueue: sqs.Queue;
  /** racephotos-processing-dlq — DLQ alarm target for photo-processor */
  processingDlq: sqs.Queue;
  /** racephotos-watermark SQS queue — event source for watermark Lambda */
  watermarkQueue: sqs.Queue;
  /** racephotos-watermark-dlq — DLQ alarm target for watermark Lambda */
  watermarkDlq: sqs.Queue;
}

/**
 * PhotoProcessingConstruct — RS-007
 *
 * Creates two SQS-triggered Lambdas:
 *
 *   photo-processor — reads S3 ObjectCreated notifications from racephotos-processing;
 *     calls Rekognition DetectText, writes bib entries and photo status to DynamoDB,
 *     publishes to racephotos-watermark.
 *
 *   watermark — reads from racephotos-watermark; downloads the raw photo, applies a
 *     text watermark using fogleman/gg (ADR-0009), writes the result to the processed
 *     bucket, and updates the photo record with the watermarkedS3Key.
 *
 * Both Lambdas use partial batch failure response (batchSize: 10, bisectOnError: true).
 * Both are wrapped with ObservabilityConstruct including DLQ alarms (CLAUDE.md mandate).
 *
 * IAM grants follow least-privilege (only the actions used by each Lambda).
 *
 * AC: RS-007 AC1–AC7
 */
export class PhotoProcessingConstruct extends Construct {
  readonly photoProcessorFn: lambda.Function;
  readonly watermarkFn: lambda.Function;

  constructor(scope: Construct, id: string, props: PhotoProcessingConstructProps) {
    super(scope, id);

    const {
      config,
      rawBucket,
      processedBucket,
      photosTable,
      eventsTable,
      bibIndexTable,
      processingQueue,
      processingDlq,
      watermarkQueue,
      watermarkDlq,
    } = props;

    // ── photo-processor Lambda ────────────────────────────────────────────────
    this.photoProcessorFn = new lambda.Function(this, 'PhotoProcessorFn', {
      functionName: `racephotos-photo-processor-${config.envName}`,
      runtime: lambda.Runtime.PROVIDED_AL2023,
      architecture: lambda.Architecture.X86_64,
      handler: 'bootstrap',
      memorySize: 512,
      // 60 s: up to 10 Rekognition DetectText calls per batch plus cold-start
      // overhead. The processing queue visibility timeout is 360 s (6× this value)
      // per the AWS SQS–Lambda best-practice recommendation.
      timeout: cdk.Duration.seconds(60),
      code: lambda.Code.fromAsset(path.join(__dirname, '../../../lambdas/photo-processor')),
      environment: {
        RACEPHOTOS_ENV: config.envName,
        RACEPHOTOS_RAW_BUCKET: rawBucket.bucketName,
        RACEPHOTOS_PHOTOS_TABLE: photosTable.tableName,
        RACEPHOTOS_BIB_INDEX_TABLE: bibIndexTable.tableName,
        RACEPHOTOS_WATERMARK_QUEUE_URL: watermarkQueue.queueUrl,
        RACEPHOTOS_CONFIDENCE_MIN: String(config.rekognitionConfidenceThreshold),
      },
    });

    // IAM: Rekognition DetectText
    this.photoProcessorFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['rekognition:DetectText'],
        resources: ['*'], // Rekognition DetectText has no resource-level restrictions
      }),
    );
    // IAM: S3 read from raw bucket
    this.photoProcessorFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['s3:GetObject'],
        resources: [rawBucket.arnForObjects('*')],
      }),
    );
    // IAM: DynamoDB writes
    photosTable.grant(this.photoProcessorFn, 'dynamodb:GetItem', 'dynamodb:UpdateItem');
    bibIndexTable.grant(this.photoProcessorFn, 'dynamodb:BatchWriteItem');
    // IAM: SQS publish to watermark queue
    watermarkQueue.grantSendMessages(this.photoProcessorFn);

    // Event source: racephotos-processing queue
    // Cap max concurrency to prevent SQS-triggered lambdas from exhausting the
    // account-level concurrency pool and throttling API-facing Lambdas.
    // This is a temporary measure until the account concurrency limit is raised.
    this.photoProcessorFn.addEventSource(
      new lambdaEventSources.SqsEventSource(processingQueue, {
        batchSize: 10,
        reportBatchItemFailures: true,
        maxConcurrency: config.sqsMaxConcurrency,
      }),
    );

    new ObservabilityConstruct(this, 'PhotoProcessorObs', {
      lambda: this.photoProcessorFn,
      logRetentionDays: config.photoRetentionDays,
      dlq: processingDlq,
    });

    // ── watermark Lambda ──────────────────────────────────────────────────────
    this.watermarkFn = new lambda.Function(this, 'WatermarkFn', {
      functionName: `racephotos-watermark-${config.envName}`,
      runtime: lambda.Runtime.PROVIDED_AL2023,
      architecture: lambda.Architecture.X86_64,
      handler: 'bootstrap',
      // 512 MB: image decode + gg canvas rendering is memory-bound; more RAM
      // reduces GC pressure and speeds up the fog/gg pixel operations.
      memorySize: 512,
      // Explicit 60 s timeout: batch of 10 × ~3 s = ~30 s, plus S3/DDB
      // round-trips and cold-start overhead. The watermark queue visibility
      // timeout is 360 s (6× this value) per AWS best-practice recommendation.
      timeout: cdk.Duration.seconds(60),
      code: lambda.Code.fromAsset(path.join(__dirname, '../../../lambdas/watermark')),
      environment: {
        RACEPHOTOS_ENV: config.envName,
        RACEPHOTOS_RAW_BUCKET: rawBucket.bucketName,
        RACEPHOTOS_PROCESSED_BUCKET: processedBucket.bucketName,
        RACEPHOTOS_PHOTOS_TABLE: photosTable.tableName,
        RACEPHOTOS_EVENTS_TABLE: eventsTable.tableName,
      },
    });

    // IAM: S3 read from raw bucket, write to processed bucket
    // s3:ListBucket (bucket ARN) is required alongside s3:GetObject so that
    // missing-key errors surface as 404 rather than 403 AccessDenied.
    this.watermarkFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['s3:GetObject'],
        resources: [rawBucket.arnForObjects('*')],
      }),
    );
    this.watermarkFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['s3:ListBucket'],
        resources: [rawBucket.bucketArn],
      }),
    );
    this.watermarkFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['s3:PutObject'],
        resources: [processedBucket.arnForObjects('*')],
      }),
    );
    // IAM: DynamoDB reads (events) and writes (photos)
    eventsTable.grant(this.watermarkFn, 'dynamodb:GetItem');
    photosTable.grant(this.watermarkFn, 'dynamodb:UpdateItem');

    // Event source: racephotos-watermark queue
    // Cap max concurrency to prevent SQS-triggered lambdas from exhausting the
    // account-level concurrency pool and throttling API-facing Lambdas.
    // This is a temporary measure until the account concurrency limit is raised.
    this.watermarkFn.addEventSource(
      new lambdaEventSources.SqsEventSource(watermarkQueue, {
        batchSize: 10,
        reportBatchItemFailures: true,
        maxConcurrency: config.sqsMaxConcurrency,
      }),
    );

    new ObservabilityConstruct(this, 'WatermarkObs', {
      lambda: this.watermarkFn,
      logRetentionDays: config.photoRetentionDays,
      dlq: watermarkDlq,
    });
  }
}
