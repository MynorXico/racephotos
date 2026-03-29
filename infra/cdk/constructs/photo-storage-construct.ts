import * as cdk from 'aws-cdk-lib';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import { Construct } from 'constructs';
import { EnvConfig } from '../config/types';

interface PhotoStorageConstructProps {
  config: EnvConfig;
}

/**
 * PhotoStorageConstruct
 *
 * Creates:
 *   - racephotos-raw-{envName}       — private bucket for original, unwatermarked uploads
 *   - racephotos-processed-{envName} — private bucket for watermarked copies served via CloudFront
 *   - CloudFront distribution with OAI in front of the processed bucket
 *
 * Both buckets:
 *   - Block all public access (originals are never publicly accessible; AC7)
 *   - Lifecycle rule expires objects after config.photoRetentionDays days
 *   - Removal policy driven by config.enableDeletionProtection
 *
 * CloudFront note: CDK 2.137 does not yet ship S3BucketOrigin.withOriginAccessControl()
 * (introduced in 2.146). OAI (S3Origin) is used here for consistency with
 * FrontendConstruct. Migrate to OAC when CDK is bumped to ≥2.147.
 *
 * AC: RS-001 AC1, AC7
 */
export class PhotoStorageConstruct extends Construct {
  /** The raw (private, original) S3 bucket. Never expose keys from this bucket in API responses. */
  readonly rawBucket: s3.Bucket;
  /** The processed (watermarked) S3 bucket. Served via CloudFront only. */
  readonly processedBucket: s3.Bucket;
  /** CloudFront distribution domain name for the processed bucket. */
  readonly cdnDomainName: string;

  constructor(scope: Construct, id: string, props: PhotoStorageConstructProps) {
    super(scope, id);

    const { config } = props;

    const removalPolicy = config.enableDeletionProtection
      ? cdk.RemovalPolicy.RETAIN
      : cdk.RemovalPolicy.DESTROY;

    const lifecycleRule: s3.LifecycleRule = {
      id: 'expire-objects',
      enabled: true,
      expiration: cdk.Duration.days(config.photoRetentionDays),
    };

    // ── Raw bucket (private originals) ────────────────────────────────────────
    // Lambda execution role only — never publicly accessible (domain rule 7).
    this.rawBucket = new s3.Bucket(this, 'RawBucket', {
      bucketName: `racephotos-raw-${config.envName}`,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      removalPolicy,
      autoDeleteObjects: !config.enableDeletionProtection,
      lifecycleRules: [lifecycleRule],
    });

    // ── Processed bucket (watermarked copies) ─────────────────────────────────
    // Served exclusively via CloudFront OAI — not directly from S3.
    this.processedBucket = new s3.Bucket(this, 'ProcessedBucket', {
      bucketName: `racephotos-processed-${config.envName}`,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      removalPolicy,
      autoDeleteObjects: !config.enableDeletionProtection,
      lifecycleRules: [lifecycleRule],
    });

    // ── CloudFront distribution (processed bucket) ────────────────────────────
    // OAI pattern — see class-level note about upgrading to OAC when CDK ≥2.147.
    const distribution = new cloudfront.Distribution(this, 'CdnDistribution', {
      comment: `racephotos-photos-cdn-${config.envName}`,
      defaultBehavior: {
        origin: new origins.S3Origin(this.processedBucket),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
      },
    });

    this.cdnDomainName = distribution.distributionDomainName;

    // ── Outputs ───────────────────────────────────────────────────────────────
    // cdnDomainName is a construct output so downstream Lambda constructs can
    // inject it as RACEPHOTOS_CDN_DOMAIN without querying CloudFormation.
    new cdk.CfnOutput(this, 'CdnDomainName', {
      value: distribution.distributionDomainName,
      description: `CloudFront CDN domain for processed photos — ${config.envName}`,
    });
  }
}
