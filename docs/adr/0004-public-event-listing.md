# ADR-0004: Events are publicly discoverable via homepage listing
**Date**: 2026-03-28
**Status**: accepted

## Context

Photographers share a per-event search URL or QR code with runners at the finish
line. The question is whether runners can also discover events through a public
listing on the platform homepage, or whether the event URL is the only entry point.

This shapes the frontend architecture (homepage with event list vs. a search-only
entry), SEO strategy, and the privacy posture of the platform.

## Decision

Events are **publicly listed** on the platform homepage, searchable and browsable
without authentication.

Each event in the listing shows: event name, date, location, and a "Search photos"
CTA. Clicking through takes the runner to the bib search page for that event.

The listing is paginated and filterable by date and location. The most recent
events appear first.

> Future: the platform may add a `visibility` flag per event so photographers
> can mark an event as unlisted (direct link only). This is a v2 concern — the
> data model should carry a `visibility: 'public' | 'unlisted'` field from day one
> to avoid a migration later, even though v1 treats all events as public.

## Options considered

### Option A — Direct link only (no public listing)
Pros: simpler frontend; photographers control discovery; no SEO concerns about
photos being associated with a named event.
Cons: runners who lost the QR code or link have no recovery path; platform gets
zero organic traffic; harder to grow the runner user base.

### Option B — Public listing (chosen)
Pros: runners can find their event without a direct link; organic SEO (event names
and locations are indexed); photographers benefit from additional discovery;
natural landing page for the platform.
Cons: all events are visible — photographers cannot hide an event by default in v1.
Mitigated by adding `visibility` field to the Event model now (defaulting to public)
and building the unlisted feature in v2.

## Consequences

**Positive**:
- Runners have a fallback discovery path if they lose the QR code
- Platform homepage has meaningful content from day one
- Event pages are SEO-indexable (event name + location + date)

**Negative / tradeoffs**:
- `Event` model needs a `visibility` field immediately, even though v1 only uses `public`
- The frontend homepage is now a product-bearing page, not just a redirect
- Pagination and search/filter UI must be built as part of RS-008

**Data model change**: add `visibility: 'public' | 'unlisted'` to the `Event` entity.
Default value: `'public'`. CDK must include this attribute in the DynamoDB item
definition from the first storage construct deploy.

**New frontend route**: `/` — public event listing (paginated, filterable)
**Existing route**: `/events/:eventId/search` — bib search for a specific event

**Stories affected**: RS-001 (storage construct — Event model), RS-007 (frontend shell — routing),
RS-008 (frontend search page — homepage listing + bib search)
