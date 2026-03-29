import * as cdk from 'aws-cdk-lib';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import { Construct } from 'constructs';
import { EnvConfig } from '../config/types';

interface ProcessingPipelineConstructProps {
  config: EnvConfig;
}

/**
 * ProcessingPipelineConstruct
 *
 * Creates:
 *   racephotos-processing-dlq  — DLQ for the photo-processor Lambda
 *   racephotos-processing      — main processing queue; 5-min visibility timeout
 *                                (Rekognition DetectText typically completes in <2s,
 *                                 5-min headroom avoids re-delivery on slow starts)
 *   racephotos-watermark-dlq   — DLQ for the watermark Lambda
 *   racephotos-watermark       — main watermark queue
 *
 * Both main queues redirect to their DLQ after maxReceiveCount: 3 (CLAUDE.md mandate).
 *
 * S3 → SQS notification wiring:
 *   The raw bucket's ObjectCreated event must be wired to processingQueue in the
 *   parent stack (StorageStack) to avoid a circular dependency between this
 *   construct and PhotoStorageConstruct. The parent calls:
 *     rawBucket.addEventNotification(
 *       s3.EventType.OBJECT_CREATED,
 *       new s3n.SqsDestination(pipeline.processingQueue),
 *     )
 *
 * DLQ alarms:
 *   DLQ CloudWatch alarms are NOT created here. They are added per Lambda story
 *   (RS-003, RS-004) via ObservabilityConstruct using the dlq props exposed below.
 *   This avoids duplicate alarms when ObservabilityConstruct is wired in.
 *
 * AC: RS-001 AC3
 */
export class ProcessingPipelineConstruct extends Construct {
  readonly processingQueue: sqs.Queue;
  readonly processingDlq: sqs.Queue;
  readonly watermarkQueue: sqs.Queue;
  readonly watermarkDlq: sqs.Queue;

  constructor(scope: Construct, id: string, props: ProcessingPipelineConstructProps) {
    super(scope, id);

    // EnvConfig is reserved for future per-environment queue tuning (e.g. visibility
    // timeout overrides). Suppress unused-variable lint without modifying the config.
    void props.config;

    // ── Processing pipeline ───────────────────────────────────────────────────
    this.processingDlq = new sqs.Queue(this, 'ProcessingDlq', {
      queueName: 'racephotos-processing-dlq',
    });

    this.processingQueue = new sqs.Queue(this, 'ProcessingQueue', {
      queueName: 'racephotos-processing',
      // 5-minute visibility timeout: gives the photo-processor Lambda (Rekognition
      // + DynamoDB write) comfortable headroom before a message becomes re-visible.
      visibilityTimeout: cdk.Duration.seconds(300),
      deadLetterQueue: {
        queue: this.processingDlq,
        maxReceiveCount: 3,
      },
    });

    // ── Watermark pipeline ────────────────────────────────────────────────────
    this.watermarkDlq = new sqs.Queue(this, 'WatermarkDlq', {
      queueName: 'racephotos-watermark-dlq',
    });

    this.watermarkQueue = new sqs.Queue(this, 'WatermarkQueue', {
      queueName: 'racephotos-watermark',
      deadLetterQueue: {
        queue: this.watermarkDlq,
        maxReceiveCount: 3,
      },
    });
  }
}
