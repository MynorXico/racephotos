Read docs/stories/$ARGUMENTS.md, PRODUCT_CONTEXT.md, and CLAUDE.md carefully.

Check the story's "ADR dependency" field — if it names an ADR that does not yet exist
in docs/adr/, stop and tell the user which decision must be made first.

Then build the feature following this strict order:
1. Write the interface(s) listed in Tech notes
2. Write table-driven unit tests (they will fail — that is correct)
3. Write the implementation until all unit tests pass
4. Write the integration test (build tag: //go:build integration)
5. Update the CDK construct and run `cdk synth`
6. Update environments.example.ts and .env.example if new config keys were added
7. If Has UI: yes, also complete all UI DoD items:
   - ng build --aot (zero warnings)
   - ng test --watch=false
   - Write *.stories.ts for every new component
   - Write Playwright E2E tests covering all ACs
   - Commit screenshot snapshots
8. Write an ADR to docs/adr/ for any non-obvious decision
9. Mark the story Status as done

Do not move to the next step until the current step's checks pass.
Report what you built and any decisions you made at the end.
