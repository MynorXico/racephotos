Read PRODUCT_CONTEXT.md and docs/stories/TEMPLATE.md.

Write a user story for: $ARGUMENTS

Use the template exactly. Fill in every section. Choose the next available RS-NNN ID
by checking existing files in docs/stories/. Set Has UI based on whether the feature
requires Angular changes. Include at least 3 acceptance criteria in Given/When/Then format.

For the Tech notes section, identify the correct Lambda(s), interface(s), DynamoDB
access patterns, env vars, and CDK constructs by reasoning from PRODUCT_CONTEXT.md
and the existing infra in infra/cdk/.

Check docs/adr/ for existing ADRs and reference any that are relevant.
Note any open decisions from PRODUCT_CONTEXT.md that must be resolved before this
story can be built — put them in the ADR dependency field.

Save to docs/stories/<RS-NNN>-<kebab-case-title>.md.
Report the file path and a one-line summary of what was written.
