# ADR-0001: Photographer approval via email notification
**Date**: 2026-03-28
**Status**: accepted

## Context

When a runner submits a payment claim, a photographer must review and approve
or reject it before the download is unlocked. Photographers are not in the
application continuously — they may be at a race venue, in transit, or simply
away from their computer for hours after uploading photos. A passive, pull-based
review mechanism (check the dashboard later) creates friction and delays the
runner's experience.

The question: should the platform notify the photographer actively (push), or
rely on the photographer polling their dashboard (pull)?

## Decision

The payment Lambda sends an email to the photographer via **Amazon SES** when a
new purchase claim is created. The email contains:
- Runner's email (partially masked for privacy: `r***@example.com`)
- The photo identifier and event name
- The claimed payment reference
- A direct link to the in-app approval dashboard (not a one-click approve link)

The photographer clicks the link, reviews the claim in the dashboard, and
approves or rejects it there. The email is a notification only — the action
happens in-app.

> One-click approve/reject links in email are **not used** in v1. They require
> signed tokens with expiry logic, replay-attack protection, and CSRF mitigations.
> The dashboard provides these guarantees naturally via Cognito auth.

## Options considered

### Option A — In-app dashboard only (no email)
Pros: simpler infrastructure, no SES setup, no email deliverability concerns.
Cons: photographer must poll the app; runners wait indefinitely; poor experience
for the core post-race window where photographers are mobile.

### Option B — Email notification + in-app approval (chosen)
Pros: photographer is alerted immediately; works while they are away from the app;
approval still happens through a secure authenticated session.
Cons: requires SES setup and a verified sender identity; adds `RACEPHOTOS_SES_FROM_ADDRESS`
and `RACEPHOTOS_PHOTOGRAPHER_EMAIL` env vars.

### Option C — Email with one-click approve link
Pros: zero friction — photographer approves without opening the app.
Cons: significant security surface (token replay, link expiry, CSRF); out of
scope for v1 given bank-transfer payment model where fraud risk is low.

## Consequences

**Positive**:
- Photographers get real-time alerts even when away from the dashboard
- Runner wait times are reduced materially in the post-race window
- Email content is informational only — no sensitive payment data in the body

**Negative / tradeoffs**:
- Requires SES in every environment (dev, staging, prod)
- Contributor must verify a sender identity in SES before first deploy
- Two new `RACEPHOTOS_` env vars required (documented below)
- `environments.example.ts` needs `sesFromAddress` and CDK must grant the
  payment Lambda `ses:SendEmail` on the verified identity ARN

**SES scope extended by ADR-0002**: ADR-0002 (runner re-download) decided that
runners also receive emails — a claim confirmation when they submit, and an
approval notification with their download link when the photographer approves.
This means SES must be able to send to **arbitrary runner email addresses**, not
only the photographer's known address. In production this requires SES to be
moved out of sandbox mode (a one-time AWS support request). In dev/local,
SES sandbox mode can be used with verified test addresses.
See `docs/adr/0002-runner-self-serve-redownload.md` for full runner email spec.

**New env vars introduced**:
```
RACEPHOTOS_SES_FROM_ADDRESS   required — verified SES sender, e.g. noreply@example.com
RACEPHOTOS_PHOTOGRAPHER_EMAIL required — destination address for approval notifications
```

**New CDK config key introduced**:
```typescript
sesFromAddress: string   // verified SES sender identity ARN or email
```

**SES templates required** (both photographer-facing and runner-facing):
1. Photographer: new purchase claim notification (→ dashboard link)
2. Runner: claim confirmation (informational)
3. Runner: purchase approved + permanent download link
4. Runner: re-download resend (on-demand, contains all active download links)

**Stories affected**: RS-006 (payment Lambda), RS-010 (photographer dashboard)
