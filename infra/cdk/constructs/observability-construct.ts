import * as cdk from 'aws-cdk-lib';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import { Construct } from 'constructs';

export interface ObservabilityProps {
  /** The Lambda function to instrument. */
  lambda: lambda.Function;
  /**
   * Log retention in days.
   * Pass EnvConfig.photoRetentionDays — keeps log retention in sync with
   * the photo lifecycle so operators aren't paying for logs longer than photos exist.
   */
  logRetentionDays: number;
  /**
   * DLQ to monitor. When provided, a CloudWatch Alarm fires when
   * ApproximateNumberOfMessagesVisible >= 1 in any 5-minute window.
   *
   * Required for every SQS-triggered Lambda (CLAUDE.md mandate).
   * Omit only for non-SQS Lambdas (e.g. API Gateway-triggered).
   */
  dlq?: sqs.Queue;
}

/**
 * ObservabilityConstruct
 *
 * Wraps an already-instantiated Lambda function with the standard RaceShots
 * observability stack:
 *   - X-Ray active tracing via CfnFunction escape hatch (tracing is not
 *     mutable after Lambda construction)
 *   - Log retention policy via LogRetention custom resource — safe to apply
 *     to an auto-created log group without causing CloudFormation conflicts
 *   - CloudWatch Alarm: Lambda Errors ≥ 1 over a 5-minute window
 *   - CloudWatch Alarm: DLQ depth ≥ 1 (when dlq prop is provided)
 *
 * Why LogRetention instead of LogGroup:
 *   `new logs.LogGroup(name)` claims ownership of the group in CloudFormation.
 *   Lambda auto-creates its log group on first invocation, so any re-deploy
 *   after the function has run will fail with "already exists". LogRetention
 *   uses a CDK custom resource that creates-or-updates the retention policy
 *   without taking ownership — it is the CDK-sanctioned post-instantiation
 *   approach (same mechanism used by lambda.Function's logRetention prop).
 *
 * Usage:
 *
 *   new ObservabilityConstruct(this, 'Observability', {
 *     lambda: myFn,
 *     logRetentionDays: config.photoRetentionDays,
 *     enableDeletionProtection: config.enableDeletionProtection,
 *     dlq: myDlq,   // omit for non-SQS Lambdas
 *   });
 *
 * See docs/adr/0008-observability-strategy.md for rationale.
 */
export class ObservabilityConstruct extends Construct {
  /** CloudWatch Alarm that fires on any Lambda Errors. */
  readonly errorAlarm: cloudwatch.Alarm;
  /** CloudWatch Alarm that fires when the DLQ has ≥ 1 message (only set when dlq provided). */
  readonly dlqAlarm?: cloudwatch.Alarm;
  /** The CloudWatch log group name for the Lambda (for use in dashboards or metric filters). */
  readonly logGroupName: string;

  constructor(scope: Construct, id: string, props: ObservabilityProps) {
    super(scope, id);

    const { lambda: fn, logRetentionDays, dlq } = props;

    // ── X-Ray active tracing ──────────────────────────────────────────────
    // Sets ACTIVE mode: Lambda traces every invocation and propagates the
    // trace context to downstream AWS SDK calls (S3, DynamoDB, SQS, Rekognition).
    // No code instrumentation required — the X-Ray SDK auto-patches AWS SDK v3.
    //
    // The `tracing` property is not mutable after Lambda construction, so we
    // override the underlying L1 CfnFunction's TracingConfig directly.
    fn.addEnvironment('AWS_XRAY_CONTEXT_MISSING', 'LOG_ERROR');
    const cfnFn = fn.node.defaultChild as lambda.CfnFunction;
    cfnFn.tracingConfig = { mode: 'Active' };

    // ── Log retention via custom resource ─────────────────────────────────
    // Lambda auto-creates its log group at first invocation; claiming it with
    // `new logs.LogGroup(name)` causes a CloudFormation "already exists" error
    // on any re-deploy after the function has run.
    //
    // logs.LogRetention creates a custom resource that calls PutRetentionPolicy
    // (creating the group if absent, or updating the policy if it already exists)
    // without taking CloudFormation ownership of the log group. This is the same
    // mechanism lambda.Function uses internally for its own logRetention prop.
    //
    // Note: logs.LogRetention has a removalPolicy prop, but it controls the
    // internal backing Lambda's own log group — NOT the application log group.
    // The application log group is never owned by CloudFormation and therefore
    // always persists after stack deletion. No removalPolicy is set here.
    this.logGroupName = `/aws/lambda/${fn.functionName}`;
    new logs.LogRetention(this, 'LogRetention', {
      logGroupName: this.logGroupName,
      retention: this.toRetentionDays(logRetentionDays),
    });

    // ── Lambda error alarm ────────────────────────────────────────────────
    // Fires as soon as a single Lambda error occurs in a 5-minute window.
    // Threshold: 1 error — Lambda errors are unexpected in normal operation;
    // any non-zero count warrants investigation.
    this.errorAlarm = new cloudwatch.Alarm(this, 'ErrorAlarm', {
      alarmName: `${fn.functionName}-errors`,
      alarmDescription: `Lambda ${fn.functionName} has >= 1 error in a 5-minute window`,
      metric: fn.metricErrors({
        period: cdk.Duration.minutes(5),
        statistic: 'Sum',
      }),
      threshold: 1,
      evaluationPeriods: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });

    // ── DLQ depth alarm ───────────────────────────────────────────────────
    // Required for all SQS-triggered Lambdas (CLAUDE.md mandate).
    // A message in the DLQ means the processor failed maxReceiveCount times —
    // this is always a production incident requiring immediate attention.
    if (dlq) {
      this.dlqAlarm = new cloudwatch.Alarm(this, 'DlqAlarm', {
        alarmName: `${fn.functionName}-dlq-depth`,
        alarmDescription: `DLQ for ${fn.functionName} has >= 1 message — processing failure detected`,
        metric: dlq.metricApproximateNumberOfMessagesVisible({
          period: cdk.Duration.minutes(5),
          statistic: 'Maximum',
        }),
        threshold: 1,
        evaluationPeriods: 1,
        comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
        treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
      });
    }
  }

  /**
   * Maps an arbitrary number of days to the nearest CloudWatch Logs RetentionDays enum value.
   * CloudWatch only accepts specific retention periods — this method rounds up to the next
   * supported value so log data is never discarded earlier than the configured window.
   */
  private toRetentionDays(days: number): logs.RetentionDays {
    // Ordered from smallest to largest — return the first value >= requested days.
    const supported: [number, logs.RetentionDays][] = [
      [1, logs.RetentionDays.ONE_DAY],
      [3, logs.RetentionDays.THREE_DAYS],
      [5, logs.RetentionDays.FIVE_DAYS],
      [7, logs.RetentionDays.ONE_WEEK],
      [14, logs.RetentionDays.TWO_WEEKS],
      [30, logs.RetentionDays.ONE_MONTH],
      [60, logs.RetentionDays.TWO_MONTHS],
      [90, logs.RetentionDays.THREE_MONTHS],
      [120, logs.RetentionDays.FOUR_MONTHS],
      [150, logs.RetentionDays.FIVE_MONTHS],
      [180, logs.RetentionDays.SIX_MONTHS],
      [365, logs.RetentionDays.ONE_YEAR],
      [400, logs.RetentionDays.THIRTEEN_MONTHS],
      [545, logs.RetentionDays.EIGHTEEN_MONTHS],
      [731, logs.RetentionDays.TWO_YEARS],
      [1096, logs.RetentionDays.THREE_YEARS],
      [1827, logs.RetentionDays.FIVE_YEARS],
      [2557, logs.RetentionDays.SEVEN_YEARS],
      [3653, logs.RetentionDays.TEN_YEARS],
    ];

    for (const [threshold, retention] of supported) {
      if (days <= threshold) return retention;
    }

    return logs.RetentionDays.TEN_YEARS;
  }
}
