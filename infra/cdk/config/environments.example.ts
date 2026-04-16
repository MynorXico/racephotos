/**
 * environments.example.ts — committed template
 *
 * Copy to environments.ts (gitignored) and fill in real values.
 * environments.ts is never committed — see .gitignore.
 *
 * domainName and certificateArn are loaded from SSM at synth time by
 * PipelineStack.loadConfig(). The values here are only used when running
 * `make synth` locally (outside the pipeline). Set them to "none" if you
 * have no custom domain, or fill in real values for local testing.
 *
 * See docs/setup/aws-bootstrap.md for the full setup guide.
 */

import { EnvConfig } from './types';

export const environments: Partial<Record<EnvConfig['envName'], EnvConfig>> = {
  dev: {
    envName: 'dev',
    account: 'REPLACE_WITH_DEV_ACCOUNT_ID',
    region: 'REPLACE_WITH_REGION',
    rekognitionConfidenceThreshold: 0.7,
    watermarkStyle: 'text_overlay',
    photoRetentionDays: 90,
    enableDeletionProtection: false,
    domainName: 'none',
    certificateArn: 'none',
    // Set to 3 if your account has a low Lambda concurrency limit (e.g. 10).
    // Increase once AWS Support raises the account concurrency limit.
    sqsMaxConcurrency: 3,
  },
  prod: {
    envName: 'prod',
    account: 'REPLACE_WITH_PROD_ACCOUNT_ID',
    region: 'REPLACE_WITH_REGION',
    rekognitionConfidenceThreshold: 0.9,
    watermarkStyle: 'text_overlay',
    photoRetentionDays: 365,
    enableDeletionProtection: true,
    domainName: 'app.example.com',
    certificateArn: 'arn:aws:acm:us-east-1:REPLACE_WITH_ACCOUNT:certificate/REPLACE_WITH_CERT_ID',
    sqsMaxConcurrency: 50,
  },
};
