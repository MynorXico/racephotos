# ADR-0002: Runner re-download via long-lived download token delivered by email
**Date**: 2026-03-28
**Status**: accepted

## Context

Signed S3 download URLs have a 24-hour TTL (domain rule 6). After expiry a runner
who has already paid cannot access their photo until a new signed URL is generated.

Two earlier approaches were considered and rejected:

**Email-only verification** — rejected because email is not a secret; anyone who
knows a runner's email address could regenerate their download links.

**Email + paymentRef** — rejected because the paymentRef is the string the runner
types into their bank transfer description field, and many bank apps (particularly
in Latin American markets where this platform is likely deployed) do not show the
sender's own transfer description after the fact. The runner has no reliable way
to retrieve it later.

The core constraint: whatever the runner uses to prove ownership at re-download
time must be **reliably retrievable without depending on bank app behavior**. The
only channel we control that the runner can always access is their **email inbox**.

## Decision

Use a **long-lived download token** delivered to the runner by email when their
purchase is approved.

### How it works

**At purchase claim time:**
1. Runner selects a photo, enters their email, receives the `paymentRef` to use
   as their bank transfer description
2. System emails the runner a claim confirmation:
   *"We received your payment claim. The photographer will verify and approve it.
   Your reference: RS-XXXX (keep for your records)."*
   — informational only; runner does not need this to re-download

**At approval time:**
1. Photographer approves the claim in the dashboard
2. System generates a `downloadToken` (UUID v4) and stores it on the Purchase record
3. System emails the runner an approval notification:
   *"Your photo is ready to download.*
   *[Download photo] → racephotos.example.com/download/{downloadToken}*
   *This link works indefinitely. Bookmark it or keep this email."*
4. Runner clicks the link — Lambda generates a fresh 24h S3 presigned URL and
   redirects. From the runner's perspective the link always works.

**The 24h TTL remains on the S3 presigned URL** — a backend implementation detail
the runner never sees. The `downloadToken` itself does not expire.

**If the runner loses the approval email:**
1. Runner visits `/redownload` and enters their email address
2. System looks up all approved purchases for that email and sends a fresh email
   containing all their active download links
3. Runner clicks from the new email — no form to fill, no reference to remember
4. Rate-limited: 3 resend requests per email address per hour

### Security properties

- The download link is a UUID in the URL — 122 bits of entropy, not guessable
- A third party who knows the runner's email can trigger a resend but **cannot
  read the email** — the link goes to the runner's inbox, not the attacker's
- The S3 presigned URL generated on click is scoped to the exact S3 key with a
  24h TTL — even if a token URL leaks, the presigned URL it generates is short-lived
- Resend is rate-limited to prevent abuse

## Options considered

### Option A — Email only (no second factor)
Rejected: anyone with the runner's email can regenerate download links.

### Option B — Email + paymentRef
Rejected: paymentRef is the bank transfer description; many bank apps in the
target markets do not show the sender's own transfer description after the fact,
leaving runners with no way to retrieve it.

### Option C — Email + bank's own transaction ID
Rejected: the bank's transaction ID is never seen or stored by our system. The
photographer would need to manually capture it during approval and enter it into
the platform — friction with no automatic verification benefit.

### Option D — Long-lived download token delivered by email (chosen)
Pros: runner needs to remember nothing — the approval email is their receipt and
their permanent download link; works regardless of bank app behavior; token is
unguessable; re-download UX is a single click; lost-email recovery is a simple
"resend" flow.
Cons: requires SES to email runners (not just photographers); runner must retain
or be able to find their approval email; delivery failures (spam folder) must be
handled gracefully.

## Consequences

**Positive**:
- Runner UX is frictionless: click the link in the approval email, forever
- No dependency on bank app behavior or runner memory
- `paymentRef` retains its original purpose (photographer matches it on their
  bank statement) without doubling as a security factor
- The "lost email" recovery path is standard and familiar to users

**Negative / tradeoffs**:
- SES must now send to arbitrary runner email addresses, not just the
  photographer's verified address. Requires SES out of sandbox mode in prod
  (standard AWS support request). See ADR-0001 update.
- Email delivery is not guaranteed — spam filters, typos in email address.
  The `/redownload` resend endpoint provides recovery, but a runner with a
  mistyped email at claim time has no path. Mitigated by showing an email
  preview ("We'll send to r***@gmail.com — is this correct?") before submitting.
- `downloadToken` must be stored on the Purchase record — minor schema addition

**Data model addition** (Purchase):
```
downloadToken   string   UUID, generated at approval time, null before approval
```

**New endpoint**: `GET /download/{downloadToken}`
- Auth: none
- Behaviour: look up Purchase by `downloadToken`, verify `status = approved`,
  generate 24h S3 presigned URL, redirect (302)
- If token not found or not approved: 404

**New endpoint**: `POST /purchases/redownload-resend`
- Body: `{ email: string }`
- Auth: none
- Rate limit: 3 requests per email per hour
- Behaviour: find all approved purchases for `email`, generate fresh approval
  emails with current download links, send via SES
- Response: always 200 with generic message (no enumeration of whether email exists)

**New SES template**: runner approval email (HTML + plain text)
- Subject: "Your RaceShots photo is ready"
- Body: photo thumbnail, event name, download button → `/download/{downloadToken}`
- Plain text fallback required

**New SES template**: runner claim confirmation email
- Subject: "Payment claim received — RaceShots"
- Body: event name, photo reference, expected next steps

**Stories affected**:
- RS-006 (payment Lambda — approval flow, downloadToken generation, SES runner email)
- RS-009 (frontend purchase flow — claim confirmation UX, `/redownload` resend page,
  `/download/{token}` handler)
