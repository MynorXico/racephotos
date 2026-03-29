# Development Workflow — RaceShots

This document describes the end-to-end process for building each user story
in the v1 backlog. The goal is maximum automation: an agent handles design,
build, review, and testing while you make the decisions that require human
judgment (merging, resolving open architectural questions, confirming UX
direction).

---

## Per-story flow

Run these steps for each story in build order (see `development-plan.md`):

```
1. /review-story RS-00X       ← tech lead gate
2. /ship-feature RS-00X       ← build + PR + tests
3. Automated reviewers fire   ← code review, security, db, perf (see below)
4. Fix issues, push           ← iterate until all checks green
5. Merge → next story
```

### Step 1 — `/review-story RS-00X`

Runs before any code is written. Checks:

- Story is in the correct template format
- All infrastructure names match RS-001 (no `{envName}` on account-scoped resources)
- REST conventions respected (no GET side effects, idempotency called out)
- ADR references exist and are resolved
- DoD checklist is present

**Verdict is READY TO BUILD or NEEDS CHANGES.** Fix any NEEDS CHANGES issues
before proceeding — catching them here is far cheaper than after the build.

### Step 2 — `/ship-feature RS-00X`

Orchestrates the full build in strict order:

1. Confirm story status is `ready`
2. Check ADR dependencies are resolved
3. Install NgRx if needed (UI stories only)
4. Build: interface → table-driven tests → implementation → CDK construct update
5. Run: `make test-unit`, `make lint`, `make synth`
6. For UI stories: `make ng-build`, `ng test`, `storybook build`, `make e2e`
7. Open PR with title `[RS-00X] <story title>` and test plan checklist
8. Execute the test plan immediately; post results as PR comment
9. Set story `Status: done`

**If the agent hits an ambiguous design decision not covered by the story or
an existing ADR:** it stops, runs `/new-adr "<question>"`, waits for resolution,
then resumes. Do not let the agent make silent architectural assumptions.

### Step 3 — Automated specialist reviews

These fire automatically after the PR is created (wired inside `/ship-feature`
— see "Adding specialist reviews" below). Each posts findings as a PR comment.

| Review             | Skill                           | Fires on                                       |
| ------------------ | ------------------------------- | ---------------------------------------------- |
| Code review        | Gemini Code Assist (GitHub App) | every PR                                       |
| Security review    | `/security-review`              | every PR                                       |
| DB review          | `/db-review`                    | stories that touch DynamoDB                    |
| Performance review | `/perf-review`                  | stories with latency-sensitive endpoints       |
| UX spec            | `/ux-spec`                      | before building UI stories (run before step 2) |

### Step 4 — Fix and iterate

For each ❌ from any reviewer:

- If it's a code issue: fix, push, re-run the relevant check
- If it's a design/architecture issue: run `/new-adr "<question>"` to resolve it
  properly rather than applying a quick patch

### Step 5 — Merge

Once all checks are green and the PR is approved, merge. The next story becomes
unblocked. Each story depends on all stories before it — do not skip ahead.

---

## Skill reference

| Skill                                  | When to use                                                   |
| -------------------------------------- | ------------------------------------------------------------- |
| `/review-story <path or RS-NNN>`       | Before building any story                                     |
| `/ship-feature <story-file>`           | To build a story end-to-end                                   |
| `/new-adr "<question>"`                | When a non-obvious design question arises mid-build           |
| `/write-adr "<decision already made>"` | To document a decision already made                           |
| `/write-story "<description>"`         | To write a new story not in the backlog                       |
| `/ux-spec <story>`                     | Before building a UI story (generates Angular component spec) |
| `/security-review <story or PR>`       | After PR creation — IAM, logging, OWASP                       |
| `/db-review <story>`                   | After PR creation — GSI design, hot partitions, cost          |
| `/perf-review <story>`                 | After PR creation — latency targets, caching                  |
| `/qa-plan <story>`                     | To generate edge-case test scenarios beyond the ACs           |

> **Note:** `/ux-spec`, `/security-review`, `/db-review`, `/perf-review`, and
> `/qa-plan` are planned skills not yet created. Add them as needed — see
> "Adding specialist reviews" below.

---

## Adding specialist reviews

When you're ready to add a new automated reviewer:

1. Create `.claude/commands/<skill-name>.md` — describe the role, what to read,
   what to check, and how to report findings (same pattern as `review-story.md`)
2. Add a step to `.claude/commands/ship-feature.md` after "Open a pull request"
   to invoke the new skill and post results as a PR comment
3. Test it manually on an existing story before wiring it into the automated flow

---

## Handling mid-build architectural decisions

If `/ship-feature` or any agent encounters a design question not covered by
the story or an existing ADR:

```
Stop.
Run: /new-adr "<the open question>"
The skill will:
  - Load PRODUCT_CONTEXT.md and all existing ADRs
  - Enumerate options with pros/cons
  - Recommend a decision
  - Write the ADR file to docs/adr/
  - Update affected stories
Resume the build once the ADR is accepted.
```

Never let an agent guess at an architectural decision — the cost of a wrong
assumption compounds across all downstream stories.

---

## Build order

Stories must be built in this order (each depends on all prior):

```
 1.  RS-001  CDK storage constructs (S3×2, DynamoDB×6, SQS×2+DLQs)
 2.  RS-002  CDK Cognito + API Gateway
 3.  RS-003  CDK SES construct + email templates
 4.  RS-004  Photographer account (auth shell + profile)
 5.  RS-005  Event management (create, view, edit, archive, share)
 6.  RS-006  Bulk photo upload (batch presign + upload UI)
 7.  RS-007  Photo processing pipeline (Rekognition + watermark, no UI)
 8.  RS-008  Photographer event photos gallery
 9.  RS-009  Runner photo search
10.  RS-010  Runner purchases a photo
11.  RS-011  Photographer approves or rejects a purchase
12.  RS-012  Runner downloads a photo via download token
13.  RS-013  Photographer manually tags bib numbers
14.  RS-014  Public events listing homepage
```

See `docs/development-plan.md` for the full backlog, open decisions, and PR history.

---

## Key constraints (enforce on every story)

- No `{envName}` suffix on account-scoped resources (DynamoDB, SQS, Cognito, SES templates)
- S3 bucket names always include `{envName}` (globally unique)
- One Lambda per HTTP method — never a router Lambda
- All env vars use `RACEPHOTOS_` prefix
- `os.Getenv` only in `main.go`
- Every SQS-triggered Lambda has a DLQ + CloudWatch alarm
- No raw AWS SDK errors returned to API Gateway callers
- No runner PII (email, bank details) in logs
- `context.Background()` never inside a handler or anything it calls
