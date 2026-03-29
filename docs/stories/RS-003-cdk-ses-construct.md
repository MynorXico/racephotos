# Story: CDK SES construct + email templates

**ID**: RS-003
**Epic**: Infrastructure
**Status**: done
**Has UI**: no

## Context

Journey 3 (Runner pays and downloads) depends on two SES notification flows: the photographer is notified of each new purchase claim (ADR-0001), and the runner receives a claim confirmation, an approval notification with their permanent download link, and a re-download resend on request (ADR-0002). All four email templates and the SES verified sender identity must exist before the payment and download Lambda stories (RS-006, RS-009) are implemented.

## Acceptance criteria

- [ ] AC1: Given a CDK synth runs, when `SesConstruct` is instantiated, then a SES email identity is configured for the verified sender address loaded from SSM `/racephotos/env/{envName}/ses-from-address`.
- [ ] AC2: Given a CDK synth runs, then four SES email templates are created with explicit names:
  1. `racephotos-photographer-claim`: notifies photographer of a new purchase claim; includes runner email (masked), event name, photo reference, and link to the approvals dashboard
  2. `racephotos-runner-claim-confirmation`: informs runner their claim was received; includes event name, photo reference, payment reference (RS-XXXX)
  3. `racephotos-runner-purchase-approved`: informs runner their photo is approved; includes event name, permanent download link (`/download/{downloadToken}`), and a note that the link works indefinitely
  4. `racephotos-runner-redownload-resend`: sent on re-download request; includes all active download links for the runner's approved purchases
- [ ] AC3: Given `SesConstruct` exposes a `grantSendEmail(grantee)` method, when called by a Lambda construct, then `ses:SendEmail` and `ses:SendTemplatedEmail` are granted on the verified identity ARN.
- [ ] AC4: Given `scripts/seed-ssm.sh` runs, then it prompts for `/racephotos/env/{envName}/ses-from-address` per environment.
- [ ] AC5: Given `scripts/seed-local.sh` runs, then a LocalStack SES identity is created for the local from-address (from `.env.local`) and all four SES email templates (`racephotos-photographer-claim`, `racephotos-runner-claim-confirmation`, `racephotos-runner-purchase-approved`, `racephotos-runner-redownload-resend`) are created idempotently using `aws ses create-template --endpoint-url=http://localhost:4566`, with the script handling cases where templates already exist.

## Out of scope

- Sending emails — RS-006 (payment Lambda) sends the runner approval email and claim confirmation per ADR-0002; photographer claim notification is also sent from RS-006 per ADR-0001. Re-download resend email is handled by a separate Lambda story (RS-011 or equivalent). This story only provisions the SES identity and templates.
- SES production sandbox lift (manual AWS support request — documented in `docs/setup/aws-bootstrap.md`)
- HTML template design (plain text + minimal HTML in v1)

## Tech notes

- Lambda module path: N/A — infra-only story
- Interface(s) to implement: N/A — infra-only story
- DynamoDB access pattern: N/A — infra-only story
- ADR dependency: ADR-0001 (photographer approval via email — accepted), ADR-0002 (runner re-download via download token — accepted)
- New construct file: `infra/cdk/constructs/ses-construct.ts`
- New script: `scripts/seed-ssm.sh` — prompts contributors to populate SSM parameters per environment; must be created in this story
- New SSM parameter: `/racephotos/env/{envName}/ses-from-address` — seeded by `seed-ssm.sh`
- New env vars used by Lambdas (not introduced in this story, documented here for reference):
  - `RACEPHOTOS_SES_FROM_ADDRESS` — verified SES sender address; injected by `SesConstruct` into downstream Lambdas
  - `RACEPHOTOS_PHOTOGRAPHER_EMAIL` — destination address for approval notifications (ADR-0001); injected by RS-006 (payment Lambda)
- Template HTML: minimal — event name, key values, a prominent button/link. Plain text alternative required for all templates.
- `SesConstruct` props: `{ config: EnvConfig, sesFromAddress: string }` — `sesFromAddress` loaded via `ssm.StringParameter.valueFromLookup` in the stage, not from `EnvConfig`. **Note**: ADR-0001 specified `sesFromAddress` as a new `EnvConfig` key; this story intentionally diverges from that — storing a verified email address in `environments.ts` would expose contributor email addresses in version control. SSM is the correct layer for this value. `environments.example.ts` does **not** need a new key for this story.
- `generate-cdk-context.sh` will automatically pick up the new SSM parameter on the next run
- `docs/setup/aws-bootstrap.md`: add note that SES must be moved out of sandbox mode in prod before runners can receive emails (one-time AWS support request)

## Definition of Done

### All stories

> Note: this is a CDK TypeScript story with no Go Lambda code. The first three items apply as CDK unit tests (jest + `@aws-cdk/assertions`), not Go tests. There is no `//go:build integration` test; LocalStack coverage is provided by AC5 via `seed-local.sh`.

- [ ] Interface written before implementation
- [ ] Table-driven unit tests written before implementation
- [ ] Unit tests pass (`make test-unit`)
- [ ] Integration test written with `//go:build integration` tag
- [ ] Integration test passes against LocalStack (`make test-integration`)
- [ ] CDK construct updated and `cdk synth` passes
- [ ] `environments.example.ts` updated if new config key added
- [ ] `.env.example` updated if new env var added
- [ ] `scripts/seed-ssm.sh` created and prompts for `/racephotos/env/{envName}/ses-from-address`
- [ ] ADR written for any non-obvious architectural decision
- [ ] Story status set to `done`
