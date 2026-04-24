import * as path from 'path';
import * as apigatewayv2 from 'aws-cdk-lib/aws-apigatewayv2';
import * as integrations from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import * as cdk from 'aws-cdk-lib';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as s3 from 'aws-cdk-lib/aws-s3';
import { Construct } from 'constructs';

import { EnvConfig } from '../config/types';
import { ObservabilityConstruct } from './observability-construct';

interface PhotoUploadConstructProps {
  config: EnvConfig;
  /** The racephotos-raw-{envName} S3 bucket. */
  rawBucket: s3.Bucket;
  /** The racephotos-photos DynamoDB table. */
  photosTable: dynamodb.Table;
  /** The racephotos-events DynamoDB table (ownership check). */
  eventsTable: dynamodb.Table;
  /**
   * The HTTP API Gateway ID (from SSM valueForStringParameter).
   */
  httpApiId: string;
  /**
   * The Cognito JWT authorizer ID (from SSM valueForStringParameter).
   */
  httpAuthorizerId: string;
  /**
   * CloudFront distribution domain for the processed (watermarked) bucket.
   * Injected into list-event-photos Lambda as RACEPHOTOS_PHOTO_CDN_DOMAIN.
   */
  cdnDomainName: string;
}

/**
 * PhotoUploadConstruct — RS-006, RS-008, RS-019
 *
 * Creates:
 *   - presign-photos Lambda  POST /events/{eventId}/photos/presign  (Cognito JWT required)
 *   - list-event-photos Lambda  GET /events/{id}/photos  (Cognito JWT required)
 *   - list-public-event-photos Lambda  GET /events/{id}/public-photos  (no auth — public)
 *
 * IAM grants:
 *   - s3:PutObject on the raw bucket (photographer uploads go direct to S3)
 *   - dynamodb:BatchWriteItem on the photos table (creates Photo records)
 *   - dynamodb:GetItem on the events table (ownership check — both Lambdas)
 *   - dynamodb:Query on the photos table GSI (list-event-photos, list-public-event-photos)
 *   - dynamodb:GetItem on the events table (photoCount read — list-public-event-photos)
 *
 * AC: RS-006 AC1, AC2, AC3, AC9, AC10 / RS-008 AC1, AC2 / RS-019 AC1–AC11
 */
export class PhotoUploadConstruct extends Construct {
  readonly presignPhotosFn: lambda.Function;
  readonly listEventPhotosFn: lambda.Function;
  readonly listPublicEventPhotosFn: lambda.Function;

  constructor(scope: Construct, id: string, props: PhotoUploadConstructProps) {
    super(scope, id);

    const { config, rawBucket, photosTable, eventsTable, httpApiId, httpAuthorizerId, cdnDomainName } = props;

    // Import the HTTP API by ID — same pattern as EventConstruct (RS-005).
    const httpApi = apigatewayv2.HttpApi.fromHttpApiAttributes(this, 'HttpApi', { httpApiId });

    const jwtAuthorizer: apigatewayv2.IHttpRouteAuthorizer = {
      bind: () => ({
        authorizerId: httpAuthorizerId,
        authorizationType: apigatewayv2.HttpAuthorizerType.JWT,
      }),
    };

    // ── presign-photos Lambda ─────────────────────────────────────────────────
    this.presignPhotosFn = new lambda.Function(this, 'PresignPhotosFn', {
      functionName: `racephotos-presign-photos-${config.envName}`,
      runtime: lambda.Runtime.PROVIDED_AL2023,
      architecture: lambda.Architecture.ARM_64,
      handler: 'bootstrap',
      memorySize: 256,
      code: lambda.Code.fromAsset(path.join(__dirname, '../../../lambdas/presign-photos')),
      environment: {
        RACEPHOTOS_ENV: config.envName,
        RACEPHOTOS_RAW_BUCKET: rawBucket.bucketName,
        RACEPHOTOS_PHOTOS_TABLE: photosTable.tableName,
        RACEPHOTOS_EVENTS_TABLE: eventsTable.tableName,
      },
    });

    // Grant only s3:PutObject — grantPut() also grants s3:PutObjectAcl which is
    // unnecessary and would allow the role to change object visibility (security fix).
    this.presignPhotosFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['s3:PutObject'],
        resources: [rawBucket.arnForObjects('*')],
      }),
    );
    photosTable.grant(this.presignPhotosFn, 'dynamodb:BatchWriteItem');
    eventsTable.grant(this.presignPhotosFn, 'dynamodb:GetItem');

    new ObservabilityConstruct(this, 'PresignPhotosObs', {
      lambda: this.presignPhotosFn,
      logRetentionDays: config.photoRetentionDays,
    });

    new apigatewayv2.HttpRoute(this, 'PresignPhotosRoute', {
      httpApi,
      routeKey: apigatewayv2.HttpRouteKey.with(
        '/events/{eventId}/photos/presign',
        apigatewayv2.HttpMethod.POST,
      ),
      integration: new integrations.HttpLambdaIntegration(
        'PresignPhotosIntegration',
        this.presignPhotosFn,
      ),
      authorizer: jwtAuthorizer,
    });

    // ── list-event-photos Lambda ──────────────────────────────────────────────
    this.listEventPhotosFn = new lambda.Function(this, 'ListEventPhotosFn', {
      functionName: `racephotos-list-event-photos-${config.envName}`,
      runtime: lambda.Runtime.PROVIDED_AL2023,
      architecture: lambda.Architecture.ARM_64,
      handler: 'bootstrap',
      memorySize: 256,
      code: lambda.Code.fromAsset(path.join(__dirname, '../../../lambdas/list-event-photos')),
      environment: {
        RACEPHOTOS_ENV: config.envName,
        RACEPHOTOS_PHOTOS_TABLE: photosTable.tableName,
        RACEPHOTOS_EVENTS_TABLE: eventsTable.tableName,
        RACEPHOTOS_PHOTO_CDN_DOMAIN: cdnDomainName,
      },
    });

    // Grant Query scoped to the specific GSI only (not the full table or other indexes).
    // Using an explicit PolicyStatement instead of photosTable.grant() to avoid granting
    // access to future GSIs that may contain sensitive data (e.g. runner-email-index).
    this.listEventPhotosFn.addToRolePolicy(new iam.PolicyStatement({
      actions: ['dynamodb:Query'],
      resources: [
        photosTable.tableArn,
        `${photosTable.tableArn}/index/eventId-uploadedAt-index`,
      ],
    }));
    eventsTable.grant(this.listEventPhotosFn, 'dynamodb:GetItem');

    new ObservabilityConstruct(this, 'ListEventPhotosObs', {
      lambda: this.listEventPhotosFn,
      logRetentionDays: config.photoRetentionDays,
    });

    new apigatewayv2.HttpRoute(this, 'ListEventPhotosRoute', {
      httpApi,
      routeKey: apigatewayv2.HttpRouteKey.with(
        '/events/{id}/photos',
        apigatewayv2.HttpMethod.GET,
      ),
      integration: new integrations.HttpLambdaIntegration(
        'ListEventPhotosIntegration',
        this.listEventPhotosFn,
      ),
      authorizer: jwtAuthorizer,
    });

    // ── list-public-event-photos Lambda ──────────────────────────────────────
    // RS-019: public unauthenticated endpoint — no authorizer attached.
    this.listPublicEventPhotosFn = new lambda.Function(this, 'ListPublicEventPhotosFn', {
      functionName: `racephotos-list-public-event-photos-${config.envName}`,
      runtime: lambda.Runtime.PROVIDED_AL2023,
      architecture: lambda.Architecture.ARM_64,
      handler: 'bootstrap',
      memorySize: 256,
      // 10 s: up to 10 fill-to-limit DynamoDB Query rounds + concurrent GetItem + cold-start.
      // Matches the search Lambda timeout; without this the CDK default (3 s) would cause
      // hard 502s whenever more than 2–3 loop iterations are needed.
      timeout: cdk.Duration.seconds(10),
      code: lambda.Code.fromAsset(path.join(__dirname, '../../../lambdas/list-public-event-photos')),
      environment: {
        RACEPHOTOS_ENV: config.envName,
        RACEPHOTOS_PHOTOS_TABLE: photosTable.tableName,
        RACEPHOTOS_EVENTS_TABLE: eventsTable.tableName,
        RACEPHOTOS_PHOTO_CDN_DOMAIN: cdnDomainName,
      },
    });

    // Grant Query scoped to the specific GSI only.
    this.listPublicEventPhotosFn.addToRolePolicy(new iam.PolicyStatement({
      actions: ['dynamodb:Query'],
      resources: [
        photosTable.tableArn,
        `${photosTable.tableArn}/index/eventId-uploadedAt-index`,
      ],
    }));
    // GetItem on events table to read name, photoCount, pricePerPhoto, currency.
    eventsTable.grant(this.listPublicEventPhotosFn, 'dynamodb:GetItem');

    new ObservabilityConstruct(this, 'ListPublicEventPhotosObs', {
      lambda: this.listPublicEventPhotosFn,
      logRetentionDays: config.photoRetentionDays,
    });

    // No authorizer — public endpoint.
    new apigatewayv2.HttpRoute(this, 'ListPublicEventPhotosRoute', {
      httpApi,
      routeKey: apigatewayv2.HttpRouteKey.with(
        '/events/{id}/public-photos',
        apigatewayv2.HttpMethod.GET,
      ),
      integration: new integrations.HttpLambdaIntegration(
        'ListPublicEventPhotosIntegration',
        this.listPublicEventPhotosFn,
      ),
    });
  }
}
