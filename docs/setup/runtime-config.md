# Runtime configuration

## Why one build, many environments

RaceShots uses a **single compiled Angular bundle** deployed to every environment
(dev, qa, staging, prod). No build-time `environment.ts` file-replacement is used.

All environment-specific values are injected at deploy time by uploading
`config.json` to the S3 bucket alongside the Angular build output. The Angular app
fetches `/assets/config.json` at startup via `APP_INITIALIZER` before rendering.

Benefits:

- The exact artifact that passes QA is the one that ships to production
- No risk of "it works in dev because the build was different"
- Adding a new environment never requires a code change

## config.json schema

```json
{
  "apiBaseUrl": "https://api.ENV.example.com",
  "region": "us-east-1",
  "cognitoUserPoolId": "us-east-1_AbCdEfGhI",
  "cognitoClientId": "1a2b3c4d5e6f7g8h9i0j",
  "cognitoOauthDomain": "auth.ENV.example.com"
}
```

See `src/app/core/config/app-config.model.ts` for the full TypeScript interface.

## How the deploy pipeline injects config

The `deploy-frontend` CI job (PR 7) will:

1. Build the Angular app once: `ng build --configuration=production`
2. Write the environment-specific `config.json` from CDK SSM parameters
3. Upload both `dist/` and the generated `config.json` to the environment's S3 bucket
4. Invalidate CloudFront

The CDK `FrontendConstruct` stores each environment's values as SSM parameters
(no hardcoded values in the build or in the deploy script).

## Local development

For local dev, `src/assets/config.json` ships with placeholder values pointing
to `http://localhost:3000`. Override by editing that file (it is committed as
a template, not a secret):

```json
{
  "apiBaseUrl": "http://localhost:3000",
  "region": "us-east-1",
  "cognitoUserPoolId": "REPLACE_WITH_USER_POOL_ID",
  "cognitoClientId": "REPLACE_WITH_CLIENT_ID",
  "cognitoOauthDomain": "REPLACE_WITH_OAUTH_DOMAIN"
}
```

> Do not commit real Cognito IDs. The `config.json` in `src/assets/` is a
> committed placeholder only.

## Adding a new config key

1. Add the field to `AppConfig` in `app-config.model.ts`
2. Update `src/assets/config.json` with a placeholder value
3. Update `environments.example.ts` with the new CDK prop that will populate it
4. Update the deploy script to pass the new key from SSM
