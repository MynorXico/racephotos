You are addressing code review comments on a pull request.
The PR number is: $ARGUMENTS

Follow these steps in strict order.

---

## Step 1 — Fetch the latest review comments

Run:

```bash
gh pr view $ARGUMENTS --comments
gh api repos/{owner}/{repo}/pulls/$ARGUMENTS/comments --jq '.[].body'
```

Collect **all** comments from the most recent review round (inline comments +
top-level review summary). Group them by reviewer handle so you know who to
notify at the end.

---

## Step 2 — Assess each comment

For every comment, decide:

- **Necessary**: correctness bug, security issue, broken contract, test gap,
  or factual inaccuracy — fix it.
- **Not necessary**: style preference, speculative improvement, already addressed
  in a prior commit — skip it, but note why.

State your decision out loud before acting. Never silently skip a comment.

---

## Step 3 — Apply necessary fixes

For each fix:

1. Make the code/doc change.
2. If it touches CDK TypeScript: run `npm run build` first, then the relevant
   jest test file to confirm it still passes.
3. If it touches Go: run `go test ./...` in the affected Lambda module.
4. Commit with a conventional-commit message that references the fix
   (e.g. `fix(cdk): strengthen ssm parameter test assertions`).

Do **not** batch unrelated fixes into a single commit.

---

## Step 4 — Push

```bash
git push
```

All pre-push hooks must pass. If they fail, fix the underlying issue — never
use `--no-verify`.

---

## Step 5 — Post a PR comment summarising the changes

Post one comment to the PR that:

- Lists every comment that was addressed, with a one-line explanation of the fix.
- Lists every comment that was skipped, with a one-line reason.
- Ends with `@<reviewer-handle> please review again.` for **each** reviewer
  whose comments were addressed. If multiple reviewers had comments, mention
  all of them on separate lines.

Use this template:

```
Addressed review feedback:

**Fixed:**
- [Comment summary]: [what was changed and why]
- ...

**Skipped (not necessary):**
- [Comment summary]: [reason — e.g. "already fixed in commit abc1234", "style preference, existing code follows the same pattern"]

@reviewer-handle please review again.
```

---

## Step 6 — Report to the user

Summarise: how many comments were addressed, how many skipped, and the PR URL.
