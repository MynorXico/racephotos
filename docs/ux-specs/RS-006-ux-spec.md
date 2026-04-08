# UX Spec — RS-006: Bulk photo upload

**Story**: RS-006
**Persona**: Photographer — desktop-first power user, uploads hundreds to thousands of photos immediately after a race, often on slow venue WiFi
**Date**: 2026-04-07
**Status**: draft

---

## Overview

This spec covers one component delivered by RS-006:

1. `EventUploadComponent` — `/photographer/events/:id/upload` — drag-and-drop bulk upload UI

The component lives inside the `PhotographerLayoutComponent` shell established in RS-004. It is lazy-loaded behind `authGuard`. The `NavigationTitleService` pattern applies — the component calls `titleService.setTitle('Upload Photos')` in `ngOnInit`.

The component is the only place where photo upload is initiated. It never calls HTTP directly. All presign requests and S3 PUT uploads are initiated by dispatching NgRx actions; Effects in `store/photo-upload/` own the async work and feed progress back into the store.

A new NgRx slice — `store/photo-upload/` — must be generated before the component. The state shape, actions, selectors, and effects required are specified in the NgRx Integration section below.

---

## NgRx slice: `store/photo-upload/`

### State shape

```typescript
interface PhotoUploadState {
  total: number;          // total files selected for the current upload session
  uploaded: number;       // count of files whose S3 PUT succeeded
  failed: FailedFile[];   // files whose S3 PUT failed (after one attempt)
  inProgress: boolean;    // true from first presign request until all PUTs finish or fail
  presignError: string | null;  // non-null when the /presign API call itself fails
}

interface FailedFile {
  file: File;
  errorMessage: string;
}
```

### Actions (all defined in `store/photo-upload/photo-upload.actions.ts`)

| Action | Props | Dispatched by |
|---|---|---|
| `PhotoUploadActions['Upload Files']` | `{ files: File[] }` | Component — on drop or file-input change |
| `PhotoUploadActions['Presign Batch']` | `{ batch: File[] }` | Effect — called internally once per 100-file batch |
| `PhotoUploadActions['Presign Batch Success']` | `{ presignedFiles: PresignedFile[] }` | Effect — on API success |
| `PhotoUploadActions['Presign Batch Failure']` | `{ error: string }` | Effect — on API error |
| `PhotoUploadActions['File Upload Progress']` | `{ uploadedCount: number }` | Effect — after each individual S3 PUT succeeds |
| `PhotoUploadActions['File Upload Failed']` | `{ file: File; errorMessage: string }` | Effect — after each individual S3 PUT fails |
| `PhotoUploadActions['Retry File']` | `{ file: File }` | Component — on per-file Retry button click |
| `PhotoUploadActions['Reset Upload']` | `{}` | Component — on navigating away or starting a new upload session |

`PresignedFile` is a local interface: `{ file: File; photoId: string; presignedUrl: string }`.

### Selectors (all in `store/photo-upload/photo-upload.selectors.ts`)

| Selector | Returns |
|---|---|
| `selectUploadTotal` | `number` |
| `selectUploadedCount` | `number` |
| `selectFailedFiles` | `FailedFile[]` |
| `selectUploadInProgress` | `boolean` |
| `selectPresignError` | `string \| null` |
| `selectUploadComplete` | `boolean` — true when `!inProgress && total > 0 && uploaded + failed.length === total` |
| `selectHasFailures` | `boolean` — true when `failed.length > 0` |

---

## Component: `EventUploadComponent`

**Path**: `src/app/features/photographer/event-upload/event-upload.component.ts`
**Route**: `/photographer/events/:id/upload`
**Module**: lazy-loaded standalone component; registers `photoUploadFeature` via `provideState()` in the component's `providers` array

### Purpose

Allows the authenticated photographer to bulk-upload JPEG and PNG photos to an event by dragging files onto a drop zone or selecting them via a file picker; shows real-time upload progress, lists failed files with individual retry buttons, and links to the photo list on completion.

---

### Layout — 1280px (desktop)

The component renders inside the `PhotographerLayoutComponent` content area. Max content width: `800px`, centred with `auto` left/right margin and `32px` top padding.

Structure top to bottom:

1. **Breadcrumb / page header row** — `display: flex`, `align-items: center`, `gap: 8px`, `margin-bottom: 24px`.
   - Back arrow icon button (`mat-icon-button`, icon: `arrow_back`, `aria-label="Back to event"`) that navigates to `/photographer/events/:id`.
   - Heading "Upload Photos" in `mat-headline-small`, immediately to the right of the back button.
   - Subheading line below the heading (smaller type, `mat-body-medium`, `var(--mat-sys-on-surface-variant)`): event name, loaded via `selectSelectedEvent` from the events slice. Renders as a single line of plain text, not a link.

2. **Drop zone card** — a `MatCard` with dashed border (`2px dashed var(--mat-sys-outline)`), `border-radius: 12px`, `padding: 48px 24px`, full-width within the content column. The entire card surface is the interactive drop target.

   Content inside the card, centred vertically and horizontally:
   - `mat-icon` icon `cloud_upload`, size `64px`, colour `var(--mat-sys-primary)`.
   - Heading text: "Drag photos here" in `mat-title-medium`.
   - Secondary text: "JPEG and PNG only · or" in `mat-body-medium`, `var(--mat-sys-on-surface-variant)`.
   - "Browse files" `mat-stroked-button` — triggers a hidden `<input type="file" multiple accept="image/jpeg,image/png">`. The button has `aria-label="Browse and select photo files"`.

   **Active drag state** (while files are being dragged over the zone): the card border colour changes to `var(--mat-sys-primary)` and the background to `var(--mat-sys-primary-container)`. Applied via a host binding on the `dragover` event; removed on `dragleave` and `drop`. The icon colour transitions with the background.

   The drop zone is hidden (replaced by the progress panel or the result panel) when `selectUploadInProgress` or `selectUploadComplete` is true.

3. **Progress panel** — visible only when `selectUploadInProgress` is true; replaces the drop zone in the same vertical position.

   Content:
   - `MatProgressBar` in `determinate` mode. Value: `(uploaded / total) * 100`. Full card width. `aria-label="Upload progress"`, `aria-valuenow` bound to the integer percentage, `aria-valuemin="0"`, `aria-valuemax="100"`.
   - Counter text below the bar: "**X** of **N** photos uploaded" where X = `selectUploadedCount` and N = `selectUploadTotal`. `mat-body-large`, centred. The numbers are wrapped in `<strong>` for semantic emphasis.
   - A supplemental line of smaller text below the counter: "Do not close this tab while uploading." `mat-body-small`, `var(--mat-sys-error)` colour, prefixed with `mat-icon` `warning` at `16px` inline.

4. **Failed files list** — visible only when `selectHasFailures` is true AND `selectUploadInProgress` is false. Rendered below the progress panel (or below the drop zone if the upload already finished). Maximum height `320px` with `overflow-y: auto`.

   Structure:
   - Section heading: "Failed uploads" in `mat-title-small`, `var(--mat-sys-error)`, with a `mat-icon` `error_outline` (18px) inline to its left. The heading is always visible when the section is open — it does not scroll with the list.
   - `MatList` (`mat-list`) with one `mat-list-item` per failed file.

   Each list item contains:
   - Leading `mat-icon` `broken_image`, `var(--mat-sys-error)`, 24px.
   - Primary line: filename truncated to one line with `text-overflow: ellipsis`. `mat-body-medium`.
   - Secondary line: `errorMessage` from the `FailedFile` record. `mat-body-small`, `var(--mat-sys-on-surface-variant)`.
   - Trailing "Retry" `mat-stroked-button` with `color="warn"`. `aria-label` is dynamically set: `"Retry upload for {filename}"`.

   A "Retry all failed" `mat-flat-button` with `color="warn"` and icon prefix `refresh` is positioned in the top-right of the section heading row. It dispatches `PhotoUploadActions['Upload Files']` with all files currently in `selectFailedFiles`. `aria-label="Retry all failed uploads"`.

5. **Success panel** — visible only when `selectUploadComplete` is true AND `selectHasFailures` is false.

   Content, centred:
   - `mat-icon` `check_circle`, `64px`, `var(--mat-sys-tertiary)`.
   - Heading: "Upload complete" in `mat-title-large`.
   - Body text: "**N** photos uploaded successfully." where N = `selectUploadTotal`. `mat-body-large`.
   - "View photos" `mat-flat-button` (primary colour) navigating to `/photographer/events/:id/photos`. `aria-label="View uploaded photos for this event"`.

6. **Partial-failure success panel** — visible only when `selectUploadComplete` is true AND `selectHasFailures` is true. This variant replaces the success panel above.

   Content, centred:
   - `mat-icon` `warning_amber`, `64px`, `var(--mat-sys-tertiary)`.
   - Heading: "Upload finished with errors" in `mat-title-large`.
   - Body text: "**X** of **N** photos uploaded. **F** failed." `mat-body-large`.
   - The failed files list (panel 4 above) is shown directly below this heading — the two panels coexist in this state.
   - "View photos" `mat-stroked-button` navigating to `/photographer/events/:id/photos`.

7. **Presign error banner** — visible only when `selectPresignError` is non-null. Rendered as an inline `MatCard` with `background: var(--mat-sys-error-container)`, `color: var(--mat-sys-on-error-container)`, `role="alert"`, `aria-live="assertive"`.
   - Leading `mat-icon` `error` (20px).
   - Text: "Could not request upload URLs. {presignError}".
   - A "Try again" `mat-stroked-button` that re-dispatches `PhotoUploadActions['Upload Files']` with the original file list (cached in component state).

---

### States

#### Loading (presigning)

The drop zone is replaced by the progress panel immediately when `selectUploadInProgress` becomes true. The `MatProgressBar` is in `buffer` mode with indeterminate buffering until the first `File Upload Progress` action arrives, at which point it switches to `determinate` mode. The counter shows "0 of N photos uploaded" until the first success.

#### Empty / idle

The drop zone card is shown with its full browse-files affordance. The progress panel, failed files list, and success panel are all hidden. No skeleton loaders are needed — the component is usable immediately on route activation.

#### Uploading (in-progress)

The drop zone is hidden. The progress panel is shown with a live-updating `MatProgressBar` and counter text. If any individual file has already failed while others are still uploading, the failed files list is NOT shown yet — it only appears after `inProgress` becomes false to avoid mid-session distraction.

#### Partial-failure (complete with failures)

`selectUploadComplete` is true, `selectHasFailures` is true. The partial-failure heading panel is shown above the failed files list. The progress bar is hidden.

#### Complete (all succeeded)

`selectUploadComplete` is true, `selectHasFailures` is false. The success panel is shown with the "View photos" link. The drop zone and progress bar are hidden.

#### Error (presign API failure)

The presign error banner appears above the drop zone. The drop zone itself remains visible so the photographer can try again without refreshing the page.

---

### Responsive behaviour

#### 375px (mobile)

The content column expands to full viewport width with `16px` horizontal padding. Max-width constraint is removed.

- The breadcrumb row stacks: the back button sits alone on a row above the heading, both left-aligned. The event name subheading wraps to a second line if needed.
- The drop zone card reduces top/bottom padding to `32px 16px`. The "Drag photos here" heading shrinks to `mat-title-small`. The drag instruction text is shortened to "JPEG and PNG only" — the "or" connector and "Browse files" button move to a new centred row below.
- The "Browse files" button expands to full width (`width: 100%`) for easier touch targeting (minimum 48px height per Material touch target guidelines).
- The progress panel counter text wraps to two lines if needed; no truncation.
- Failed files list items: the filename and error message stack vertically. The "Retry" button moves below the filename/error block, right-aligned, maintaining a 48px minimum touch target.
- The "Retry all failed" button expands to full width below the section heading.
- The success and partial-failure panels centre their content with the icon above the text — no layout changes needed beyond the column width.

#### 1280px (desktop)

The default layout described in the Layout section above.

---

### Accessibility

- The drop zone `MatCard` element has `role="region"` and `aria-label="Photo upload drop zone"`.
- The card is keyboard-focusable (`tabindex="0"`). When focused, pressing `Enter` or `Space` opens the file picker (same behaviour as clicking "Browse files"). This is noted in the visible hint text.
- The hidden `<input type="file">` is visually hidden with `cdk-visually-hidden` (not `display: none`) so that it remains operable by screen readers if they interact with it directly.
- `MatProgressBar` carries `aria-label="Upload progress"` with live `aria-valuenow` updates. The counter paragraph below the bar has `aria-live="polite"` so screen readers announce "X of N photos uploaded" as it updates, without interrupting.
- The presign error banner carries `role="alert"` and `aria-live="assertive"` so it is announced immediately when it appears.
- The success panel heading "Upload complete" carries `aria-live="polite"` so screen reader users are notified when all uploads finish.
- Colour is never the sole indicator: failed files use the `broken_image` icon alongside the error colour; the success panel uses the `check_circle` icon alongside the success colour.
- Focus management on completion: when the success panel becomes visible, focus is programmatically moved to the "View photos" button using `@ViewChild` + `nativeElement.focus()` inside the subscription that detects `selectUploadComplete` transitioning to true.
- Focus management on error: when the presign error banner becomes visible, focus moves to the "Try again" button.
- All `mat-icon-button` elements have explicit `aria-label` attributes — Angular Material's `aria-label` input is used, not a sibling `<span>`.
- The "Retry" buttons in the failed files list each have a unique dynamic `aria-label="Retry upload for {filename}"` to distinguish them for screen reader users.
- The file picker `<input>` has `aria-label="Select photo files to upload"`.
- Tab order top to bottom: back button → drop zone (or progress region) → failed file retry buttons (if any) → retry-all button → view-photos button.

---

### Angular Material components to use

| Component | Usage |
|---|---|
| `MatCard`, `MatCardContent` | Drop zone container, presign error banner, success/partial-failure panel |
| `MatButton` (`mat-flat-button`, `mat-stroked-button`) | Browse files, Retry, Retry all, View photos, Try again |
| `MatIconButton` (`mat-icon-button`) | Back navigation button |
| `MatIcon` | All icons: `arrow_back`, `cloud_upload`, `check_circle`, `warning_amber`, `error_outline`, `broken_image`, `warning`, `error`, `refresh` |
| `MatProgressBar` | Determinate/buffer upload progress bar |
| `MatList`, `MatListItem` | Failed files list |

Do not use `MatProgressSpinner` — the determinate `MatProgressBar` communicates both percentage and the "X of N" counter more effectively for a bulk file operation. Do not use `MatSnackBar` for upload completion — the success panel is persistent and contains the "View photos" CTA which must not auto-dismiss.

---

### NgRx integration

#### Selectors subscribed to (via `store.select(...)` or `toSignal(...)`)

| Selector | Used for |
|---|---|
| `selectUploadTotal` | Counter denominator in progress panel and success panel |
| `selectUploadedCount` | Counter numerator in progress panel; progress bar value |
| `selectFailedFiles` | Failed files list items |
| `selectUploadInProgress` | Show/hide progress panel; disable drop zone interaction |
| `selectPresignError` | Show/hide presign error banner |
| `selectUploadComplete` | Show/hide success or partial-failure panel; trigger focus management |
| `selectHasFailures` | Choose between success panel and partial-failure panel variant |
| `selectSelectedEvent` (from events slice) | Display event name in the subheading; provide eventId for navigation |
| `selectEventsLoading` (from events slice) | Show a single-line `MatProgressBar` in `indeterminate` mode inside the breadcrumb row while the event is loading, replacing the event name with a skeleton shimmer |

#### Actions dispatched

| User event | Action dispatched |
|---|---|
| Files dropped onto drop zone | `PhotoUploadActions['Upload Files']({ files })` |
| File picker input `change` event | `PhotoUploadActions['Upload Files']({ files })` |
| Per-file "Retry" button clicked | `PhotoUploadActions['Retry File']({ file })` |
| "Retry all failed" button clicked | `PhotoUploadActions['Upload Files']({ files: failedFiles.map(f => f.file) })` |
| "Try again" button in presign error banner | `PhotoUploadActions['Upload Files']({ files: lastAttemptedFiles })` — component caches the last `files` array in a private field for this purpose |
| Component `ngOnDestroy` | `PhotoUploadActions['Reset Upload']({})` — clears the upload slice state when navigating away |
| Route activated (`ngOnInit`) | `EventsActions['Load Event']({ id: eventId })` — reads `:id` from `ActivatedRoute.paramMap`; ensures the event name is available for the subheading even on direct navigation to this URL |

The component must cache the most recent `files` array in a private `lastAttemptedFiles: File[]` field — this is local component state, not store state — to support the "Try again" flow in the presign error banner without requiring the store to hold `File` objects (which are not serialisable).

---

### Storybook stories (`event-upload.component.stories.ts`)

Four stories are required, matching the states named in the story's tech notes:

| Story export name | `photoUpload` slice state | `events` slice state |
|---|---|---|
| `Idle` | `{ total: 0, uploaded: 0, failed: [], inProgress: false, presignError: null }` | `selectedEvent: mockEvent, loading: false` |
| `Uploading` | `{ total: 120, uploaded: 37, failed: [], inProgress: true, presignError: null }` | `selectedEvent: mockEvent, loading: false` |
| `PartialFailure` | `{ total: 120, uploaded: 115, failed: [mockFailedFile1, mockFailedFile2, mockFailedFile3], inProgress: false, presignError: null }` | `selectedEvent: mockEvent, loading: false` |
| `Complete` | `{ total: 120, uploaded: 120, failed: [], inProgress: false, presignError: null }` | `selectedEvent: mockEvent, loading: false` |

A fifth story `PresignError` is recommended (see UX decisions below).

`mockFailedFile1/2/3` are constructed as `new File([], 'IMG_1234.jpg', { type: 'image/jpeg' })` etc. inside the story file. The `FailedFile.errorMessage` should be distinct per file to exercise truncation and wrapping (e.g. `"Network error: upload timed out"`, `"Server error: 503 Service Unavailable"`, `"Network error: connection reset"`).

---

## UX decisions not explicitly stated in the story ACs

The following decisions were made during spec authoring. The team should review and confirm before implementation begins.

**UX-D1 — Partial-failure panel is a variant, not a separate state.**
AC7 describes a success state and AC8 describes a failure state as if they were mutually exclusive. In practice, some files may succeed and some fail in a single session. This spec defines a combined "partial-failure" panel that shows both the success count and the failed files list. If the team considers this confusing, the alternative is to always show the failed files list alongside the success panel when both are present, without the separate heading — either approach is acceptable.

**UX-D2 — Failed files list is shown only after `inProgress` becomes false.**
Files that fail mid-session are not listed in real time. This avoids the distraction of a growing failure list while most files are still uploading. The failed count is not surfaced during upload — only total/uploaded are shown. If the team wants a live failure count during upload (e.g. "37 of 120 uploaded, 2 failed"), the progress panel counter line and state should be updated accordingly.

**UX-D3 — No file-count client-side validation UI before dispatch.**
AC5 states files are chunked into batches of 100. The client does not reject large file sets — it simply batches them. There is no warning like "You are uploading 500 files". If the team wants a confirmation step before a very large upload begins, a `MatDialog` confirmation should be added when `files.length > 200`, asking the photographer to confirm.

**UX-D4 — No client-side file size limit UI.**
The spec does not enforce a maximum per-file size in the drop zone. File size validation is left to the presign API (which may return a 400 if a file exceeds the S3 policy limit). If the team wants a client-side guard (e.g. reject files > 50 MB before making any API call), this should be added as a pre-dispatch validation step in the Effect.

**UX-D5 — "Do not close this tab" warning.**
A plain-text warning is shown during upload (panel 3). This is a UX addition not mentioned in the ACs. It is important because S3 PUTs are initiated from the browser — closing the tab aborts all in-flight uploads silently. A `beforeunload` event listener should also be registered while `inProgress` is true and removed when it becomes false, showing the browser's native "Leave site?" dialog. This listener should be added in the Effect or in the component, not in a store reducer.

**UX-D6 — `Uploading` Storybook state uses 120 total / 37 uploaded.**
The story says 100-file batches with 5 concurrent PUTs. 120 total files means two batches; 37 uploaded exercises the mid-batch progress display. These values are arbitrary mock data for visual testing only.

**UX-D7 — Route `/photographer/events/:id/upload` is a new child route.**
The `app.routes.ts` does not yet have this route. The build agent must add it under the `photographer` parent alongside the existing `events/:id` route. The entry point is `EventUploadComponent`.

**UX-D8 — "Upload Photos" button location on `EventDetailComponent`.**
RS-006 does not specify how the photographer navigates to the upload page. The spec author recommends a `mat-flat-button` labelled "Upload Photos" with icon `upload` be added to the `EventDetailComponent` action bar (above the event metadata), navigating to `/photographer/events/:id/upload`. This button should only appear when the event `status` is `'active'`. This recommendation should be confirmed before RS-006 implementation begins; if accepted, it constitutes a minor additive change to the RS-005 `EventDetailComponent`.
