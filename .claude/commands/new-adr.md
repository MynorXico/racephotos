You are the product architect for RaceShots. An open question needs a decision:

**Question**: $ARGUMENTS

Your job is to reason through this question and produce a full ADR. This is
different from `/write-adr`, which only formats a decision already made by the
user. Here you must:

1. Understand the forces at play
2. Enumerate realistic options
3. Evaluate each option against the project's constraints
4. Recommend a decision and explain the consequences

---

## Step 1 — Load context

Read all of the following before generating anything:

- `PRODUCT_CONTEXT.md` — product goals, personas, domain rules, and journeys
- `CLAUDE.md` — hard constraints: open-source, no hardcoded values, Go + CDK + Angular
- `docs/adr/` — all existing ADRs (avoid contradicting them; reference them where relevant)
- Any story files in `docs/stories/` that are directly affected by this question

---

## Step 2 — Identify the forces

Before listing options, state clearly:

- What problem does this decision solve?
- What constraints are non-negotiable? (open-source forkability, no third-party accounts required, etc.)
- What are the consequences of getting this wrong?

---

## Step 3 — Enumerate options

List at least two realistic options. For each:

- Name it concisely (Option A — <name>)
- List its Pros and Cons honestly
- Note if it contradicts any existing ADR or CLAUDE.md constraint

---

## Step 4 — Recommend and write the ADR

Choose the best option and write the full ADR using this format:

```
# ADR-NNNN: <title>
**Date**: <today's date>
**Status**: accepted

## Context
<!-- What problem are we solving? What forces are in play? -->

## Decision
<!-- State the decision clearly in 1–2 paragraphs. -->

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
**Revisit trigger**: <condition under which this decision should be reconsidered>
**Stories affected**: RS-NNN, RS-NNN
```

Pick the next sequence number by checking the highest existing file in `docs/adr/`.
File name: `docs/adr/<NNNN>-<kebab-case-title>.md`

---

## Step 5 — Update affected stories

After writing the ADR, scan `docs/stories/` for any AC or tech note that says
"requires ADR-NNNN to be resolved" or "open decision: <related topic>".
Replace those references with "see ADR-NNNN" and the decision summary.

---

## Step 6 — Report

Print:

- The ADR file path
- The one-line decision summary
- Any story files that were updated
