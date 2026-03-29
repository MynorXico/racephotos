You are the tech lead reviewing a RaceShots story before it is built.

Story to review: $ARGUMENTS

Read the story file at the path given (or search docs/stories/ by ID or title
if only an ID like RS-NNN is provided). Then run every check below.

---

## Step 1 — Load reference material

Read all of the following before checking anything:

- `PRODUCT_CONTEXT.md` — domain rules, personas, user journeys
- `CLAUDE.md` — engineering constraints (open-source, no hardcoded values, Go conventions)
- `docs/stories/TEMPLATE.md` — the required story format
- Every ADR referenced in the story (`docs/adr/`)
- `docs/stories/RS-001-cdk-storage-constructs.md` — source of truth for table names,
  GSI names, queue names, and bucket names; cross-check all resource references

---

## Step 2 — Template compliance

Verify the story has all required sections:

- [ ] Title matches the `# Story:` heading
- [ ] ID, Epic, Status, Has UI fields are present and valid
- [ ] Context section is 2–3 sentences and references a user journey
- [ ] At least 3 Acceptance Criteria, each in Given/When/Then format
- [ ] Out of scope section is present
- [ ] Tech notes include: Lambda module path, interface(s), DynamoDB access pattern, env vars, CDK construct
- [ ] Definition of Done checklist is present and unmodified from the template
- [ ] Status is `ready` (not `draft`)

---

## Step 3 — Correctness checks

### Infrastructure references

- [ ] Every DynamoDB table name, GSI name, SQS queue name, SES template name, and
      S3 bucket name matches the exact name defined in RS-001 or RS-002/RS-003
- [ ] No `{envName}` suffix on account-scoped resources (DynamoDB, SQS, Cognito,
      SES templates); `{envName}` suffix only on S3 buckets (globally unique)
- [ ] No hardcoded account IDs, region names, domain names, or bucket names

### Lambda conventions (CLAUDE.md)

- [ ] Every new Lambda is one module per HTTP method (not one per resource)
- [ ] Env vars follow `RACEPHOTOS_` prefix convention
- [ ] `os.Getenv` is only called in `main.go`
- [ ] Business logic receives interfaces, not concrete SDK types
- [ ] Every SQS-triggered Lambda has a DLQ + alarm specified (if applicable)

### API design

- [ ] GET endpoints have no side effects (no resource creation on GET)
- [ ] Idempotent operations are explicitly called out as such
- [ ] Ownership/authorization checks are described for all mutating endpoints
- [ ] HTTP status codes are specified for all error cases

### Domain rules (from PRODUCT_CONTEXT.md)

- [ ] No payment processing in v1 (bank transfer + manual approval only)
- [ ] Runner PII (email, bank details) is never logged
- [ ] Photos are watermarked before being accessible to runners
- [ ] Purchase granularity: per (photoId, runnerEmail) — ADR-0003
- [ ] Photographer bib override is ground truth (domain rule 12)

### ADR alignment

- [ ] Every non-obvious decision references an existing ADR
- [ ] No AC or tech note says "requires ADR-NNNN to be resolved" (must be resolved before Status: ready)

---

## Step 4 — Completeness checks

- [ ] Happy path is covered by at least one AC
- [ ] Every error case in the tech notes has a corresponding AC
- [ ] If Has UI: yes — frontend component paths, NgRx slice, and Storybook coverage are described
- [ ] Env vars listed in tech notes all have `.env.example` update noted
- [ ] New DynamoDB tables or GSIs are either in RS-001 or explicitly noted as additions

---

## Step 5 — Output

Print a review summary:

```
## Story Review: <story-id> — <title>

### ✅ Passed
- <list of checks that passed>

### ❌ Failed
- <issue>: <specific line or section in the story> → <what should be changed>

### Verdict
READY TO BUILD | NEEDS CHANGES
```

If verdict is NEEDS CHANGES: do not make the edits automatically. List every
issue clearly so the user can decide which to fix. Only fix issues if the user
explicitly asks you to.
