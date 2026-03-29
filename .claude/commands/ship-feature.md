You are the orchestrator for shipping a RaceShots feature end-to-end.
The feature to ship is: $ARGUMENTS

Follow these steps in strict order. Stop and report to the user if any step fails
and cannot be automatically resolved.

---

## Step 1 — Locate or create the story

Check if a story file already exists in docs/stories/ matching $ARGUMENTS
(search by ID like RS-NNN or by title keywords).

- If found: read it and confirm Status is `ready`. If it is `draft`, stop and
  tell the user the story needs review before building.
- If not found: create it now using the write-story command with $ARGUMENTS as
  the description. Set Status to `ready`.

---

## Step 2 — Check ADR dependencies

Read the story's "ADR dependency" field. For each ADR listed:

- Check if the file exists in docs/adr/
- If missing: stop and tell the user exactly which decision must be made first,
  referencing the open decisions in docs/adr/ or PRODUCT_CONTEXT.md.

---

## Step 3 — UX spec (UI stories only)

If the story has `Has UI: yes`, check if `docs/ux-specs/RS-NNN-ux-spec.md` exists.

- If it exists: read it and use it as the design specification for Step 4.
- If it does not exist: use the Agent tool to invoke the `ux-designer` agent with
  the story file path as context. Wait for it to complete and write the spec file
  before proceeding. Read the generated spec before starting Step 4.

---

## Step 4 — Build the feature

Execute the build-feature command with the story filename as the argument.
The build-feature command will handle: interface → tests → implementation →
CDK update → environments.example.ts → ADR for non-obvious decisions → DoD.

**If during build you encounter a design choice not covered by the story or an
existing ADR:** stop, run `/new-adr "<the question>"`, wait for resolution, then
resume. Never make a silent architectural assumption.

---

## Step 5 — Validate

Run the full validation suite:

```bash
make test-unit
make lint
make synth
```

If the story has `Has UI: yes`, also run:

```bash
make ng-build
cd frontend/angular && npx ng test --watch=false
cd frontend/angular && npx storybook build
make e2e
```

If any check fails: diagnose, fix, re-run from the failing check.
Do not proceed to Step 6 while anything is red.

---

## Step 6 — Open a pull request

Create a branch named `feature/<story-id>-<kebab-title>` if not already on one.
Commit all changes. Open a PR with:

- Title: `[<story-id>] <story title>`
- Body: summary of what was built, the test plan (checklist of what was run),
  and the results of each check from Step 5.

---

## Step 7 — Specialist reviews

After the PR is open, use the Agent tool to run the following agents **in parallel**
(launch all applicable ones in a single message with multiple Agent tool calls):

| Agent               | Run when                                                             |
| ------------------- | -------------------------------------------------------------------- |
| `security-reviewer` | Always                                                               |
| `db-expert`         | Story touches DynamoDB (table reads/writes or CDK table definitions) |
| `perf-reviewer`     | Story has API endpoints or SQS consumers                             |
| `qa-expert`         | Always                                                               |

Pass each agent the story file path and the PR number as context.

Wait for all agents to complete. For each one:

- Post their full output as a PR comment using the GitHub MCP tool
- If any agent returns `CHANGES REQUIRED`: fix the issues, push, re-run that
  specific agent, post updated results

Do not proceed to Step 8 until all agents return `APPROVED`.

---

## Step 8 — Execute the test plan

Run every item in the PR test plan immediately (do not leave it for the user).
Post the results as a PR comment.

If any item fails: fix, push, re-run, update the comment.

---

## Step 9 — Mark done

Update the story file: set `Status: done`.
Report to the user: PR URL, story ID, and a one-line summary of what shipped.
