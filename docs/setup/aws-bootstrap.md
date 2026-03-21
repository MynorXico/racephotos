## After running `cdk init`

`cdk init` generates a default entry point named after the folder (e.g. `bin/cdk.ts`).
This project uses `bin/app.ts` instead. Update `cdk.json` before running any `cdk` commands:
```json
{
  "app": "npx ts-node --prefer-ts-exts bin/app.ts"
}
```
