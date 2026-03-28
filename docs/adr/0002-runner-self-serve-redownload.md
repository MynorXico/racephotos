# ADR-0002: Runner self-serve re-download after email verification
**Date**: 2026-03-28
**Status**: accepted

## Context

Signed S3 download URLs have a 24-hour TTL (domain rule 6). After expiry, a runner
who has already paid cannot access their photo until a new signed URL is generated.

The question: should the runner be able to regenerate the URL themselves, or must
they contact the photographer?

This matters because:
- Runners may not download immediately after approval — they may return days later
- Contacting the photographer creates friction and support burden for a runner who
  has already completed payment
- The photographer has already approved the purchase — there is no new trust decision
  to make at re-download time

## Decision

Runners can **self-serve regenerate** a signed download URL at any time after their
purchase has been approved, with no photographer involvement.

The regeneration flow:
1. Runner visits their purchase history page (or a "re-download" link)
2. System prompts for the email address used at purchase time
3. System looks up all approved purchases matching that email
4. System generates a fresh 24h signed URL for each matched photo
5. Runner downloads directly — no notification sent to photographer

The email check is the sole verification. The system does **not** send a
verification email (magic link) — the email is used as a lookup key against the
Purchase record, which was established at the time of the original claim.

> Rationale: the purchase has already been approved by the photographer. Re-generating
> a URL is a mechanical operation with no new trust decision. Requiring email
> verification prevents casual URL sharing but does not need to be a full auth flow.

## Options considered

### Option A — Contact photographer
Pros: photographer retains control; simplest backend.
Cons: terrible UX for a runner who has paid; creates ongoing support burden for
photographers; inconsistent with the platform's promise to runners.

### Option B — Self-serve with email verification (chosen)
Pros: runner can always access what they paid for; zero photographer involvement
after approval; simple to implement (one DynamoDB query by runnerEmail GSI).
Cons: anyone who knows a runner's email can regenerate URLs for their photos —
acceptable given the photos are already paid for and watermark-free access was
already granted.

### Option C — Self-serve with magic-link email verification
Pros: stronger identity assurance.
Cons: requires SES integration for runner emails (currently only used for
photographer notifications); adds latency; over-engineered for the trust level
required — the email is just a lookup key, not a secret.

## Consequences

**Positive**:
- Runners always have access to photos they paid for
- Photographer is not involved in re-downloads — no support overhead
- Implementation is a single Lambda endpoint: `GET /purchases/redownload?email=...`

**Negative / tradeoffs**:
- Anyone with the runner's email address can regenerate their download links.
  Acceptable risk: the photos are personal race photos of the runner; the use
  case for a malicious actor is low.
- The re-download endpoint must be rate-limited to prevent enumeration of emails

**New endpoint introduced**: `GET /purchases/redownload`
- Query param: `email` (runner email, URL-encoded)
- Auth: none (unauthenticated, runners have no account)
- Rate limit: 10 requests per email per hour (enforced via API Gateway throttling)
- Response: list of `{ photoId, eventName, signedUrl, expiresAt }` for all approved purchases

**New DynamoDB access pattern**: query Purchase GSI by `runnerEmail` where `status = approved`

**Stories affected**: RS-006 (payment Lambda), RS-009 (frontend purchase flow)
