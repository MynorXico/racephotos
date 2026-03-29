# Story: CDK SES construct + email templates

**ID**: RS-003
**Epic**: Infrastructure
**Status**: ready
**Has UI**: no

## Context

Two ADRs require SES email sending: ADR-0001 (photographer notified when a purchase claim is submitted) and ADR-0002 (runner receives claim confirmation, approval notification with download link, and re-download resend). All four email templates and the SES verified sender identity must exist before payment and download Lambda stories are implemented.

## Acceptance criteria

- [ ] AC1: Given a CDK synth runs, when `SesConstruct` is instantiated, then a SES email identity is configured for the verified sender address loaded from SSM `/racephotos/env/{envName}/ses-from-address`.
- [ ] AC2: Given a CDK synth runs, then four SES email templates are created with explicit names:
  1. `racephotos-photographer-claim-{envName}`: notifies photographer of a new purchase claim; includes runner email (masked), event name, photo reference, and link to the approvals dashboard
  2. `racephotos-runner-claim-confirmation-{envName}`: informs runner their claim was received; includes event name, photo reference, payment reference (RS-XXXX)
  3. `racephotos-runner-purchase-approved-{envName}`: informs runner their photo is approved; includes event name, permanent download link (`/download/{downloadToken}`), and a note that the link works indefinitely
  4. `racephotos-runner-redownload-resend-{envName}`: sent on re-download request; includes all active download links for the runner's approved purchases
- [ ] AC3: Given `SesConstruct` exposes a `grantSendEmail(grantee)` method, when called by a Lambda construct, then `ses:SendEmail` and `ses:SendTemplatedEmail` are granted on the verified identity ARN.
- [ ] AC4: Given `scripts/seed-ssm.sh` runs, then it prompts for `/racephotos/env/{envName}/ses-from-address` per environment.
- [ ] AC5: Given `scripts/seed-local.sh` runs, then a LocalStack SES identity is created for the local from-address (from `.env.local`).

## Out of scope

- Sending emails (handled by Lambda stories RS-010, RS-011, RS-012)
- SES production sandbox lift (manual AWS support request — documented in `docs/setup/aws-bootstrap.md`)
- HTML template design (plain text + minimal HTML in v1)

## Tech notes

- New construct file: `infra/cdk/constructs/ses-construct.ts`
- New SSM parameter: `/racephotos/env/{envName}/ses-from-address` — seeded by `seed-ssm.sh`
- New env var used by Lambdas (not introduced in this story, documented here for reference): `RACEPHOTOS_SES_FROM_ADDRESS`
- Template HTML: minimal — event name, key values, a prominent button/link. Plain text alternative required for all templates.
- `SesConstruct` props: `{ config: EnvConfig, sesFromAddress: string }` — `sesFromAddress` loaded via `ssm.StringParameter.valueFromLookup`
- `generate-cdk-context.sh` will automatically pick up the new SSM parameter on the next run
- `docs/setup/aws-bootstrap.md`: add note that SES must be moved out of sandbox mode in prod before runners can receive emails (one-time AWS support request)

## Definition of Done

### All stories

- [ ] Interface written before implementation
- [ ] Table-driven unit tests written before implementation
- [ ] Unit tests pass (`make test-unit`)
- [ ] Integration test written with `//go:build integration` tag
- [ ] Integration test passes against LocalStack (`make test-integration`)
- [ ] CDK construct updated and `cdk synth` passes
- [ ] `environments.example.ts` updated if new config key added
- [ ] `.env.example` updated if new env var added
- [ ] ADR written for any non-obvious architectural decision
- [ ] Story status set to `done`
