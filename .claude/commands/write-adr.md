Write an Architecture Decision Record for: $ARGUMENTS

Check docs/adr/ for existing ADRs and use the next sequence number (e.g. 0005 if
0004 is the highest). Name the file docs/adr/<NNNN>-<kebab-case-title>.md.

Use this format exactly:

---
# ADR-NNNN: <title>
**Date**: <today's date>
**Status**: proposed | accepted | superseded

## Context
<!-- What problem are we solving? What forces are in play? -->

## Decision
<!-- What did we decide? State it clearly in one paragraph. -->

## Options considered
### Option A — <name>
Pros: …
Cons: …

### Option B — <name>
Pros: …
Cons: …

## Consequences
**Positive**: …
**Negative / tradeoffs**: …
**Stories affected**: RS-NNN, RS-NNN
---

Reason through the options given the constraints in PRODUCT_CONTEXT.md and CLAUDE.md
(open-source, no hardcoded values, Go + Angular + CDK stack).

After writing, update any story files in docs/stories/ that reference this decision
by replacing "requires ADR-NNNN to be resolved" with "see ADR-NNNN".
