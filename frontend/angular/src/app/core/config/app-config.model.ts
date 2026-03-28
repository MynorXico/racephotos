/**
 * Runtime application configuration — loaded from /assets/config.json at startup.
 *
 * The same compiled Angular bundle is deployed to every environment (dev, qa,
 * staging, prod). The deployment pipeline writes the correct config.json into
 * the S3 bucket for that environment. No values are baked into the build.
 *
 * See docs/setup/runtime-config.md for how to generate config.json per environment.
 */
export interface AppConfig {
  /** Base URL for the RaceShots API Gateway, without trailing slash.
   *  Example: "https://api.dev.example.com" */
  apiBaseUrl: string;

  /** AWS region where Cognito and other services are deployed.
   *  Example: "us-east-1" */
  region: string;

  /** Cognito User Pool ID.
   *  Example: "us-east-1_AbCdEfGhI" */
  cognitoUserPoolId: string;

  /** Cognito App Client ID (public, no secret).
   *  Example: "1a2b3c4d5e6f7g8h9i0j" */
  cognitoClientId: string;

  /** Cognito Hosted UI / OAuth domain (without https://).
   *  Example: "auth.dev.example.com" */
  cognitoOauthDomain: string;
}
