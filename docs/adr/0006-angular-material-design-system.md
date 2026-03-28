# ADR-0006: Angular Material as the design system
**Date**: 2026-03-28
**Status**: accepted

## Context

The Angular frontend needs a component library and visual design language before
any UI feature can be built. All agent-generated components must use the same
system — choosing it now prevents a mix of styles across the 4 frontend stories.

Requirements:
- Accessible by default (WCAG 2.1 AA)
- Maintained and aligned with Angular's release cadence
- Covers all needed components: buttons, forms, dialogs, grids, navigation, chips
- Works well with NgRx and reactive forms
- Responsive — must work at 375px (mobile) and 1280px (desktop)

## Decision

Use **Angular Material** (`@angular/material` + `@angular/cdk`).

Global theme: a custom Material theme built with the M3 (Material Design 3) theming
API introduced in Angular Material 17. Theme tokens (primary, secondary, error,
neutral palettes) are defined once in `src/styles.scss` and propagate to all
components via CSS custom properties.

Typography: Material's default typescale, overridden with a system font stack
(`-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif`) to avoid
a Google Fonts network dependency.

## Options considered

### Option A — Angular Material (chosen)
Pros: first-party Angular support; M3 theming with CSS custom properties;
accessible by default (WAI-ARIA); well-documented; agents have strong training
data on it; CDK provides primitives (overlay, drag-drop, virtual scroll) for
custom components.
Cons: opinionated visual style that takes effort to customise beyond the Material
aesthetic; slightly larger bundle than a utility-first approach.

### Option B — PrimeNG
Pros: richer out-of-the-box components (data tables, image galleries).
Cons: third-party maintained — can fall behind Angular major versions; theming
requires PrimeNG-specific API knowledge; agents have less reliable training data.

### Option C — TailwindCSS only (no component library)
Pros: full design freedom; smallest bundle.
Cons: every component must be built from scratch; accessibility is the developer's
responsibility; much slower time-to-first-feature.

## Consequences

**Positive**:
- Accessibility baseline met out of the box (focus management, ARIA roles, keyboard nav)
- Agents generate components using well-known `mat-*` selectors — reliable output
- M3 theming means a single `$theme` definition controls the entire colour system
- CDK overlay is reused for the photo preview modal (no third-party lightbox needed)

**Negative / tradeoffs**:
- Material aesthetic may feel generic; addressed by defining a strong custom palette
- `@angular/material` + `@angular/cdk` add ~80 kB to the initial bundle (gzipped);
  mitigated by only importing used modules (no barrel imports from `@angular/material`)

**Install command** (runs as part of PR 5):
```bash
cd frontend/angular && ng add @angular/material
# Select: custom theme, yes to typography, yes to animations
```

**Agent instructions**:
- Always import specific Material modules in the feature module or component, never
  from the barrel (`@angular/material`)
- Use `MatFormFieldModule` + `ReactiveFormsModule` for all forms — never template-driven
- Use `MatDialogModule` (CDK overlay) for the photo preview lightbox
- Never override `color` or `background` inline — always via theme tokens or SCSS
  variables derived from the theme

**Theme file**: `src/styles.scss` — define the M3 custom theme here; all other
SCSS files import from it, never from `@angular/material` directly.

**Stories affected**: RS-007, RS-008, RS-009, RS-010 (all frontend stories)
