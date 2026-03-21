# PRODUCT_CONTEXT.md — RaceShots

This file gives Claude the product context it needs to act as Product Owner,
UX Designer, or Domain Expert. Read this before generating user stories, ADRs,
UI specs, or any feature that touches business logic.

RaceShots is an open-source project. The product must be deployable by any
individual photographer or photography business without changes to application
code. All infrastructure values are contributor-supplied at deploy time.

---

## What is RaceShots?

RaceShots is an open-source SaaS platform that connects race event photographers
with the runners they photograph. Photographers upload thousands of photos after
a race. Runners search for their photos by bib number. AI (Amazon Rekognition)
reads bib numbers automatically so runners never need to scroll through galleries.

Runners see watermarked previews for free. They pay per photo directly to the
photographer via bank transfer. Once they submit their payment reference, the
photo is unlocked for full-resolution download.

The platform takes no payment processing cut. Photographers keep 100% of revenue
and use their own bank accounts. The platform's value is in the discovery and
delivery experience.

---

## The two personas

### Photographer (supplier)
- Professional or semi-professional race photographer
- Shoots hundreds to thousands of photos per event (5,000+ is common at large races)
- Uploads in bulk immediately after the race, often on slow venue WiFi
- Wants photos watermarked by default to protect their work
- Wants to be paid directly — no platform middleman
- Manages multiple events per year, sometimes several per month
- Technically capable but not a developer — the upload UI must be simple
- Primary frustration: runners can't find their photos in large unindexed galleries

### Runner (buyer)
- Completed a race and wants a professional photo of themselves
- Knows only their bib number — that is their sole identifier
- Expects search results in seconds
- May be unfamiliar with bank transfer flows — needs clear, step-by-step instructions
- Wants to pay for individual photos, not a full gallery subscription
- Primary frustration: paying for something and not being able to access it

---

## Core user journeys

### Journey 1 — Photographer uploads event photos
1. Photographer logs in (Cognito) and creates an event (name, date, location)
2. Photographer configures watermark style and per-photo price for the event
3. Photographer uploads photos in bulk via drag-and-drop
4. For each photo, the system returns a presigned S3 PUT URL — upload goes direct to S3
5. Each uploaded photo triggers async processing:
    - Amazon Rekognition runs `DetectText` on the photo
    - Bib numbers above the confidence threshold are extracted
    - A text watermark (event name + placeholder logo) is applied
    - Watermarked photo is stored in the processed S3 bucket
    - Metadata (bib numbers, event, S3 keys, status, timestamp) is written to DynamoDB
6. Photos with no confident bib detection land in the photographer's review queue
7. Photographer manually tags bib numbers for undetected photos
8. Photographer shares the event search URL or QR code with runners

### Journey 2 — Runner searches and previews
1. Runner opens the event search page (via shared link or QR code at the finish line)
2. Runner types their bib number — no account required
3. System queries DynamoDB via bib number GSI and returns watermarked photo URLs
4. Runner sees a grid of their photos, each with a text watermark overlay
5. Runner clicks a photo to see a larger preview and payment instructions

### Journey 3 — Runner pays and downloads (per photo)
1. Runner selects a photo they want to purchase
2. System displays the photographer's bank transfer details and a unique payment reference
   — the reference is scoped to the specific (photo_id, runner_email) pair
3. Runner opens their banking app, makes the transfer, returns to RaceShots
4. Runner enters their email and the transfer reference they used
5. System records the purchase claim in DynamoDB with status `pending`
6. Photographer receives a notification and approves the claim
7. System marks the photo as unlocked for that runner and generates a signed S3 URL (24h TTL)
8. Runner downloads the unwatermarked full-resolution original
9. If the signed URL expires, the runner can request a new one from their purchase history

---

## Payment model

**Per photo** — runners pay for individual photos. Each photo has a price set
by the photographer at the event level (e.g. Q75 per photo, or $5 per photo).

The platform does NOT process payments in v1. Bank transfer only. The platform
records claims and unlocks downloads after photographer approval.

A single payment reference is generated per (photo_id, runner_email) pair.
This means if a runner wants 3 photos, they make 3 transfers with 3 different
references — one per photo.

Future (v2): payment provider integration (Stripe or regional equivalent) to
automate verification and eliminate the manual approval step.

---

## Watermark

- Style: **text overlay** — event name on one line, a placeholder for the
  photographer's logo or studio name on a second line
- Applied during async processing, not at query time
- Rendered on the watermarked copy stored in the processed S3 bucket
- The original unwatermarked photo is stored in a separate private S3 bucket
  and is never publicly accessible — only delivered via short-lived signed URL
  after payment is approved

Watermark text content is configured per event by the photographer. The default
when no custom text is set: `{event_name} · racephotos.example.com`.

---

## Domain rules (enforce in all code and stories)

1. A photo belongs to exactly one event
2. A photo may have zero or more detected bib numbers (some photos capture multiple runners)
3. A photo's locked/unlocked state is per runner — not global
4. A purchase links one `photo_id` to one `runner_email` with one `payment_reference`
5. Payment references are unique per (photo_id, runner_email) — generated by the system, not the runner
6. Signed download URLs expire after 24 hours; runners may regenerate them
7. The private S3 bucket (original photos) is never publicly accessible — Lambda execution role only
8. Processing is always async — upload endpoints never wait for Rekognition
9. Photos with processing errors surface in the photographer's review queue — never silently dropped
10. Rekognition is called exactly once per photo — result is cached in DynamoDB, never re-called
11. Bib confidence threshold is configurable per environment — lower in dev, higher in prod
12. Manual photographer tagging overrides Rekognition output — treated as ground truth

---

## Data model (conceptual)

### Event
```
id              string   PK
photographerId  string   GSI partition key
name            string
date            string   ISO 8601
location        string
pricePerPhoto   number
currency        string   e.g. "GTQ", "USD", "EUR"
watermarkText   string   displayed on watermark overlay
createdAt       string
```

### Photo
```
id                   string    PK
eventId              string    GSI partition key
bibNumbers           []string  detected or manually tagged
status               "processing" | "indexed" | "review_required" | "error"
rawS3Key             string    private bucket — never exposed in API responses
watermarkedS3Key     string    processed bucket — served via CloudFront
rekognitionConfidence number   highest confidence score from detection
capturedAt           string    EXIF timestamp if available
uploadedAt           string
```

### Purchase
```
id              string   PK
photoId         string   GSI partition key
runnerEmail     string   GSI sort key (for runner purchase history)
paymentRef      string   system-generated unique reference shown to runner
status          "pending" | "approved" | "rejected"
claimedAt       string   when runner submitted the reference
approvedAt      string   when photographer approved
```

---

## Non-functional requirements

### Scale
- Up to 5,000 photos per event uploaded within a 2-hour post-race window
- SQS decouples upload from processing — the pipeline absorbs burst without throttling
- DynamoDB on-demand capacity — no manual scaling required
- S3 has no practical upload limit — presigned URLs handle direct-to-S3 upload

### Latency targets
- Presigned URL generation: < 300ms p99
- Bib search query: < 500ms p99
- Watermarked photo load via CloudFront: < 2s globally

### Security
- Photographers authenticate via Amazon Cognito User Pools
- Runners are unauthenticated for search — identified by email at purchase time only
- Private S3 bucket: block all public access, Lambda role access only
- Signed download URLs: scoped to exact S3 key, 24-hour TTL, no wildcard paths
- Payment references: system-generated UUIDs — runners cannot guess another runner's reference

### Cost awareness for self-hosters
- Rekognition: charged per image — call once, cache forever in DynamoDB
- S3: two buckets with lifecycle rules to expire old originals per `photoRetentionDays`
- CloudFront: all watermarked previews go through CloudFront — never direct S3
- Lambda: on-demand pricing, no provisioned concurrency needed in v1

---

## Out of scope for v1

- Payment processing (Stripe, etc.) — bank transfer + manual approval only
- Mobile native app — Angular web only (responsive)
- Video support — photos only
- AI duplicate detection — v2 feature
- Multi-region deployment — single region per deployment
- Photographer analytics dashboard
- Runner accounts / profiles — purchase tied to email only
- Social sharing of race photos

---

## Open decisions (resolve before writing stories that depend on them)

- [ ] Photographer approval UX — email notification with approve link, or in-app dashboard only?
- [ ] Runner re-download UX — self-serve link regeneration, or contact photographer?
- [ ] Watermark asset — photographer uploads a logo image, or text-only initially?
- [ ] Multi-bib photos — if a photo contains bib 101 and 102, does each runner
  see it in their results and pay separately for the same photo?
- [ ] Event visibility — are events publicly listed or only accessible via direct link?

---

## Tech stack (for reference)

| Layer | Technology |
|---|---|
| Lambda runtime | Go 1.22+ |
| Infrastructure as code | AWS CDK (TypeScript) |
| Database | DynamoDB (on-demand) |
| Object storage | S3 (two buckets: private originals, processed watermarked) |
| Message queue | SQS + Dead Letter Queue |
| AI bib detection | Amazon Rekognition (`DetectText`) |
| Authentication | Amazon Cognito User Pools (photographers only) |
| CDN | Amazon CloudFront |
| Frontend | Angular 17+ |
| Local development | LocalStack via docker-compose |
| CI/CD | GitHub Actions + AWS CDK Pipelines |
| Observability | CloudWatch Logs, CloudWatch Alarms, AWS X-Ray |

---

## Environment summary

| Env | Who sets it up | Purpose | Deploy trigger |
|---|---|---|---|
| local | Any contributor | Dev loop via LocalStack | manual |
| dev | Project maintainer | Live AWS, auto-deploy | merge to main |
| qa | Project maintainer | Integration + load tests | auto after dev green |
| staging | Project maintainer | Pre-prod mirror | manual approval |
| prod | Project maintainer | Live product | manual approval |

Self-hosters typically only need dev and prod. The pipeline is designed so
unused environments can simply be omitted from `environments.ts`.
