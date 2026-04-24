# ADR-0012: Public photo browsing — `photoCount` counter and fill-to-limit pagination loop

**Status**: accepted
**Story**: RS-019
**Date**: 2026-04-23

---

## Context

RS-019 adds a public `GET /events/{id}/public-photos` endpoint that returns paginated
watermarked photos for runners browsing an event gallery without a bib number. Two
design decisions were required:

1. **How to compute `totalCount`** — the "Showing X of Y photos" counter needs a total
   number of fully-indexed photos for the event without scanning all pages.

2. **How to return a full page of `indexed` photos** — the `eventId-uploadedAt-index`
   GSI is queried with a `FilterExpression: #status = :indexed`. Because DynamoDB applies
   `Limit` *before* `FilterExpression`, a page of N items scanned may yield fewer than N
   matching items — or zero — even when more indexed photos exist deeper in the index.

---

## Decision 1 — Denormalized `photoCount` counter on the Event record

### Options considered

**Option A — COUNT query at read time**: Issue a `SELECT COUNT` (`Select: COUNT`) query
on `eventId-uploadedAt-index` with `FilterExpression: #status = :indexed` on every
`GET /events/{id}/public-photos` request.

**Option B — Denormalized counter on the Event record**: Watermark Lambda atomically
increments `photoCount` on the Event record (`ADD photoCount :one`) each time a photo
transitions to `indexed`. The GET endpoint reads `photoCount` from the Event record in a
single `GetItem`.

### Decision: Option B — denormalized counter

**Why:**
- A COUNT query on a large event (5,000+ photos) scans every item in the GSI partition,
  consuming read capacity proportional to the total photo count on every page request.
  With concurrent runners browsing the same event this would be expensive and slow.
- A single `GetItem` on the Event record is O(1) and costs one read unit regardless of
  event size.
- The counter drifts only in the case of watermark Lambda retries that double-increment —
  mitigated by the idempotency guard described in RS-019 tech notes. Approximate counts
  are acceptable: the story explicitly allows Y to grow as processing completes (AC6).

**Trade-off accepted:** The counter may temporarily under- or over-count due to Lambda
retries or a future backfill script being needed for historical events. This is acceptable
for a "Showing X of Y" UX label where exact accuracy is not a correctness requirement.

---

## Decision 2 — Fill-to-limit pagination loop (`limit * 3` DynamoDB buffer)

### Options considered

**Option A — Single `Query` with `Limit = limit`**: Return however many `indexed` items
DynamoDB returns in one page, even if fewer than `limit`. Accept short pages.

**Option B — Fill-to-limit loop**: Issue the first Query with `Limit = limit * 3` as a
read buffer. Collect `indexed` items. If fewer than `limit` are collected and
`LastEvaluatedKey` is non-nil, issue another Query continuing from that key. Repeat until
`limit` items are collected or the index is exhausted.

### Decision: Option B — fill-to-limit loop

**Why this story vs. RS-014 (where the loop was declined):**
RS-014 (`list-events`) queries the `status-createdAt-index` GSI where the partition key
IS the status (`status = "active"`). Every item in that partition is already an active
event — the FilterExpression for `visibility` rarely excludes any items. Short pages were
not a real-world problem, so the added loop complexity was unjustified.

RS-019 queries `eventId-uploadedAt-index` where items across all statuses (`processing`,
`watermarking`, `review_required`, `error`, `indexed`) coexist in the same GSI partition.
During and shortly after a race, a large fraction of photos are not yet `indexed`. A
single-page query returning 0 indexed items with a non-nil `LastEvaluatedKey` would force
the runner to click "Load more" multiple times with no visible result — a broken UX.

**Safeguards:**
- `limit * 3` cap on the initial DynamoDB `Limit` prevents unbounded scans per loop iteration
- Maximum iterations capped at 10 to bound Lambda execution time
- Lambda timeout is set to 10 seconds; loop exits early if close to timeout
- The 500ms p99 latency target (AC8) is enforced by the integration test

**Trade-off accepted:** Higher DynamoDB read unit consumption compared to Option A,
especially when many non-indexed photos exist. This is acceptable in v1 because:
- DynamoDB on-demand pricing scales with actual usage
- The fill-to-limit loop only runs during active processing windows; once processing
  completes, nearly all items are `indexed` and the loop rarely needs more than one iteration
