import * as path from 'path';
import * as apigatewayv2 from 'aws-cdk-lib/aws-apigatewayv2';
import * as integrations from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { Construct } from 'constructs';

import { EnvConfig } from '../config/types';
import { ObservabilityConstruct } from './observability-construct';

interface PhotographerConstructProps {
  config: EnvConfig;
  /** The racephotos-photographers DynamoDB table. */
  photographersTable: dynamodb.Table;
  /**
   * The HTTP API Gateway ID.
   *
   * Passed as a plain string (from SSM valueForStringParameter) rather than a
   * CDK HttpApi object to avoid a cross-stack cyclic dependency:
   * PhotographerStack → AuthStack (via httpApi prop) and
   * AuthStack → PhotographerStack (via route integration Lambda ARN).
   * Using an imported IHttpApi breaks the ownership chain so all route and
   * integration resources are created inside PhotographerStack.
   */
  httpApiId: string;
  /**
   * The Cognito JWT authorizer ID.
   *
   * Passed as a plain string (from SSM valueForStringParameter) to avoid the
   * same cross-stack cyclic dependency. The authorizer is imported via
   * HttpAuthorizer.fromHttpAuthorizerAttributes() and attached to every route
   * to ensure requests require a valid Cognito JWT.
   */
  httpAuthorizerId: string;
}

/**
 * PhotographerConstruct
 *
 * Creates:
 *   - get-photographer Lambda  → GET  /photographer/me (Cognito JWT required)
 *   - update-photographer Lambda → PUT  /photographer/me (Cognito JWT required)
 *
 * IAM:
 *   - get-photographer    : dynamodb:GetItem   on photographersTable
 *   - update-photographer : dynamodb:UpdateItem on photographersTable
 *                           (if_not_exists(createdAt) preserves CreatedAt — no pre-fetch needed)
 *
 * Authorization:
 *   Both routes explicitly attach the Cognito JWT authorizer imported from
 *   httpAuthorizerId (stored in SSM by ApiConstruct). HTTP API v2 has no
 *   API-level default authorizer — authorization is always set per route.
 *
 * AC: RS-004
 */
export class PhotographerConstruct extends Construct {
  readonly getPhotographerFn: lambda.Function;
  readonly updatePhotographerFn: lambda.Function;

  constructor(scope: Construct, id: string, props: PhotographerConstructProps) {
    super(scope, id);

    const { config, photographersTable, httpApiId, httpAuthorizerId } = props;

    // Import the HTTP API by ID so that HttpRoute/HttpIntegration resources are
    // owned by this stack (PhotographerStack) rather than AuthStack. This avoids
    // the cross-stack cycle: PhotographerStack→AuthStack (via httpApi object ref)
    // and AuthStack→PhotographerStack (via route integration Lambda ARN).
    const httpApi = apigatewayv2.HttpApi.fromHttpApiAttributes(this, 'HttpApi', { httpApiId });

    // Build an IHttpRouteAuthorizer from the stored authorizer ID. Without an
    // explicit authorizer, HttpRoute defaults to AuthorizationType: NONE (public).
    // An inline implementation is simpler than creating a CDK construct solely to
    // wrap a string — HttpAuthorizer.fromHttpAuthorizerAttributes() requires a
    // scope+id and creates a dummy construct with no extra benefit here.
    const jwtAuthorizer: apigatewayv2.IHttpRouteAuthorizer = {
      bind: () => ({
        authorizerId: httpAuthorizerId,
        authorizationType: apigatewayv2.HttpAuthorizerType.JWT,
      }),
    };

    // ── get-photographer Lambda ───────────────────────────────────────────────
    this.getPhotographerFn = new lambda.Function(this, 'GetPhotographerFn', {
      functionName: `racephotos-get-photographer-${config.envName}`,
      runtime: lambda.Runtime.PROVIDED_AL2023,
      architecture: lambda.Architecture.X86_64,
      handler: 'bootstrap',
      memorySize: 256,
      code: lambda.Code.fromAsset(path.join(__dirname, '../../../lambdas/get-photographer')),
      environment: {
        RACEPHOTOS_ENV: config.envName,
        RACEPHOTOS_PHOTOGRAPHERS_TABLE: photographersTable.tableName,
      },
    });

    photographersTable.grant(this.getPhotographerFn, 'dynamodb:GetItem');

    new ObservabilityConstruct(this, 'GetPhotographerObs', {
      lambda: this.getPhotographerFn,
      logRetentionDays: config.photoRetentionDays,
      // No DLQ — API Gateway-triggered Lambda, not SQS
    });

    new apigatewayv2.HttpRoute(this, 'GetPhotographerRoute', {
      httpApi,
      routeKey: apigatewayv2.HttpRouteKey.with('/photographer/me', apigatewayv2.HttpMethod.GET),
      integration: new integrations.HttpLambdaIntegration(
        'GetPhotographerIntegration',
        this.getPhotographerFn,
      ),
      authorizer: jwtAuthorizer,
    });

    // ── update-photographer Lambda ────────────────────────────────────────────
    this.updatePhotographerFn = new lambda.Function(this, 'UpdatePhotographerFn', {
      functionName: `racephotos-update-photographer-${config.envName}`,
      runtime: lambda.Runtime.PROVIDED_AL2023,
      architecture: lambda.Architecture.X86_64,
      handler: 'bootstrap',
      memorySize: 256,
      code: lambda.Code.fromAsset(path.join(__dirname, '../../../lambdas/update-photographer')),
      environment: {
        RACEPHOTOS_ENV: config.envName,
        RACEPHOTOS_PHOTOGRAPHERS_TABLE: photographersTable.tableName,
      },
    });

    // update-photographer uses UpdateItem with if_not_exists(createdAt) — single round-trip.
    photographersTable.grant(this.updatePhotographerFn, 'dynamodb:UpdateItem');

    new ObservabilityConstruct(this, 'UpdatePhotographerObs', {
      lambda: this.updatePhotographerFn,
      logRetentionDays: config.photoRetentionDays,
    });

    new apigatewayv2.HttpRoute(this, 'UpdatePhotographerRoute', {
      httpApi,
      routeKey: apigatewayv2.HttpRouteKey.with('/photographer/me', apigatewayv2.HttpMethod.PUT),
      integration: new integrations.HttpLambdaIntegration(
        'UpdatePhotographerIntegration',
        this.updatePhotographerFn,
      ),
      authorizer: jwtAuthorizer,
    });
  }
}
