import * as path from 'path';
import * as cdk from 'aws-cdk-lib';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import { Construct } from 'constructs';
import { EnvConfig } from '../config/types';

/**
 * Cognito values needed for the Angular runtime config.json.
 * Passed in from CognitoConstruct once it is built (RS-007).
 * Until then, FrontendConstruct defaults to placeholder strings.
 */
export interface CognitoConfig {
  userPoolId: string;
  clientId: string;
  /** Cognito hosted-UI domain without protocol, e.g. "auth.dev.example.com" */
  oauthDomain: string;
}

interface FrontendConstructProps {
  config: EnvConfig;
  /**
   * API Gateway base URL injected by ApiConstruct (RS-002).
   * Placeholder until that construct exists.
   */
  apiBaseUrl?: string;
  /**
   * Cognito values injected by CognitoConstruct (RS-007).
   * Placeholder until that construct exists.
   */
  cognitoConfig?: CognitoConfig;
}

/**
 * FrontendConstruct
 *
 * Creates:
 *   - Private S3 bucket (no public access, served only via CloudFront)
 *   - CloudFront distribution with OAC, SPA error handling, HTTPS redirect
 *   - BucketDeployment that uploads the Angular build and injects an
 *     environment-specific config.json (overwriting the committed placeholder)
 *
 * Custom domain + ACM certificate are wired in when config.domainName !== "none".
 * Both values come from SSM via PipelineStack.loadConfig() — nothing is hardcoded.
 *
 * config.json values come from:
 *   - config.region            — already in EnvConfig
 *   - apiBaseUrl prop          — from ApiConstruct output (future), placeholder now
 *   - cognitoConfig prop       — from CognitoConstruct output (RS-007), placeholder now
 *   - config.domainName        — used to derive cognitoOauthDomain when custom domain set
 */
export class FrontendConstruct extends Construct {
  /** CloudFront domain name — use as the CNAME target when configuring DNS. */
  readonly distributionDomainName: string;

  constructor(scope: Construct, id: string, props: FrontendConstructProps) {
    super(scope, id);

    const { config } = props;
    // Guard against the CDK valueFromLookup dummy value ("dummy-value-for-...")
    // that is substituted on the first synth pass before the context cache is
    // populated. We only treat the domain as active when both domainName and
    // certificateArn look like real values; the pipeline self-mutates and the
    // second synth will have the real ARN in context.
    const hasCustomDomain =
      config.domainName !== 'none' && config.certificateArn.startsWith('arn:');

    const apiBaseUrl = props.apiBaseUrl ?? 'https://REPLACE_WITH_API_URL';
    const cognito: CognitoConfig = props.cognitoConfig ?? {
      userPoolId: 'REPLACE_WITH_USER_POOL_ID',
      clientId: 'REPLACE_WITH_CLIENT_ID',
      oauthDomain: hasCustomDomain ? `auth.${config.domainName}` : 'REPLACE_WITH_OAUTH_DOMAIN',
    };

    // ── S3 bucket (private — accessible only via CloudFront OAC) ──────────
    const websiteBucket = new s3.Bucket(this, 'WebsiteBucket', {
      bucketName: `racephotos-frontend-${config.envName}`,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      removalPolicy: config.enableDeletionProtection
        ? cdk.RemovalPolicy.RETAIN
        : cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: !config.enableDeletionProtection,
    });

    // ── CloudFront distribution ────────────────────────────────────────────
    const distributionProps: cloudfront.DistributionProps = {
      defaultBehavior: {
        // S3Origin uses Origin Access Identity (OAI) — available in CDK 2.137.
        // Upgrade to S3BucketOrigin.withOriginAccessControl() when CDK is
        // bumped to ≥2.147 (OAC is the modern replacement for OAI).
        origin: new origins.S3Origin(websiteBucket),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
      },
      defaultRootObject: 'index.html',
      // SPA routing: 403/404 from S3 → serve index.html with 200.
      // Angular's router handles the path client-side.
      errorResponses: [
        {
          httpStatus: 403,
          responseHttpStatus: 200,
          responsePagePath: '/index.html',
        },
        {
          httpStatus: 404,
          responseHttpStatus: 200,
          responsePagePath: '/index.html',
        },
      ],
      ...(hasCustomDomain && {
        domainNames: [config.domainName],
        certificate: acm.Certificate.fromCertificateArn(this, 'Certificate', config.certificateArn),
      }),
    };

    const distribution = new cloudfront.Distribution(this, 'Distribution', distributionProps);

    this.distributionDomainName = distribution.distributionDomainName;

    // ── Deploy Angular build + inject environment-specific config.json ─────
    //
    // Source 1: Angular dist/browser/ — the compiled application bundle.
    //   Bundled as a CDK asset during `cdk synth`. The Angular build must
    //   have run before `cdk synth` — the pipeline Synth ShellStep does this.
    //
    // Source 2: Source.jsonData — generates assets/config.json with real
    //   per-environment values, overwriting the placeholder committed to the repo.
    //   This is what makes the single-build, multi-environment pattern work.
    new s3deploy.BucketDeployment(this, 'DeployFrontend', {
      sources: [
        s3deploy.Source.asset(
          path.join(__dirname, '../../../frontend/angular/dist/racephotos/browser'),
        ),
        s3deploy.Source.jsonData('assets/config.json', {
          apiBaseUrl,
          region: config.region,
          cognitoUserPoolId: cognito.userPoolId,
          cognitoClientId: cognito.clientId,
          cognitoOauthDomain: cognito.oauthDomain,
        }),
      ],
      destinationBucket: websiteBucket,
      distribution,
      distributionPaths: ['/*'],
    });

    // ── CloudFormation outputs ─────────────────────────────────────────────
    new cdk.CfnOutput(this, 'FrontendUrl', {
      value: hasCustomDomain
        ? `https://${config.domainName}`
        : `https://${distribution.distributionDomainName}`,
      description: `Frontend URL — ${config.envName}`,
    });

    new cdk.CfnOutput(this, 'CloudFrontDomain', {
      value: distribution.distributionDomainName,
      description: `CloudFront domain — use as CNAME target in DNS (${config.envName})`,
    });
  }
}
