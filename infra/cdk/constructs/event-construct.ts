import * as path from 'path';
import * as apigatewayv2 from 'aws-cdk-lib/aws-apigatewayv2';
import * as integrations from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { Construct } from 'constructs';

import { EnvConfig } from '../config/types';
import { ObservabilityConstruct } from './observability-construct';

interface EventConstructProps {
  config: EnvConfig;
  /** The racephotos-events DynamoDB table. */
  eventsTable: dynamodb.Table;
  /** The racephotos-photographers DynamoDB table (read by create-event for defaultCurrency). */
  photographersTable: dynamodb.Table;
  /**
   * The HTTP API Gateway ID, passed as a plain string (from SSM valueForStringParameter)
   * to avoid a cross-stack cyclic dependency.
   */
  httpApiId: string;
  /**
   * The Cognito JWT authorizer ID, passed as a plain string (from SSM valueForStringParameter).
   */
  httpAuthorizerId: string;
}

/**
 * EventConstruct — RS-005, RS-014
 *
 * Creates six Lambda functions for event management:
 *   - create-event              → POST /events                  (Cognito JWT required)
 *   - get-event                 → GET  /events/{id}             (no auth — public)
 *   - update-event              → PUT  /events/{id}             (Cognito JWT required)
 *   - archive-event             → PUT  /events/{id}/archive     (Cognito JWT required)
 *   - list-photographer-events  → GET  /photographer/me/events  (Cognito JWT required)
 *   - list-events               → GET  /events                  (no auth — public)
 *
 * IAM grants:
 *   - create-event             : dynamodb:PutItem on eventsTable
 *                                dynamodb:GetItem on photographersTable (read defaultCurrency)
 *   - get-event                : dynamodb:GetItem on eventsTable
 *   - update-event             : dynamodb:GetItem + dynamodb:UpdateItem on eventsTable
 *   - archive-event            : dynamodb:GetItem + dynamodb:UpdateItem on eventsTable
 *   - list-photographer-events : dynamodb:Query on eventsTable
 *   - list-events              : dynamodb:Query on eventsTable (status-createdAt-index GSI)
 *
 * AC: RS-005, RS-014
 */
export class EventConstruct extends Construct {
  readonly createEventFn: lambda.Function;
  readonly getEventFn: lambda.Function;
  readonly updateEventFn: lambda.Function;
  readonly archiveEventFn: lambda.Function;
  readonly listPhotographerEventsFn: lambda.Function;
  readonly listEventsFn: lambda.Function;

  constructor(scope: Construct, id: string, props: EventConstructProps) {
    super(scope, id);

    const { config, eventsTable, photographersTable, httpApiId, httpAuthorizerId } = props;

    // Import the HTTP API by ID so all route/integration resources are owned by EventStack.
    const httpApi = apigatewayv2.HttpApi.fromHttpApiAttributes(this, 'HttpApi', { httpApiId });

    // JWT authorizer — attached to every route except get-event (public).
    const jwtAuthorizer: apigatewayv2.IHttpRouteAuthorizer = {
      bind: () => ({
        authorizerId: httpAuthorizerId,
        authorizationType: apigatewayv2.HttpAuthorizerType.JWT,
      }),
    };

    // ── create-event Lambda ───────────────────────────────────────────────────
    this.createEventFn = new lambda.Function(this, 'CreateEventFn', {
      functionName: `racephotos-create-event-${config.envName}`,
      runtime: lambda.Runtime.PROVIDED_AL2023,
      architecture: lambda.Architecture.X86_64,
      handler: 'bootstrap',
      memorySize: 256,
      code: lambda.Code.fromAsset(path.join(__dirname, '../../../lambdas/create-event')),
      environment: {
        RACEPHOTOS_ENV: config.envName,
        RACEPHOTOS_EVENTS_TABLE: eventsTable.tableName,
        RACEPHOTOS_PHOTOGRAPHERS_TABLE: photographersTable.tableName,
      },
    });

    eventsTable.grant(this.createEventFn, 'dynamodb:PutItem');
    photographersTable.grant(this.createEventFn, 'dynamodb:GetItem');

    new ObservabilityConstruct(this, 'CreateEventObs', {
      lambda: this.createEventFn,
      logRetentionDays: config.photoRetentionDays,
    });

    new apigatewayv2.HttpRoute(this, 'CreateEventRoute', {
      httpApi,
      routeKey: apigatewayv2.HttpRouteKey.with('/events', apigatewayv2.HttpMethod.POST),
      integration: new integrations.HttpLambdaIntegration('CreateEventIntegration', this.createEventFn),
      authorizer: jwtAuthorizer,
    });

    // ── get-event Lambda ──────────────────────────────────────────────────────
    this.getEventFn = new lambda.Function(this, 'GetEventFn', {
      functionName: `racephotos-get-event-${config.envName}`,
      runtime: lambda.Runtime.PROVIDED_AL2023,
      architecture: lambda.Architecture.X86_64,
      handler: 'bootstrap',
      memorySize: 256,
      code: lambda.Code.fromAsset(path.join(__dirname, '../../../lambdas/get-event')),
      environment: {
        RACEPHOTOS_ENV: config.envName,
        RACEPHOTOS_EVENTS_TABLE: eventsTable.tableName,
      },
    });

    eventsTable.grant(this.getEventFn, 'dynamodb:GetItem');

    new ObservabilityConstruct(this, 'GetEventObs', {
      lambda: this.getEventFn,
      logRetentionDays: config.photoRetentionDays,
    });

    // get-event is public — no authorizer.
    new apigatewayv2.HttpRoute(this, 'GetEventRoute', {
      httpApi,
      routeKey: apigatewayv2.HttpRouteKey.with('/events/{id}', apigatewayv2.HttpMethod.GET),
      integration: new integrations.HttpLambdaIntegration('GetEventIntegration', this.getEventFn),
    });

    // ── update-event Lambda ───────────────────────────────────────────────────
    this.updateEventFn = new lambda.Function(this, 'UpdateEventFn', {
      functionName: `racephotos-update-event-${config.envName}`,
      runtime: lambda.Runtime.PROVIDED_AL2023,
      architecture: lambda.Architecture.X86_64,
      handler: 'bootstrap',
      memorySize: 256,
      code: lambda.Code.fromAsset(path.join(__dirname, '../../../lambdas/update-event')),
      environment: {
        RACEPHOTOS_ENV: config.envName,
        RACEPHOTOS_EVENTS_TABLE: eventsTable.tableName,
      },
    });

    eventsTable.grant(this.updateEventFn, 'dynamodb:GetItem', 'dynamodb:UpdateItem');

    new ObservabilityConstruct(this, 'UpdateEventObs', {
      lambda: this.updateEventFn,
      logRetentionDays: config.photoRetentionDays,
    });

    new apigatewayv2.HttpRoute(this, 'UpdateEventRoute', {
      httpApi,
      routeKey: apigatewayv2.HttpRouteKey.with('/events/{id}', apigatewayv2.HttpMethod.PUT),
      integration: new integrations.HttpLambdaIntegration('UpdateEventIntegration', this.updateEventFn),
      authorizer: jwtAuthorizer,
    });

    // ── archive-event Lambda ──────────────────────────────────────────────────
    this.archiveEventFn = new lambda.Function(this, 'ArchiveEventFn', {
      functionName: `racephotos-archive-event-${config.envName}`,
      runtime: lambda.Runtime.PROVIDED_AL2023,
      architecture: lambda.Architecture.X86_64,
      handler: 'bootstrap',
      memorySize: 256,
      code: lambda.Code.fromAsset(path.join(__dirname, '../../../lambdas/archive-event')),
      environment: {
        RACEPHOTOS_ENV: config.envName,
        RACEPHOTOS_EVENTS_TABLE: eventsTable.tableName,
      },
    });

    eventsTable.grant(this.archiveEventFn, 'dynamodb:GetItem', 'dynamodb:UpdateItem');

    new ObservabilityConstruct(this, 'ArchiveEventObs', {
      lambda: this.archiveEventFn,
      logRetentionDays: config.photoRetentionDays,
    });

    new apigatewayv2.HttpRoute(this, 'ArchiveEventRoute', {
      httpApi,
      routeKey: apigatewayv2.HttpRouteKey.with('/events/{id}/archive', apigatewayv2.HttpMethod.PUT),
      integration: new integrations.HttpLambdaIntegration('ArchiveEventIntegration', this.archiveEventFn),
      authorizer: jwtAuthorizer,
    });

    // ── list-photographer-events Lambda ───────────────────────────────────────
    this.listPhotographerEventsFn = new lambda.Function(this, 'ListPhotographerEventsFn', {
      functionName: `racephotos-list-photographer-events-${config.envName}`,
      runtime: lambda.Runtime.PROVIDED_AL2023,
      architecture: lambda.Architecture.X86_64,
      handler: 'bootstrap',
      memorySize: 256,
      code: lambda.Code.fromAsset(path.join(__dirname, '../../../lambdas/list-photographer-events')),
      environment: {
        RACEPHOTOS_ENV: config.envName,
        RACEPHOTOS_EVENTS_TABLE: eventsTable.tableName,
      },
    });

    eventsTable.grant(this.listPhotographerEventsFn, 'dynamodb:Query');

    new ObservabilityConstruct(this, 'ListPhotographerEventsObs', {
      lambda: this.listPhotographerEventsFn,
      logRetentionDays: config.photoRetentionDays,
    });

    new apigatewayv2.HttpRoute(this, 'ListPhotographerEventsRoute', {
      httpApi,
      routeKey: apigatewayv2.HttpRouteKey.with('/photographer/me/events', apigatewayv2.HttpMethod.GET),
      integration: new integrations.HttpLambdaIntegration('ListPhotographerEventsIntegration', this.listPhotographerEventsFn),
      authorizer: jwtAuthorizer,
    });

    // ── list-events Lambda ────────────────────────────────────────────────────
    this.listEventsFn = new lambda.Function(this, 'ListEventsFn', {
      functionName: `racephotos-list-events-${config.envName}`,
      runtime: lambda.Runtime.PROVIDED_AL2023,
      architecture: lambda.Architecture.X86_64,
      handler: 'bootstrap',
      memorySize: 256,
      code: lambda.Code.fromAsset(path.join(__dirname, '../../../lambdas/list-events')),
      environment: {
        RACEPHOTOS_ENV: config.envName,
        RACEPHOTOS_EVENTS_TABLE: eventsTable.tableName,
      },
    });

    // Query on status-createdAt-index GSI — needs dynamodb:Query on the table.
    eventsTable.grant(this.listEventsFn, 'dynamodb:Query');

    new ObservabilityConstruct(this, 'ListEventsObs', {
      lambda: this.listEventsFn,
      logRetentionDays: config.photoRetentionDays,
    });

    // list-events is public — no authorizer.
    new apigatewayv2.HttpRoute(this, 'ListEventsRoute', {
      httpApi,
      routeKey: apigatewayv2.HttpRouteKey.with('/events', apigatewayv2.HttpMethod.GET),
      integration: new integrations.HttpLambdaIntegration('ListEventsIntegration', this.listEventsFn),
    });
  }
}
