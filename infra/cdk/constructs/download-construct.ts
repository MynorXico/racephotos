import * as path from 'path';
import * as cdk from 'aws-cdk-lib';
import * as apigatewayv2 from 'aws-cdk-lib/aws-apigatewayv2';
import * as integrations from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as s3 from 'aws-cdk-lib/aws-s3';
import { Construct } from 'constructs';

import { EnvConfig } from '../config/types';
import { ObservabilityConstruct } from './observability-construct';
import { SesConstruct } from './ses-construct';

interface DownloadConstructProps {
  config: EnvConfig;
  /** The racephotos-purchases DynamoDB table. */
  purchasesTable: dynamodb.Table;
  /** The racephotos-photos DynamoDB table. */
  photosTable: dynamodb.Table;
  /** The racephotos-rate-limits DynamoDB table. */
  rateLimitsTable: dynamodb.Table;
  /** Private S3 bucket containing original unwatermarked photos. */
  rawBucket: s3.Bucket;
  /** SES construct — grants ses:SendEmail and ses:SendTemplatedEmail. */
  ses: SesConstruct;
  /**
   * The HTTP API Gateway ID (from SSM valueForStringParameter).
   * Passed as a plain string to avoid cross-stack cyclic dependencies.
   */
  httpApiId: string;
  /**
   * SES sender address (from SSM valueForStringParameter).
   * Injected as RACEPHOTOS_SES_FROM_ADDRESS.
   */
  sesFromAddress: string;
  /**
   * Base URL for the runner-facing app (no trailing slash).
   * Injected as RACEPHOTOS_APP_BASE_URL into redownload-resend to build
   * download links: {appBaseUrl}/download/{token}.
   */
  appBaseUrl: string;
}

/**
 * DownloadConstruct — RS-012
 *
 * Creates:
 *   - get-download Lambda        GET /download/{token}               (no auth — public)
 *   - redownload-resend Lambda   POST /purchases/redownload-resend   (no auth — public)
 *
 * IAM grants:
 *   get-download:
 *     - s3:GetObject on rawBucket (presign requires execution-role permission)
 *     - dynamodb:Query on purchasesTable/index/downloadToken-index
 *     - dynamodb:GetItem on photosTable
 *   redownload-resend:
 *     - dynamodb:Query on purchasesTable/index/runnerEmail-claimedAt-index
 *     - dynamodb:UpdateItem + GetItem on rateLimitsTable
 *     - ses:SendEmail + ses:SendTemplatedEmail (via SesConstruct.grantSendEmail)
 *
 * Authorization:
 *   Both routes are public — no Cognito JWT authorizer is attached.
 *
 * AC: RS-012 AC1–AC7
 */
export class DownloadConstruct extends Construct {
  readonly getDownloadFn: lambda.Function;
  readonly redownloadResendFn: lambda.Function;

  constructor(scope: Construct, id: string, props: DownloadConstructProps) {
    super(scope, id);

    const {
      config,
      purchasesTable,
      photosTable,
      rateLimitsTable,
      rawBucket,
      ses,
      httpApiId,
      sesFromAddress,
      appBaseUrl,
    } = props;

    const httpApi = apigatewayv2.HttpApi.fromHttpApiAttributes(this, 'HttpApi', { httpApiId });

    // ── get-download Lambda ───────────────────────────────────────────────────
    this.getDownloadFn = new lambda.Function(this, 'GetDownloadFn', {
      functionName: `racephotos-get-download-${config.envName}`,
      runtime: lambda.Runtime.PROVIDED_AL2023,
      architecture: lambda.Architecture.ARM_64,
      handler: 'bootstrap',
      memorySize: 256,
      timeout: cdk.Duration.seconds(10),
      code: lambda.Code.fromAsset(path.join(__dirname, '../../../lambdas/get-download')),
      environment: {
        RACEPHOTOS_ENV: config.envName,
        RACEPHOTOS_PURCHASES_TABLE: purchasesTable.tableName,
        RACEPHOTOS_PHOTOS_TABLE: photosTable.tableName,
        RACEPHOTOS_RAW_BUCKET: rawBucket.bucketName,
      },
    });

    // s3:GetObject on the raw bucket — presigning requires the execution role to hold
    // GetObject even though the URL is not fetched server-side. grantRead() would
    // also add s3:ListBucket (bucket enumeration), so we grant only GetObject.
    this.getDownloadFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['s3:GetObject'],
        resources: [`${rawBucket.bucketArn}/*`],
      }),
    );

    // dynamodb:Query on downloadToken-index GSI (purchases table).
    this.getDownloadFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['dynamodb:Query'],
        resources: [`${purchasesTable.tableArn}/index/downloadToken-index`],
      }),
    );

    // dynamodb:GetItem on the photos base table.
    photosTable.grant(this.getDownloadFn, 'dynamodb:GetItem');

    new ObservabilityConstruct(this, 'GetDownloadObs', {
      lambda: this.getDownloadFn,
      logRetentionDays: config.photoRetentionDays,
    });

    new apigatewayv2.HttpRoute(this, 'GetDownloadRoute', {
      httpApi,
      routeKey: apigatewayv2.HttpRouteKey.with('/download/{token}', apigatewayv2.HttpMethod.GET),
      integration: new integrations.HttpLambdaIntegration(
        'GetDownloadIntegration',
        this.getDownloadFn,
      ),
    });

    // ── redownload-resend Lambda ──────────────────────────────────────────────
    this.redownloadResendFn = new lambda.Function(this, 'RedownloadResendFn', {
      functionName: `racephotos-redownload-resend-${config.envName}`,
      runtime: lambda.Runtime.PROVIDED_AL2023,
      architecture: lambda.Architecture.ARM_64,
      handler: 'bootstrap',
      memorySize: 256,
      timeout: cdk.Duration.seconds(15),
      code: lambda.Code.fromAsset(path.join(__dirname, '../../../lambdas/redownload-resend')),
      environment: {
        RACEPHOTOS_ENV: config.envName,
        RACEPHOTOS_PURCHASES_TABLE: purchasesTable.tableName,
        RACEPHOTOS_SES_FROM_ADDRESS: sesFromAddress,
        RACEPHOTOS_RATE_LIMITS_TABLE: rateLimitsTable.tableName,
        RACEPHOTOS_APP_BASE_URL: appBaseUrl,
      },
    });

    // dynamodb:Query on runnerEmail-claimedAt-index GSI (purchases table).
    this.redownloadResendFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['dynamodb:Query'],
        resources: [`${purchasesTable.tableArn}/index/runnerEmail-claimedAt-index`],
      }),
    );

    // dynamodb:UpdateItem + GetItem on the rate-limits base table.
    rateLimitsTable.grant(this.redownloadResendFn, 'dynamodb:UpdateItem', 'dynamodb:GetItem');

    // SES grant — SendEmail + SendTemplatedEmail on the verified identity ARN.
    ses.grantSendEmail(this.redownloadResendFn);

    new ObservabilityConstruct(this, 'RedownloadResendObs', {
      lambda: this.redownloadResendFn,
      logRetentionDays: config.photoRetentionDays,
    });

    new apigatewayv2.HttpRoute(this, 'RedownloadResendRoute', {
      httpApi,
      routeKey: apigatewayv2.HttpRouteKey.with(
        '/purchases/redownload-resend',
        apigatewayv2.HttpMethod.POST,
      ),
      integration: new integrations.HttpLambdaIntegration(
        'RedownloadResendIntegration',
        this.redownloadResendFn,
      ),
    });
  }
}
