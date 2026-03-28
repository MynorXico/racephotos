# ADR-0002: Runner self-serve re-download via email + payment reference
**Date**: 2026-03-28
**Status**: accepted

## Context

Signed S3 download URLs have a 24-hour TTL (domain rule 6). After expiry, a runner
who has already paid cannot access their photo until a new signed URL is generated.

Two questions needed resolving:
1. Should runners re-download themselves, or contact the photographer?
2. What verification is strong enough to prevent a third party from accessing
   a runner's photos by knowing only their email address?

This matters because:
- Runners may not download immediately after approval — they may return days later
- Email addresses are not secrets — they are often publicly known or easily guessed
- The photographer has already approved the purchase — there is no new trust decision
  at re-download time, but the platform must still verify identity

## Decision

Runners **self-serve regenerate** a signed URL by providing **two factors**:

1. **Email address** — the one used when submitting the purchase claim
2. **Payment reference** (`paymentRef`) — the system-generated UUID the runner
   received during the purchase flow and used as the bank transfer description

The `paymentRef` is a UUID already scoped to the `(photo_id, runner_email)` pair
and stored in the Purchase record. The runner always has it because they used it
as their bank transfer reference — it appears in their banking app transaction
history as the payment description.

**Re-download flow:**
1. Runner visits `/redownload` (linked from their purchase confirmation, or via
   a "re-download" CTA on any event page)
2. System prompts: "Enter the email and payment reference you used for your transfer"
3. System queries Purchase table: `runnerEmail = email AND paymentRef = ref AND status = approved`
4. If matched: generate a fresh 24h signed URL and return it
5. If not matched: return a generic error — do not reveal whether the email exists

No photographer involvement. No SES email to the runner.

## Security properties

- **Email alone is not sufficient** — a third party who knows the runner's email
  gets nothing without the UUID reference
- **Reference alone is not sufficient** — the query requires both fields to match
  the same Purchase record
- **Reference is unguessable** — UUID v4, 122 bits of entropy; brute force is
  not feasible even with rate limiting disabled
- **No enumeration** — the endpoint returns the same generic error whether the
  email doesn't exist, the reference doesn't match, or the purchase is not approved

## Options considered

### Option A — Email only
Pros: simplest UX; one field to fill.
Cons: **rejected** — anyone who knows a runner's email can access their photos.
Email is not a secret.

### Option B — Email + system-generated paymentRef (chosen)
Pros: paymentRef is already in the data model and already shared with the runner
during the purchase flow; UUID is unguessable; no new infrastructure; natural UX
("enter the reference you used for your bank transfer").
Cons: runner must have saved or be able to locate their payment reference. It will
be in their banking app history as the transfer description, but runners should be
reminded to save it at purchase time.

### Option C — Email + bank's own transaction ID
Pros: runner might find this more natural ("the number my bank gave me").
Cons: the bank's transaction ID is never seen by our system — the photographer
would need to capture it manually during approval, adding friction and inconsistency
(bank ID formats vary by country and institution). Our system-generated reference
already plays this role more reliably.

### Option D — Approval email to runner with signed re-download link
Pros: zero friction — runner clicks the email.
Cons: requires SES for runner emails (currently only used for photographer
notifications); the link in the email can expire, be forwarded, or land in spam;
adds an email delivery dependency to the approval flow.

### Option E — Contact photographer
Pros: photographer retains full control.
Cons: terrible UX for a runner who has already paid; ongoing support burden for
photographers; inconsistent with the platform's promise.

## Consequences

**Positive**:
- Runners always have access to photos they paid for without photographer help
- Security is meaningfully stronger than email-only: UUID reference is not guessable
- No new infrastructure — paymentRef is already in the Purchase record
- Purchase confirmation UI must prominently display the paymentRef with a
  "Save this reference — you'll need it to re-download" instruction

**Negative / tradeoffs**:
- Runner must retain or be able to locate their paymentRef. Mitigated by:
  - Prominent display + copy-to-clipboard at purchase time
  - It appears in their banking app as the transfer description
  - The re-download page can offer a hint: "Check your banking app transfer history
    for a reference starting with RS-"
- Rate limiting still required to prevent reference brute-force across known emails:
  10 attempts per email per hour

**New endpoint**: `POST /purchases/redownload`
- Body: `{ email: string, paymentRef: string }`
- Auth: none (unauthenticated)
- Rate limit: 10 requests per email per hour (API Gateway throttling)
- Response (success): `[{ photoId, eventName, signedUrl, expiresAt }]`
- Response (failure): `{ error: "No matching purchase found" }` — same message for all failure modes

**DynamoDB access pattern**: `Query` on Purchase table using a composite condition:
`runnerEmail = :email AND paymentRef = :ref AND status = approved`.
The existing `runnerEmail` GSI covers the email lookup; `paymentRef` and `status`
are filter expressions on the result set.

**UX requirement for purchase confirmation page**: display paymentRef in a
prominent, copyable format. Show instruction: *"Save this reference — you'll need
it to re-download your photos after the 24-hour link expires."*

**Stories affected**: RS-006 (payment Lambda — redownload endpoint), RS-009 (frontend purchase flow — confirmation UX + redownload page)
