import * as cdk from 'aws-cdk-lib';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as ssm from 'aws-cdk-lib/aws-ssm';
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
 * Raw bucket:
 *   - Blocks all public access; enforces TLS-only (enforceSSL)
 *   - Lifecycle rule expires originals after config.photoRetentionDays days
 *   - Removal policy driven by config.enableDeletionProtection
 *
 * Processed bucket:
 *   - Blocks all public access; enforces TLS-only (enforceSSL)
 *   - NO expiry lifecycle rule — watermarked copies must outlive any runner's purchase
 *     entitlement. Expiring them at the same TTL as raw originals would break download
 *     links for runners who return after the raw expiry window.
 *   - Removal policy driven by config.enableDeletionProtection
 *
 * CloudFront:
 *   - OAI pattern (S3Origin) — CDK 2.137 does not ship S3BucketOrigin.withOriginAccessControl()
 *     (introduced in 2.146). Consistent with FrontendConstruct. Migrate to OAC when CDK ≥2.147.
 *   - ResponseHeadersPolicy adds Cache-Control: max-age=31536000, immutable so browser clients
 *     and CloudFront edge nodes never re-fetch a watermarked photo once cached. Photos are
 *     content-addressed (keys never change once written by the watermark Lambda).
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

    // ── Raw bucket CORS origins ───────────────────────────────────────────────
    // Mirrors the ApiConstruct CORS pattern.
    // Custom domain envs: lock to that origin.
    // No custom domain: read the CloudFront frontend origin from SSM context
    // (populated by generate-cdk-context.sh before synth). On first deploy the
    // SSM param doesn't exist yet → CDK returns a dummy → fall back to '*'.
    // Pipeline self-mutates and tightens CORS to the real domain on the next run.
    // dev env additionally allows localhost:4200 so engineers can test locally.
    const hasCustomDomain =
      config.domainName !== 'none' &&
      !config.domainName.startsWith('dummy-value-for-') &&
      config.certificateArn.startsWith('arn:');

    let rawCorsOrigins: string[];
    if (hasCustomDomain) {
      rawCorsOrigins = [`https://${config.domainName}`];
    } else {
      const frontendDomain = ssm.StringParameter.valueFromLookup(
        this,
        `/racephotos/env/${config.envName}/frontend-origin`,
      );
      if (frontendDomain.startsWith('dummy-value-for-')) {
        rawCorsOrigins = ['*'];
      } else {
        rawCorsOrigins = [`https://${frontendDomain}`];
      }
      if (config.envName === 'dev' && !rawCorsOrigins.includes('*')) {
        rawCorsOrigins.push('http://localhost:4200');
      }
    }

    // ── Raw bucket (private originals) ────────────────────────────────────────
    // Lambda execution role only — never publicly accessible (domain rule 7).
    // Originals are safe to expire after photoRetentionDays: the watermarked copy
    // in the processed bucket is the long-lived authoritative served version.
    this.rawBucket = new s3.Bucket(this, 'RawBucket', {
      bucketName: `racephotos-raw-${config.envName}`,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      removalPolicy,
      autoDeleteObjects: !config.enableDeletionProtection,
      lifecycleRules: [
        {
          id: 'expire-raw-originals',
          enabled: true,
          expiration: cdk.Duration.days(config.photoRetentionDays),
        },
      ],
      // CORS is required for browser XHR presigned PUT uploads (RS-006).
      // The bucket is private (blockPublicAccess) and authorization is
      // enforced by the presigned URL signature — CORS headers here only
      // control whether the browser's preflight OPTIONS is accepted.
      cors: [
        {
          allowedOrigins: rawCorsOrigins,
          allowedMethods: [s3.HttpMethods.PUT],
          allowedHeaders: ['Content-Type'],
          maxAge: 3000,
        },
      ],
    });

    // ── Processed bucket (watermarked copies) ─────────────────────────────────
    // Served exclusively via CloudFront OAI — not directly from S3.
    // No expiry rule: watermarked photos are the long-lived served asset.
    // Runners who purchased a photo must be able to download it indefinitely.
    this.processedBucket = new s3.Bucket(this, 'ProcessedBucket', {
      bucketName: `racephotos-processed-${config.envName}`,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      removalPolicy,
      autoDeleteObjects: !config.enableDeletionProtection,
    });

    // ── CloudFront response headers policy ────────────────────────────────────
    // Watermarked photos are content-addressed (key = photoId/processed/<uuid>.jpg).
    // max-age=31536000 (1 year) + immutable tells browsers never to revalidate,
    // achieving zero-latency repeat loads from the browser cache.
    const immutableCacheHeaders = new cloudfront.ResponseHeadersPolicy(
      this,
      'ImmutableCachePolicy',
      {
        responseHeadersPolicyName: `racephotos-immutable-cache-${config.envName}`,
        customHeadersBehavior: {
          customHeaders: [
            {
              header: 'Cache-Control',
              value: 'max-age=31536000, immutable',
              override: true,
            },
          ],
        },
      },
    );

    // ── CloudFront distribution (processed bucket) ────────────────────────────
    // OAI pattern — see class-level note about upgrading to OAC when CDK ≥2.147.
    const distribution = new cloudfront.Distribution(this, 'CdnDistribution', {
      comment: `racephotos-photos-cdn-${config.envName}`,
      defaultBehavior: {
        origin: new origins.S3Origin(this.processedBucket),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
        responseHeadersPolicy: immutableCacheHeaders,
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
