# ADR-0011: Multi-photo cart UX — checkbox-per-card with toolbar button

**Date**: 2026-04-16
**Status**: Accepted
**Story**: RS-020

## Context

RS-020 introduces multi-photo cart support. The original story draft described a sticky cart-bar footer showing selected photos. During review, the product owner clarified the desired UX: a checkbox on each photo card that the runner taps/clicks to add or remove photos from the cart, followed by a "Purchase (N photos)" button in a selection toolbar that appears above the grid once at least one photo is selected.

Two approaches were considered:

1. **Sticky cart-bar footer** — a persistent panel at the bottom of the viewport showing thumbnails and a CTA. Rich but complex, requires scroll management and a custom sticky bar component.

2. **Checkbox per card + toolbar button** — a Material `MatCheckbox` overlay on the top-left of each photo card, with a condensed selection summary toolbar above the grid. Simpler, touch-friendly (48×48 min tap target), and consistent with Material Selection patterns.

## Decision

Use the **checkbox per card + toolbar button** approach (option 2).

The checkbox is absolutely-positioned in the top-left of the thumbnail container. On desktop it is hidden until hover (so it doesn't clutter the grid for browsing); on mobile (≤1279px) it is always visible because touch devices have no hover state. When a photo is in the cart, the checkbox wrapper carries class `always-visible` regardless of viewport.

The selection toolbar renders conditionally (`@if (cartCount() > 0)`). On mobile it stacks vertically; on desktop it is a single flex row.

## Consequences

- **Photo card component gains required inputs** `eventId` and `eventName` (propagated from `event-search` through `photo-grid`). These are needed to build the `PhotoSummary` dispatched to the cart.
- **Cross-event conflict dialog** is an inline `<ng-template #crossEventConfirm>` in the photo-card template, opened via `MatDialog.open(this.crossEventConfirmRef)`. Cancel does nothing; Continue dispatches `CartActions.replaceCart`.
- **Cart max 20 photos** — checkbox is disabled (with tooltip) when `selectCartFull` is true and the photo is not already in the cart.
- **No sticky footer component** — the footer approach was explicitly declined; any future sticky-footer requirements should revisit this ADR.
