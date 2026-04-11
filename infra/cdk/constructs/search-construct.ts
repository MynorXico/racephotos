import * as path from 'path';
import * as apigatewayv2 from 'aws-cdk-lib/aws-apigatewayv2';
import * as integrations from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { Construct } from 'constructs';

import { EnvConfig } from '../config/types';
import { ObservabilityConstruct } from './observability-construct';

interface SearchConstructProps {
  config: EnvConfig;
  /** The racephotos-bib-index DynamoDB table. */
  bibIndexTable: dynamodb.Table;
  /** The racephotos-photos DynamoDB table. */
  photosTable: dynamodb.Table;
  /** The racephotos-events DynamoDB table. */
  eventsTable: dynamodb.Table;
  /**
   * The HTTP API Gateway ID (from SSM valueForStringParameter).
   * Passed as a plain string to avoid cross-stack cyclic dependencies.
   */
  httpApiId: string;
  /**
   * CloudFront distribution domain for the processed (watermarked) bucket.
   * Injected as RACEPHOTOS_PHOTO_CDN_DOMAIN.
   */
  cdnDomainName: string;
}

/**
 * SearchConstruct — RS-009
 *
 * Creates:
 *   - search Lambda  GET /events/{id}/photos/search  (no auth — runner-facing)
 *
 * IAM grants:
 *   - dynamodb:Query on bibIndexTable (bib-index fan-out lookup)
 *   - dynamodb:BatchGetItem on photosTable (fetch photo records by ID)
 *   - dynamodb:GetItem on eventsTable (event existence + metadata)
 *
 * Authorization:
 *   This route is public — no Cognito JWT authorizer is attached.
 *   Runner-facing search requires no authentication (Journey 2).
 *
 * AC: RS-009 AC1–AC4, AC10
 */
export class SearchConstruct extends Construct {
  readonly searchFn: lambda.Function;

  constructor(scope: Construct, id: string, props: SearchConstructProps) {
    super(scope, id);

    const { config, bibIndexTable, photosTable, eventsTable, httpApiId, cdnDomainName } = props;

    // Import the HTTP API by ID — same pattern as EventConstruct (RS-005).
    const httpApi = apigatewayv2.HttpApi.fromHttpApiAttributes(this, 'HttpApi', { httpApiId });

    // ── search Lambda ─────────────────────────────────────────────────────────
    this.searchFn = new lambda.Function(this, 'SearchFn', {
      functionName: `racephotos-search-${config.envName}`,
      runtime: lambda.Runtime.PROVIDED_AL2023,
      architecture: lambda.Architecture.X86_64,
      handler: 'bootstrap',
      memorySize: 256,
      code: lambda.Code.fromAsset(path.join(__dirname, '../../../lambdas/search')),
      environment: {
        RACEPHOTOS_ENV: config.envName,
        RACEPHOTOS_BIB_INDEX_TABLE: bibIndexTable.tableName,
        RACEPHOTOS_PHOTOS_TABLE: photosTable.tableName,
        RACEPHOTOS_EVENTS_TABLE: eventsTable.tableName,
        RACEPHOTOS_PHOTO_CDN_DOMAIN: cdnDomainName,
      },
    });

    // Grant Query scoped to the bib-index table only.
    bibIndexTable.grant(this.searchFn, 'dynamodb:Query');

    // Grant BatchGetItem scoped to the photos table only.
    photosTable.grant(this.searchFn, 'dynamodb:BatchGetItem');

    // Grant GetItem scoped to the events table (existence check + metadata).
    eventsTable.grant(this.searchFn, 'dynamodb:GetItem');

    new ObservabilityConstruct(this, 'SearchObs', {
      lambda: this.searchFn,
      logRetentionDays: config.photoRetentionDays,
      // No DLQ — API Gateway-triggered Lambda, not SQS
    });

    // Route is public — HttpNoneAuthorizer is the default when no authorizer
    // is passed (HTTP API v2 routes default to AuthorizationType: NONE).
    new apigatewayv2.HttpRoute(this, 'SearchRoute', {
      httpApi,
      routeKey: apigatewayv2.HttpRouteKey.with(
        '/events/{id}/photos/search',
        apigatewayv2.HttpMethod.GET,
      ),
      integration: new integrations.HttpLambdaIntegration('SearchIntegration', this.searchFn),
    });
  }
}
