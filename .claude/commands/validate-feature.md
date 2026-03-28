Run the full validation suite for the feature or service named in $ARGUMENTS.
If $ARGUMENTS is empty, validate the entire repo.

Run these checks in order. Stop at the first failure, diagnose the root cause,
fix it, then re-run from the beginning. Do not move on while anything is red.

Backend checks:
1. `make test-unit` — all Go unit tests must pass
2. `go vet ./...` in each affected Lambda directory — zero issues
3. `golangci-lint run ./...` in each affected Lambda directory — zero issues

Infrastructure checks:
4. `cd infra/cdk && cdk synth` — must complete without errors or unresolved tokens

Frontend checks (only if the feature has UI):
5. `cd frontend/angular && ng build --configuration=production` — zero errors, zero warnings
6. `cd frontend/angular && ng test --watch=false --code-coverage` — all tests green
7. `cd frontend/angular && npx storybook build` — all stories render
8. `cd frontend/angular && npx playwright test` — all E2E tests pass, no snapshot diffs

Report a final pass/fail summary. If all checks pass, say "VALIDATION PASSED" on its own line.
