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
 *   racephotos-watermark       — main watermark queue; 2-min visibility timeout
 *                                (S3 GET + image watermark + S3 PUT for a typical JPEG
 *                                 completes well under 60s; 2-min gives cold-start headroom)
 *
 * Both main queues redirect to their DLQ after maxReceiveCount: 3 (CLAUDE.md mandate).
 * All four queues use SQS_MANAGED server-side encryption.
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

    const encryption = sqs.QueueEncryption.SQS_MANAGED;

    // ── Processing pipeline ───────────────────────────────────────────────────
    this.processingDlq = new sqs.Queue(this, 'ProcessingDlq', {
      queueName: 'racephotos-processing-dlq',
      encryption,
    });

    this.processingQueue = new sqs.Queue(this, 'ProcessingQueue', {
      queueName: 'racephotos-processing',
      encryption,
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
      encryption,
    });

    this.watermarkQueue = new sqs.Queue(this, 'WatermarkQueue', {
      queueName: 'racephotos-watermark',
      encryption,
      // 6-minute visibility timeout: batch size 10 × ~30s per image (S3 GET + decode
      // + gg watermark + JPEG encode + S3 PUT) = ~300s sequential worst case.
      // 360s gives headroom without letting a failed message stay invisible too long.
      visibilityTimeout: cdk.Duration.seconds(360),
      deadLetterQueue: {
        queue: this.watermarkDlq,
        maxReceiveCount: 3,
      },
    });
  }
}
