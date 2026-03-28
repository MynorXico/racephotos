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

## Step 3 — Install NgRx (UI stories only)

If the story has `Has UI: yes` and `@ngrx/store` is not yet in
frontend/angular/package.json dependencies, run:

```bash
cd frontend/angular
ng add @ngrx/store@latest --skip-confirmation
ng add @ngrx/effects@latest --skip-confirmation
ng add @ngrx/entity@latest --skip-confirmation
ng add @ngrx/router-store@latest --skip-confirmation
npm install --save-dev @ngrx/store-devtools
```

---

## Step 4 — Build the feature

Execute the build-feature command with the story filename as the argument.
The build-feature command will handle: interface → tests → implementation →
CDK update → environments.example.ts → ADR for non-obvious decisions → DoD.

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

## Step 7 — Execute the test plan

Run every item in the PR test plan immediately (do not leave it for the user).
Post the results as a PR comment.

If any item fails: fix, push, re-run, update the comment.

---

## Step 8 — Mark done

Update the story file: set `Status: done`.
Report to the user: PR URL, story ID, and a one-line summary of what shipped.
