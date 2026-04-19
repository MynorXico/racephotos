# Story: Runner downloads a photo via download token

**ID**: RS-012
**Epic**: Payment / Frontend
**Status**: done
**Has UI**: yes

## Context

After a purchase is approved (RS-011), the runner receives a permanent download link containing a UUID v4 token in their approval email (ADR-0002). Clicking the link generates a fresh 24-hour presigned S3 GET URL for the original unwatermarked photo and redirects the browser. If the runner loses the email, they can request a resend from `/redownload`. The `downloadToken` itself never expires — the 24-hour TTL applies only to the presigned S3 URL generated on each click, not the token.

## Acceptance criteria

- [ ] AC1: Given `GET /download/{token}` is called (no auth), when a Purchase with that `downloadToken` exists and has `status=approved`, then a 24-hour presigned S3 GET URL for the associated photo's `rawS3Key` is generated and the response is `200 { "url": "<presignedUrl>" }`. `rawS3Key` is never returned in any response body; only the presigned S3 URL is.
- [ ] AC2: Given the token does not exist or the purchase does not have `status=approved`, then 404 is returned.
- [ ] AC3: Given `POST /purchases/redownload-resend` is called with `{ email }` (no auth), when fewer than 3 requests have been made for that email in the past hour, then all approved purchases for that email are found and a fresh email is sent via SES template `racephotos-runner-redownload-resend` containing all active download links. Response is always 200 with a generic message regardless of whether any purchases exist (no email enumeration).
- [ ] AC4: Given `POST /purchases/redownload-resend` is called and the rate limit of 3 requests per email per hour is exceeded, then 429 is returned with the message "Too many requests. Please try again in an hour."
- [ ] AC5: Given a runner navigates to `/download/{token}` in the Angular app, then the page calls `GET ${apiBaseUrl}/download/${token}` via `HttpClient`, shows a "Preparing your download…" spinner while the call is in-flight, and on a 200 response sets `window.location.href = response.url` to trigger the browser download.
- [ ] AC6: Given the `GET /download/{token}` API returns 404, then the Angular page shows: "This download link is invalid. If you believe this is an error, request a new link at /redownload."
- [ ] AC7: Given a runner visits `/redownload`, then a form with an email input and submit button is shown. On a successful call: "If we have purchases for that email, you'll receive a link shortly." On 429: "Too many attempts. Please wait an hour and try again."

## Out of scope

- Token expiry (download tokens never expire per ADR-0002)
- Runner account / purchase history page (v1: email inbox is the purchase history)

## Tech notes

- New Lambda modules (one per HTTP method):
  - `lambdas/get-download/` — `GET /download/{token}`, no auth
  - `lambdas/redownload-resend/` — `POST /purchases/redownload-resend`, no auth
- Interfaces (get-download):
  ```go
  type PurchaseStore interface {
      GetPurchaseByDownloadToken(ctx context.Context, token string) (*models.Purchase, error)
  }
  type PhotoStore interface {
      GetPhotoByID(ctx context.Context, photoID string) (*models.Photo, error)
  }
  type PhotoPresigner interface {
      PresignGetObject(ctx context.Context, bucket, key string, ttl time.Duration) (string, error)
  }
  ```
- `get-download` lookup sequence: (1) query `downloadToken-index` GSI → Purchase; (2) fetch Photo by `Purchase.photoId` from `racephotos-photos` table → `Photo.rawS3Key`; (3) presign. Extra read on every download; no schema change to Purchase.
- Interfaces (redownload-resend):
  ```go
  type PurchaseStore interface {
      GetApprovedPurchasesByEmail(ctx context.Context, email string) ([]models.Purchase, error)
  }
  type RateLimitStore interface {
      IncrementAndCheck(ctx context.Context, key string, windowSeconds int, limit int) (bool, error)
  }
  type EmailSender interface {
      SendTemplatedEmail(ctx context.Context, to, template string, data map[string]string) error
  }
  ```
- Rate limiting for redownload-resend: DynamoDB table `racephotos-rate-limits` with TTL attribute (provisioned in RS-001 `DatabaseConstruct`). On each request, `UpdateItem` with PK=`REDOWNLOAD#{email}`, atomic counter increment, TTL=now+3600s. If count exceeds 3, return 429. DynamoDB TTL auto-cleans expired records.
- DynamoDB access (get-download): (1) Query `downloadToken-index` GSI on `racephotos-purchases` (PK: `downloadToken`) → Purchase; (2) `GetItem` on `racephotos-photos` by PK=`Purchase.photoId` → `Photo.rawS3Key`
- S3 presigned GET: `s3.PresignClient.PresignGetObject`, 24h TTL, scoped to exact `rawS3Key`; generated on every call to `GET /download/{token}` — not cached
- New env vars:
  ```
  RACEPHOTOS_ENV                  required — both Lambdas
  RACEPHOTOS_PURCHASES_TABLE      required — both Lambdas
  RACEPHOTOS_PHOTOS_TABLE         required — get-download only (Photo lookup for rawS3Key)
  RACEPHOTOS_RAW_BUCKET           required — get-download only (presign source bucket)
  RACEPHOTOS_SES_FROM_ADDRESS     required — redownload-resend only
  RACEPHOTOS_RATE_LIMITS_TABLE    required — redownload-resend only
  RACEPHOTOS_APP_BASE_URL         required — redownload-resend only (download link in email)
  ```
- CDK: new `DownloadConstruct`; call `SesConstruct.grantSendEmail` for `redownload-resend`; grant `get-download` Lambda `s3:GetObject` on the raw bucket (presign requires the execution role to have the permission); grant `get-download` Lambda `dynamodb:GetItem` on `racephotos-photos` and `dynamodb:Query` on `racephotos-purchases`; grant `redownload-resend` Lambda `dynamodb:Query` on `racephotos-purchases`; wire `ObservabilityConstruct` per Lambda; rate-limits table is in `DatabaseConstruct` (RS-001) — grant `redownload-resend` `dynamodb:UpdateItem` + `dynamodb:GetItem` on it
- Angular: public routes `/download/:token` and `/redownload` — no auth guard; minimal components with no NgRx slice needed (stateless flows)
  - Component files: `download-redirect.component.ts`, `redownload-request.component.ts`
  - Storybook: one story per component covering default/loading, error, and success states
- `.env.example`: add `RACEPHOTOS_RATE_LIMITS_TABLE=racephotos-rate-limits` and `RACEPHOTOS_APP_BASE_URL=http://localhost:4200`
- ADR dependencies: ADR-0002 (token design, never-expiring token, rate-limited resend — already resolved)

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
