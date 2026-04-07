# Story: Event management — create, view, edit, archive, share

**ID**: RS-005
**Epic**: Photo Upload / Frontend
**Status**: ready
**Has UI**: yes

## Context

Photographers must create an event before uploading photos (Journey 1, steps 1–2). An event holds the name, date, location, per-photo price, currency, and watermark text. Photographers manage their events from a dashboard, share the event URL and QR code with runners, and archive events when complete. Archived events are removed from the public listing but remain accessible via direct link (ADR-0004).

## Acceptance criteria

- [ ] AC1: Given a photographer submits `POST /events` with `{ name, date, location, pricePerPhoto, currency?, watermarkText? }`, when the request succeeds, then an Event record is created with `status="active"`, `visibility="public"`, `archivedAt=""`, `currency` defaulting to `photographer.defaultCurrency` if not provided, `watermarkText` defaulting to `"{name} · racephotos.example.com"` if not provided, and the created event is returned.
- [ ] AC2: Given a photographer submits `POST /events` with any required field missing or malformed (e.g. `name` is empty, `pricePerPhoto` is negative, `date` is not ISO 8601), then a 400 response is returned with a message identifying the invalid field(s). No event record is created.
- [ ] AC3: Given `GET /events/{id}` is called (no auth required), when the event exists (active or archived), then event details are returned: `{ id, name, date, location, pricePerPhoto, currency, watermarkText, status, createdAt }`. Returns 404 if the event does not exist.
- [ ] AC4: Given `PUT /events/{id}` is called with a valid Cognito JWT, when the caller is the event owner, then updatable fields `{ name, date, location, pricePerPhoto, currency, watermarkText }` are updated and the event is returned. Returns 403 if the caller is not the owner.
- [ ] AC5: Given `PUT /events/{id}/archive` is called with a valid Cognito JWT, when the caller is the event owner and the event is active, then `archivedAt` is set to the current UTC timestamp and `status` is set to `"archived"` and the event is returned. If the event is already archived the call is a no-op (200).
- [ ] AC6: Given `GET /photographer/me/events` is called with a valid Cognito JWT, then all events for the authenticated photographer (including archived) are returned sorted by `createdAt` DESC, paginated with cursor-based pagination (default page size 20), with a `nextCursor` field in the response when more pages exist.
- [ ] AC7: Given a photographer visits `/photographer/events`, when the page loads, then their event list is displayed with name, date, location, status badge (active/archived), and a "Create Event" button.
- [ ] AC8: Given a photographer clicks "Create Event" and submits the form, when the API call succeeds, then they are navigated to the new event's detail page at `/photographer/events/{id}`.
- [ ] AC9: Given a photographer views `/photographer/events/{id}`, then the page shows: event details, an "Edit" button, an "Archive" button (visible only when status is active), an "Upload Photos" link (navigates to the upload flow — RS-006), a "View Photos" link (navigates to the photo review queue — RS-008), and a share section containing the public event URL and a QR code.
- [ ] AC10: Given a photographer clicks "Archive", when they confirm the confirmation dialog, then `PUT /events/{id}/archive` is called and the event status updates to archived in the UI without a full page reload.
- [ ] AC11: Given the event detail page is rendered, then the QR code encodes the public event URL `/events/{id}` and is rendered client-side using `angularx-qrcode` — no Lambda call is made to generate the QR code.

## Out of scope

- Event deletion (archive is the terminal state in v1)
- Photo count and revenue stats on the event detail page (covered by RS-008)
- Public events listing page (RS-014)

## Tech notes

- New Lambda modules:
  - `lambdas/create-event/` — `POST /events`, Cognito JWT required
  - `lambdas/get-event/` — `GET /events/{id}`, no auth
  - `lambdas/update-event/` — `PUT /events/{id}`, Cognito JWT required, owner check
  - `lambdas/archive-event/` — `PUT /events/{id}/archive`, Cognito JWT required, owner check
  - `lambdas/list-photographer-events/` — `GET /photographer/me/events`, Cognito JWT required
- All five Lambdas add their routes to `ApiConstruct.httpApi` (from RS-002); get-event is added without the JWT authorizer
- New model: `shared/models/event.go`
  ```go
  type Event struct {
      ID             string  `dynamodbav:"id"`
      PhotographerID string  `dynamodbav:"photographerId"`
      Name           string  `dynamodbav:"name"`
      Date           string  `dynamodbav:"date"`           // ISO 8601
      Location       string  `dynamodbav:"location"`
      PricePerPhoto  float64 `dynamodbav:"pricePerPhoto"`
      Currency       string  `dynamodbav:"currency"`       // ISO 4217
      WatermarkText  string  `dynamodbav:"watermarkText"`
      Status         string  `dynamodbav:"status"`         // "active" | "archived"
      Visibility     string  `dynamodbav:"visibility"`     // "public" | "unlisted" — ADR-0004; v1 always "public"
      ArchivedAt     string  `dynamodbav:"archivedAt"`     // empty string if not archived
      CreatedAt      string  `dynamodbav:"createdAt"`
      UpdatedAt      string  `dynamodbav:"updatedAt"`
  }
  ```
- Interface to implement:
  ```go
  type EventStore interface {
      CreateEvent(ctx context.Context, e models.Event) error
      GetEvent(ctx context.Context, id string) (*models.Event, error)
      UpdateEvent(ctx context.Context, e models.Event) error
      ArchiveEvent(ctx context.Context, id, callerID string) (*models.Event, error)
      ListEventsByPhotographer(ctx context.Context, photographerID string, cursor string, limit int) ([]models.Event, string, error)
  }
  ```
- DynamoDB access patterns:
  - Create: `PutItem` on events table
  - Get: `GetItem` by PK=`id`
  - Update / Archive: `UpdateItem` by PK=`id` with condition expression `photographerId = :callerId` (returns 403 on `ConditionalCheckFailedException`)
  - List by photographer: `Query` on `photographerId-createdAt-index` GSI, `ScanIndexForward=false`; cursor is a base64-encoded `LastEvaluatedKey`
- `create-event` reads `photographer.defaultCurrency` from the photographers table (RS-004) via a `GetItem` before writing the event — requires read access to the photographers table
- New env vars:
  ```
  RACEPHOTOS_ENV                   required — "local"|"dev"|"qa"|"staging"|"prod"
  RACEPHOTOS_EVENTS_TABLE          required — DynamoDB events table name
  RACEPHOTOS_PHOTOGRAPHERS_TABLE   required — DynamoDB photographers table name (create-event only; already in .env.example from RS-004)
  ```
- CDK: new `EventConstruct` in `infra/cdk/constructs/event-construct.ts`
  - Five Lambda functions, each wrapped with `ObservabilityConstruct`
  - IAM grants: events table write (`dynamodb:PutItem`) for create-event; events table read (`dynamodb:GetItem`) for get-event; events table read+write (`dynamodb:GetItem`, `dynamodb:UpdateItem`) for update-event and archive-event; events table query (`dynamodb:Query`) for list-photographer-events; photographers table read (`dynamodb:GetItem`) for create-event
  - `photographerId-createdAt-index` GSI defined on the events table with `photographerId` as partition key and `createdAt` as sort key
- Angular:
  - QR code library: `angularx-qrcode` — install with `npm install angularx-qrcode`
  - Routes (inside photographer feature module, lazy-loaded, behind `AuthGuard`):
    - `/photographer/events` — event list
    - `/photographer/events/new` — create event form
    - `/photographer/events/:id` — event detail + share section
    - `/photographer/events/:id/edit` — edit event form
  - Components:
    - `src/app/features/photographer/events/event-list/event-list.component.ts`
    - `src/app/features/photographer/events/event-create/event-create.component.ts`
    - `src/app/features/photographer/events/event-detail/event-detail.component.ts`
    - `src/app/features/photographer/events/event-edit/event-edit.component.ts`
    - `src/app/features/photographer/events/event-archive-dialog/event-archive-dialog.component.ts` — Angular Material confirmation dialog
  - NgRx:
    - `store/events/events.actions.ts` — `loadEvents`, `loadEventsSuccess`, `loadEventsFailure`, `createEvent`, `createEventSuccess`, `createEventFailure`, `updateEvent`, `updateEventSuccess`, `updateEventFailure`, `archiveEvent`, `archiveEventSuccess`, `archiveEventFailure`, `loadEvent`, `loadEventSuccess`, `loadEventFailure`
    - `store/events/events.effects.ts` — calls API via `AppConfigService.apiBaseUrl`
    - `store/events/events.reducer.ts` — state shape: `{ events: Event[], selectedEvent: Event | null, loading: boolean, error: string | null }`
    - `store/events/events.selectors.ts`
- `.env.example`: add `RACEPHOTOS_EVENTS_TABLE=racephotos-events`
- `environments.example.ts`: no new keys required

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

### UI stories only

- [ ] Angular component compiles with `ng build --aot` (zero errors, zero warnings)
- [ ] Angular unit tests pass (`ng test --watch=false --code-coverage`)
  - Component logic: >80% line coverage
- [ ] Storybook story written for every new component (`*.stories.ts`)
- [ ] `npx storybook build` passes (no broken renders)
- [ ] Playwright E2E test written covering all acceptance criteria
- [ ] Playwright test passes against local dev server (`npx playwright test`)
- [ ] Playwright screenshot snapshot committed (visual baseline)
- [ ] Responsive layout verified at 375px (mobile) and 1280px (desktop) via Playwright
