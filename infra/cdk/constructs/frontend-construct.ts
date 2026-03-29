import * as path from 'path';
import * as fs from 'fs';
import * as cdk from 'aws-cdk-lib';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import { Construct } from 'constructs';
import { EnvConfig } from '../config/types';

interface FrontendConstructProps {
  config: EnvConfig;
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
 * config.json values come from SSM via deploy-time CfnParameters:
 *   /racephotos/env/{envName}/api-url       — written by ApiConstruct
 *   /racephotos/env/{envName}/user-pool-id  — written by CognitoConstruct
 *   /racephotos/env/{envName}/client-id     — written by CognitoConstruct
 *   config.region                           — literal string from EnvConfig
 *
 * valueForStringParameter creates AWS::SSM::Parameter::Value<String> CloudFormation
 * parameters resolved at deploy time — no CDK synth-time lookup, no lookup role
 * assumption required. AuthStack deploys before FrontendStack (addDependency),
 * so the SSM params always exist when CloudFormation resolves them.
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

    // Read AuthStack SSM outputs via deploy-time CloudFormation SSM parameters.
    //
    // valueForStringParameter creates a CfnParameter of type
    // AWS::SSM::Parameter::Value<String> in FrontendStack. CloudFormation
    // resolves it at deploy time by calling ssm:GetParameter within the same
    // (Dev) account — no synth-time lookup, no CDK lookup role assumption.
    //
    // The resulting token is a { Ref: <CfnParamLogicalId> } — which IS in
    // renderData's accepted intrinsics list (Ref / Fn::GetAtt / Fn::Select),
    // so Source.jsonData works without errors.
    //
    // AuthStack deploys before FrontendStack (addDependency in the stage),
    // so the SSM params exist by the time CloudFormation resolves them here.
    const apiBaseUrl = ssm.StringParameter.valueForStringParameter(
      this,
      `/racephotos/env/${config.envName}/api-url`,
    );
    const cognitoUserPoolId = ssm.StringParameter.valueForStringParameter(
      this,
      `/racephotos/env/${config.envName}/user-pool-id`,
    );
    const cognitoClientId = ssm.StringParameter.valueForStringParameter(
      this,
      `/racephotos/env/${config.envName}/client-id`,
    );

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
    //
    // Guard: BucketDeployment constructs the CDK bootstrap bucket name as
    //   cdk-hnb659fds-assets-{account}-{region}. On the first pipeline synth
    //   pass, valueFromLookup returns "dummy-value-for-..." for account and
    //   region, making the bucket name invalid. Skip deployment on that pass;
    //   the pipeline self-mutates and the second run has real values in context.
    const stack = cdk.Stack.of(this);
    const hasRealEnv =
      !stack.account.startsWith('dummy-value-for-') && !stack.region.startsWith('dummy-value-for-');

    const angularDistPath = path.join(
      __dirname,
      '../../../frontend/angular/dist/racephotos/browser',
    );
    const hasAngularDist = fs.existsSync(angularDistPath);

    if (hasRealEnv && !hasAngularDist) {
      throw new Error(
        `Angular build output not found at ${angularDistPath}.\n` +
          `Run: cd frontend/angular && npx ng build --configuration=production`,
      );
    }

    if (hasRealEnv) {
      new s3deploy.BucketDeployment(this, 'DeployFrontend', {
        sources: [
          s3deploy.Source.asset(angularDistPath),
          s3deploy.Source.jsonData('assets/config.json', {
            apiBaseUrl,
            cognitoUserPoolId,
            cognitoClientId,
            cognitoRegion: config.region,
          }),
        ],
        destinationBucket: websiteBucket,
        distribution,
        distributionPaths: ['/*'],
      });
    }

    // ── SSM: publish distribution domain for ApiConstruct CORS ────────────
    // ApiConstruct reads this via valueFromLookup (CDK context, not a
    // CloudFormation cross-stack reference) to avoid a circular dependency
    // between AuthStack and FrontendStack. On first deploy the value is a
    // dummy; the pipeline self-mutates and picks up the real domain on the
    // next synth run.
    new ssm.StringParameter(this, 'FrontendOriginParam', {
      parameterName: `/racephotos/env/${config.envName}/frontend-origin`,
      stringValue: distribution.distributionDomainName,
      description: `CloudFront domain for ${config.envName} — consumed by ApiConstruct CORS`,
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
