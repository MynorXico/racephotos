# ADR-0003: Multi-bib photos produce independent purchases
**Date**: 2026-03-28
**Status**: accepted

## Context

A single photo may capture more than one runner — common at finish line chutes,
timing mats, and crowded course sections. Amazon Rekognition may detect multiple
bib numbers in one image (e.g. bibs 101 and 102).

The question: if a photo contains two bibs, does each runner see it in their
search results, and can they each independently purchase and download it?

## Decision

**Yes.** A photo containing bibs [101, 102] appears in the search results of
**both** runner 101 and runner 102. Each runner can independently initiate a
purchase, submit a payment reference, and — after photographer approval — receive
a signed download URL for the same underlying original file.

The Purchase record links `(photo_id, runner_email)`, not `(photo_id, bib_number)`.
Two runners purchasing the same photo create two independent Purchase records.
Each Purchase has its own `paymentRef`, its own `status`, and its own approval
flow. Approving runner 101's purchase does not unlock the photo for runner 102.

The original S3 key is the same for both — the signed URL is generated fresh for
each approved purchase, scoped to that runner's session.

## Options considered

### Option A — Photo belongs to one runner only (first detected bib wins)
Pros: simpler purchase model; no ambiguity about who "owns" the photo.
Cons: unfair to runner 102 who is clearly in the photo; contradicts the
platform's core value proposition (find *your* photos); reduces revenue for
the photographer.

### Option B — Photo is shared; one purchase unlocks it for all bibs
Pros: simpler runner experience once one person pays.
Cons: incentivises free-riding (runner 102 waits for runner 101 to pay);
dramatically reduces photographer revenue; complex to implement fairly.

### Option C — Independent purchase per (photo_id, runner_email) — chosen
Pros: fair to all runners; maximises photographer revenue; aligns with the
existing data model in PRODUCT_CONTEXT.md; simple to reason about.
Cons: a runner could theoretically find the same photo via a different bib;
this is acceptable — it is the expected behaviour.

## Consequences

**Positive**:
- Photographer revenue is maximised — each runner in a photo is a potential buyer
- Data model is already correct: Purchase PK is `id`, with GSI on `(photoId, runnerEmail)`
- Search Lambda: queries `bibNumbers` array contains the searched bib — already handles multi-value arrays
- No change needed to the Photo or Purchase schema

**Negative / tradeoffs**:
- Photographer must approve potentially multiple claims for the same physical photo
- The approval dashboard must make it clear that "approved for runner A" ≠ "approved for runner B"
- Signed download URL is generated per Purchase, not per Photo — no caching shortcut

**Implementation notes**:
- `Photo.bibNumbers` is `[]string` — the search GSI must support `CONTAINS` or
  the Lambda must filter in-memory after a broader query
- DynamoDB does not support `CONTAINS` on a GSI key; the recommended pattern is
  to store one item per `(eventId, bibNumber, photoId)` in a separate index table,
  or to use a scan with filter expression on small events and a fan-out write on
  upload for large events. This is resolved in the search Lambda ADR (ADR-0004).

**Stories affected**: RS-003 (photo-processor), RS-005 (search Lambda), RS-006 (payment Lambda)
