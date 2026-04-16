/**
 * types.ts — committed to the repository
 *
 * Contains only type definitions. No account IDs, no secrets, no region names.
 * Imported by all CDK stacks and stages.
 */

export interface EnvConfig {
  envName: 'local' | 'dev' | 'qa' | 'staging' | 'prod';
  account: string;
  region: string;
  rekognitionConfidenceThreshold: number;
  watermarkStyle: 'text_overlay' | 'diagonal_tile' | 'bottom_bar';
  photoRetentionDays: number;
  enableDeletionProtection: boolean;
  /**
   * Maximum concurrent Lambda instances for SQS-triggered processing functions
   * (photo-processor and watermark). Set to a low value (e.g. 3) when the
   * account-level Lambda concurrency limit is constrained, to prevent batch
   * processing from starving API-facing Lambdas. Set to a higher value (e.g. 50)
   * once AWS Support raises the account concurrency limit.
   */
  sqsMaxConcurrency: number;
  /**
   * Custom domain name for the CloudFront distribution.
   * e.g. "app.dev.example.com"
   * Use "none" when no custom domain is needed — CloudFront default domain is used.
   * Loaded from SSM: /racephotos/env/{envName}/domain-name
   */
  domainName: string;
  /**
   * ACM certificate ARN for the custom domain. Must be in us-east-1 (CloudFront requirement).
   * Use "none" when domainName is "none".
   * Loaded from SSM: /racephotos/env/{envName}/certificate-arn
   */
  certificateArn: string;
  /**
   * SES configuration set name associated with the verified sender identity.
   * When an SES configuration set is attached to the sending identity (e.g. for
   * click/open tracking or suppression lists via the SES console), SES enforces
   * IAM on the configuration-set resource during SendTemplatedEmail calls.
   * Providing the name allows grantSendEmail to scope the grant to that specific
   * ARN rather than using configuration-set/*.
   * Use "none" if no configuration set is associated with the sending identity.
   */
  sesConfigurationSetName: string;
}

export interface PipelineConfig {
  toolsAccount: string;
  toolsRegion: string;
  githubOwner: string;
  githubRepo: string;
  githubBranch: string;
  codestarConnectionArn: string;
  environments: Partial<Record<EnvConfig['envName'], EnvConfig>>;
}
