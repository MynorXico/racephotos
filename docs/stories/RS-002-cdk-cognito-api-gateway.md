# Story: CDK Cognito + API Gateway constructs

**ID**: RS-002
**Epic**: Infrastructure
**Status**: ready
**Has UI**: no

## Context

Photographers authenticate via Amazon Cognito (ADR-0007). All photographer-facing API endpoints are protected by a JWT authorizer backed by the Cognito User Pool. This story provisions the Cognito User Pool and an API Gateway HTTP API so that Lambda stories from RS-004 onwards can add their routes without re-building auth infrastructure.

## Acceptance criteria

- [ ] AC1: Given a CDK synth runs, when `CognitoConstruct` is instantiated, then a Cognito User Pool `racephotos-photographers` is created with: email as required attribute, email verification required, self sign-up enabled, password policy (min 8 chars, upper+lower+number+symbol).
- [ ] AC2: Given a CDK synth runs, then a Cognito User Pool Client `racephotos-photographers-client` is created with no client secret (SPA), auth flows `ALLOW_USER_PASSWORD_AUTH` and `ALLOW_REFRESH_TOKEN_AUTH`.
- [ ] AC3: Given a CDK synth runs, when `ApiConstruct` is instantiated, then an API Gateway HTTP API `racephotos-api` is created with: a JWT authorizer using the Cognito User Pool, CORS configured to allow the CloudFront frontend domain (from `FrontendConstruct` output), and no routes (routes added per Lambda story).
- [ ] AC4: Given `CognitoConstruct` outputs are available, when `FrontendConstruct` is updated, then `config.json` injected into the S3 bucket includes `cognitoUserPoolId`, `cognitoClientId`, and `cognitoRegion` with real values (not placeholders).
- [ ] AC5: Given the API Gateway is deployed, then the API base URL is stored in SSM at `/racephotos/env/{envName}/api-url` and `AppConfig` in Angular reads it from `config.json`.
- [ ] AC6: Given `cdk synth` passes, then no placeholder strings remain in `FrontendConstruct`'s `config.json` for Cognito fields.
- [ ] AC7: Given `scripts/seed-local.sh` runs, then a LocalStack Cognito User Pool and client are created idempotently and their IDs are printed for `.env.local` configuration.

## Out of scope

- Cognito hosted UI (Angular uses Amplify custom auth flow — ADR-0007)
- MFA configuration (v2)
- Lambda routes (added per story)

## Tech notes

- Lambda module path: N/A — infra-only story
- Interface(s) to implement: N/A — infra-only story
- DynamoDB access pattern: N/A — infra-only story
- New env vars: none
- New construct files:
  - `infra/cdk/constructs/cognito-construct.ts`
  - `infra/cdk/constructs/api-construct.ts`
- `CognitoConstruct` outputs: `userPoolId`, `userPoolArn`, `clientId`, `region`
- `ApiConstruct` outputs: `apiUrl`, `httpApi` (IHttpApi for route attachment by Lambda constructs)
- `ApiConstruct` receives `CognitoConstruct` as a prop to wire the JWT authorizer
- `FrontendConstruct` receives `CognitoConstruct` outputs — update `FrontendConstructProps.cognitoConfig` to accept real values
- `EnvConfig` gains no new fields (Cognito outputs are wired via construct outputs, not SSM — they're known at synth time)
- `AppConfig` in Angular (`src/app/core/config/app-config.model.ts`) must include `cognitoUserPoolId`, `cognitoClientId`, `cognitoRegion`, `apiBaseUrl` — update if not already present
- CORS allowed origins: `['https://${config.domainName}']` when custom domain set, else `['https://${distribution.distributionDomainName}']`
- `seed-local.sh` Cognito setup: already created in PR6; verify it creates a pool + client and prints IDs

## Definition of Done

### All stories

> Note: this is a CDK TypeScript story with no Go Lambda code. The first three items apply as CDK unit tests (jest + `@aws-cdk/assertions`), not Go tests. There is no `//go:build integration` test; LocalStack coverage is provided by AC7 via `seed-local.sh`.

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
