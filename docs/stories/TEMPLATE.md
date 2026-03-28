# Story: <title>
**ID**: RS-000
**Epic**: <Photo Upload | Photo Processing | Search | Payment | Frontend | Infrastructure>
**Status**: draft | ready | in-progress | done
**Has UI**: yes | no

## Context
<!-- 2-3 sentences. Reference the relevant journey in PRODUCT_CONTEXT.md. -->

## Acceptance criteria
- [ ] AC1: Given … When … Then …
- [ ] AC2: …

## Out of scope
- …

## Tech notes
- Lambda / service: `lambdas/<name>/`
- Interface(s) to implement: e.g. `S3Presigner`, `PhotoStore`
- DynamoDB access pattern: e.g. "query by bib GSI"
- New env vars: e.g. `RACEPHOTOS_RAW_BUCKET`
- CDK construct to update: e.g. `PhotoStorageConstruct`
- ADR dependency: e.g. "requires ADR-0003 to be resolved first"

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

### UI stories only (skip if Has UI: no)
- [ ] Angular component compiles with `ng build --aot` (zero errors, zero warnings)
- [ ] Angular unit tests pass (`ng test --watch=false --code-coverage`)
  - Component logic: >80% line coverage
- [ ] Storybook story written for every new component (`*.stories.ts`)
- [ ] `npx storybook build` passes (no broken renders)
- [ ] Playwright E2E test written covering all acceptance criteria
- [ ] Playwright test passes against local dev server (`npx playwright test`)
- [ ] Playwright screenshot snapshot committed (visual baseline)
- [ ] Responsive layout verified at 375px (mobile) and 1280px (desktop) via Playwright
