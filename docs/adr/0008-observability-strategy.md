# ADR-0008: Observability strategy — CloudWatch + X-Ray (no third-party APM)

**Date**: 2026-03-28
**Status**: accepted

## Context

Every Lambda function in RaceShots needs:

1. **Tracing** — distributed trace context across async boundaries (S3 → SQS → Lambda chains)
2. **Error alerting** — actionable alarms when Lambda errors or DLQ messages accumulate
3. **Log retention** — structured JSON logs with a defined retention window (no unbounded accumulation)

The question is whether to use AWS-native tooling only (CloudWatch + X-Ray), or to
introduce a third-party APM platform (e.g. Datadog, Sentry, New Relic).

## Decision

Use **AWS-native observability only**: CloudWatch Logs, CloudWatch Metric Alarms,
and AWS X-Ray. No third-party APM agents or SDKs are introduced in v1.

A reusable `ObservabilityConstruct` L3 construct wraps every Lambda with:

- X-Ray active tracing enabled on the Lambda function
- A CloudWatch Log Group with explicit retention (driven by `EnvConfig.photoRetentionDays`)
- A CloudWatch Alarm on the Lambda's `Errors` metric (threshold: ≥ 1 over 5 minutes)
- A DLQ depth alarm when the Lambda is SQS-triggered (threshold: ≥ 1 message visible)

All future Lambda constructs accept an `ObservabilityConstruct` and delegate
tracing, logging, and alarm wiring to it.

## Options considered

### Option A — AWS-native only: CloudWatch + X-Ray (chosen)

Pros:

- Zero additional dependencies — runs in any AWS account without API keys or agents
- Forkable: a new contributor needs no third-party account to deploy and observe
- X-Ray provides end-to-end trace maps across Lambda, SQS, S3, DynamoDB, and API Gateway
  without code instrumentation beyond enabling active tracing
- CloudWatch alarms are sufficient for the v1 error volume
- IAM-native: no secrets to manage for the observability layer
- Cost: pay-per-use, proportional to invocation volume — low for v1 event-photo workloads

Cons:

- CloudWatch Logs search UX is inferior to Datadog / Grafana
- X-Ray trace sampling at high volume requires tuning (not a concern in v1)
- No anomaly detection or ML-based alerting in v1

### Option B — Datadog

Pros: richer dashboards, log aggregation, APM correlation, alerting rules
Cons:

- Requires a Datadog account and API key — not forkable without one
- Datadog Lambda extension adds cold-start latency (10–50 ms per invocation)
- Per-host or per-function billing that grows with scale
- Adds a dependency (`datadog-lambda-go`) to every Lambda

### Option C — Sentry for error tracking

Pros: excellent error grouping, source maps for frontend, actionable error context
Cons:

- Requires a Sentry DSN (per environment) — another secret to manage
- Adds SDK dependency to every Lambda and to the Angular frontend
- Frontend Sentry SDK requires source-map upload at build time (pipeline complexity)
- Does not replace tracing — still need X-Ray or another tool alongside it

### Option D — OpenTelemetry Collector (self-hosted)

Pros: vendor-neutral, can fan out to multiple backends
Cons:

- Significant operational overhead: runs as a Lambda layer or ECS sidecar
- Overkill for v1 event traffic; revisit if traffic warrants multi-backend fan-out
- Still requires a backend (Grafana Cloud, Jaeger, etc.) — not self-sufficient

## Consequences

**Positive**:

- Any contributor can fork and get full observability by bootstrapping CDK only
- No secrets added to the observability layer
- `ObservabilityConstruct` makes it one line to add full observability to a new Lambda
- DLQ alarms are mandatory per CLAUDE.md; centralising them prevents omissions

**Negative / tradeoffs**:

- Log search requires CloudWatch Logs Insights — less ergonomic than Datadog
- If v2 needs richer dashboards, migrating to Datadog or Grafana requires adding the
  agent layer and exporting metrics — manageable as a future PR

**Revisit trigger**: if concurrent Lambda errors exceed 100/day or if CloudWatch Logs
search latency becomes a blocker for debugging, reconsider Option B (Datadog) or
introduce a log forwarder to an external aggregator.

**Construct interface** (governs all Lambda constructs from PR 9 onwards):

```typescript
export interface ObservabilityProps {
  /** The Lambda function to instrument. */
  lambda: lambda.Function;
  /** Log retention in days — driven by EnvConfig.photoRetentionDays. */
  logRetentionDays: number;
  /**
   * Drives removal policy — pass EnvConfig.enableDeletionProtection.
   * false → DESTROY (dev/qa), true → RETAIN (prod).
   */
  enableDeletionProtection: boolean;
  /**
   * DLQ to monitor. When provided, a CloudWatch Alarm is created on
   * ApproximateNumberOfMessagesVisible >= 1 over 1 evaluation period.
   * Required for every SQS-triggered Lambda (CLAUDE.md mandate).
   */
  dlq?: sqs.Queue;
}
```

**Stories affected**: RS-001 through RS-006 (all Lambda constructs)
