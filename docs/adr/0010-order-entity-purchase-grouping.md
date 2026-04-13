# ADR-0010: Order entity as the primary purchase grouping unit
**Date**: 2026-04-12
**Status**: accepted

## Context

The original domain model (PRODUCT_CONTEXT.md) defined `Purchase` as the primary
payment entity, with one `paymentRef` per `(photo_id, runner_email)` pair. Under
this design, a runner buying 3 photos would make 3 separate bank transfers using
3 different payment references — one per photo.

Before RS-010 was built, the decision was made to support multi-photo purchase
(RS-011) where a runner selects multiple photos and makes a single bank transfer.
The question: how should the data model evolve to support both single-photo and
multi-photo purchase without a migration when RS-011 ships?

## Decision

Introduce an **Order** entity as the primary purchase grouping unit. Each Order:
- Belongs to one runner (`runnerEmail`)
- Covers one or more photos from the **same event and same photographer** (v1)
- Carries exactly one `paymentRef` — the reference the runner gives the bank
- Has one `totalAmount` and `currency` — the sum across all photos in the order

Each photo in the Order becomes a **Purchase** line item:
- Links back to its Order via `orderId` (always set — no sparse field)
- Carries its own `downloadToken` (set at approval) for independent download
- Has its own `status` that mirrors the Order status, set atomically at approval

A single-photo order is an Order with one Purchase. There is no separate
single-photo code path — the same Lambda, the same API, the same approval flow
handles both.

**v1 constraint**: all photos in one Order must share one event and one
photographer. Cross-event orders are not supported. This avoids a multi-photographer
approval coordination problem with no clear v1 use case.

## Options considered

### Option A — Keep Purchase as the primary entity; add sparse `groupId`
Add an optional `groupId` field to the existing `Purchase` model. Single-photo
purchases leave it empty; multi-photo purchases share a `groupId`.
Pros: no new table, additive schema change.
Cons: split logic — single-photo and multi-photo are different code paths; the
`paymentRef` location becomes ambiguous (on Purchase for single, on a Group entity
for multi); a `Group` entity needs to be introduced anyway for the bank details
response, making this equivalent to Option B with extra complexity.

### Option B — Order entity from day one (chosen)
Introduce `Order` as the primary entity now, before RS-010 is built.
Pros: unified code path; `paymentRef` has one clear home; RS-011 (multi-photo
cart) becomes a frontend-only story — no API or Lambda changes required; no
migration when RS-011 ships; domain model is accurate from the start.
Cons: slightly more implementation in RS-010 (two tables instead of one);
PRODUCT_CONTEXT.md domain rules need updating.

### Option C — Defer to RS-011; retrofit Order then
Build RS-010 with the original per-Purchase `paymentRef` design, then migrate
when RS-011 arrives.
Pros: RS-010 simpler to build.
Cons: requires a data migration for existing Purchase records; runners who
purchased under the old model would have a different data shape than new runners;
the API contract changes between RS-010 and RS-011, requiring a versioned
endpoint or a breaking change.

## Consequences

**Positive**:
- RS-011 (multi-photo cart) is a pure frontend story — `POST /orders` already
  accepts `photoIds` as an array; the Lambda handles N photos from day one
- `paymentRef` has one unambiguous location: `Order`
- Photographer approval operates at the Order level — one approval unlocks all
  photos in the order atomically
- No migration between RS-010 and RS-011

**Negative / tradeoffs**:
- One new DynamoDB table (`racephotos-orders`) with 3 GSIs
- PRODUCT_CONTEXT.md domain rule 4 and the `Purchase` data model section must be
  updated to reflect the Order concept
- `photographerId-claimedAt-index` GSI on `racephotos-purchases` (RS-001) is
  superseded by the same GSI on `racephotos-orders` and should be removed

**New table**: `racephotos-orders`
- PK: `id`
- GSI `runnerEmail-claimedAt-index` (PK: `runnerEmail`, SK: `claimedAt`)
- GSI `photographerId-claimedAt-index` (PK: `photographerId`, SK: `claimedAt`)
- GSI `paymentRef-index` (PK: `paymentRef`)

**Updated `Purchase` model** (removes `paymentRef`, adds `orderId`):
```
orderId         string   always set — links to Order
photoId         string
runnerEmail     string   denormalized for download history lookup
downloadToken   string   UUID v4, set at approval
status          string   mirrors Order.status; set atomically at approval
claimedAt       string
approvedAt      string
```

**Stories affected**: RS-010 (create-order Lambda + purchase stepper UI),
RS-011 (multi-photo cart — frontend only)
