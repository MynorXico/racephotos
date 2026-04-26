import * as path from 'path';
import * as cdk from 'aws-cdk-lib';
import * as apigatewayv2 from 'aws-cdk-lib/aws-apigatewayv2';
import * as integrations from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { Construct } from 'constructs';

import { EnvConfig } from '../config/types';
import { ObservabilityConstruct } from './observability-construct';
import { SesConstruct } from './ses-construct';

interface PaymentConstructProps {
  config: EnvConfig;
  /** The racephotos-orders DynamoDB table (RS-010, ADR-0010). */
  ordersTable: dynamodb.Table;
  /** The racephotos-purchases DynamoDB table. */
  purchasesTable: dynamodb.Table;
  /** The racephotos-photos DynamoDB table. */
  photosTable: dynamodb.Table;
  /** The racephotos-events DynamoDB table. */
  eventsTable: dynamodb.Table;
  /** The racephotos-photographers DynamoDB table. */
  photographersTable: dynamodb.Table;
  /** SES construct — grants ses:SendEmail and ses:SendTemplatedEmail. */
  ses: SesConstruct;
  /**
   * The HTTP API Gateway ID (from SSM valueForStringParameter).
   * Passed as a plain string to avoid cross-stack cyclic dependencies.
   */
  httpApiId: string;
  /**
   * The Cognito JWT authorizer ID (from SSM valueForStringParameter).
   * Used for photographer-facing routes (RS-011).
   */
  httpAuthorizerId: string;
  /**
   * SES sender address (from SSM valueForStringParameter).
   * Injected as RACEPHOTOS_SES_FROM_ADDRESS.
   */
  sesFromAddress: string;
  /**
   * Base URL for the photographer approvals dashboard.
   * Injected as RACEPHOTOS_APPROVALS_URL into the create-order Lambda so
   * the photographer is notified of incoming purchase claims.
   */
  approvalsUrl: string;
  /**
   * Base URL for the runner-facing app (no trailing slash).
   * Injected as RACEPHOTOS_APP_BASE_URL into the approve-purchase Lambda
   * to build runner download links: {appBaseUrl}/download/{token}.
   * Separate from approvalsUrl — the photographer dashboard and runner-facing
   * app may be served from different domains in multi-domain deployments.
   */
  appBaseUrl: string;
  /**
   * CloudFront CDN domain for watermarked photos (no trailing slash, no scheme).
   * Injected as RACEPHOTOS_CDN_BASE_URL for list-purchases-for-approval.
   */
  cdnBaseUrl: string;
}

/**
 * PaymentConstruct — RS-010, RS-011
 *
 * Creates:
 *   - create-order Lambda              POST /orders                       (no auth — runner-facing)
 *   - list-purchases-for-approval Lambda GET /photographer/me/purchases   (JWT auth — RS-011)
 *   - approve-purchase Lambda          PUT  /purchases/{id}/approve       (JWT auth — RS-011)
 *   - reject-purchase Lambda           PUT  /purchases/{id}/reject        (JWT auth — RS-011)
 *
 * IAM grants:
 *   create-order:
 *     - dynamodb:PutItem, GetItem on ordersTable
 *     - dynamodb:PutItem, GetItem on purchasesTable
 *     - dynamodb:Query on purchasesTable/index/photoId-runnerEmail-index
 *     - dynamodb:GetItem on photosTable, eventsTable, photographersTable
 *     - ses:SendEmail, ses:SendTemplatedEmail (via SesConstruct.grantSendEmail)
 *   list-purchases-for-approval:
 *     - dynamodb:Query on ordersTable/index/photographerId-claimedAt-index
 *     - dynamodb:Query on purchasesTable/index/orderId-index
 *     - dynamodb:BatchGetItem on photosTable
 *   approve-purchase:
 *     - dynamodb:GetItem, UpdateItem on purchasesTable
 *     - dynamodb:Query on purchasesTable/index/orderId-index
 *     - dynamodb:GetItem, UpdateItem on ordersTable
 *     - ses:SendEmail, ses:SendTemplatedEmail (via SesConstruct.grantSendEmail)
 *   reject-purchase:
 *     - dynamodb:GetItem, UpdateItem on purchasesTable
 *     - dynamodb:Query on purchasesTable/index/orderId-index
 *     - dynamodb:GetItem, UpdateItem on ordersTable
 *
 * Authorization:
 *   POST /orders is public — no Cognito JWT authorizer is attached.
 *   All photographer routes (RS-011) require the Cognito JWT authorizer.
 *
 * AC: RS-010 AC1–AC9, RS-011 AC1–AC13
 */
export class PaymentConstruct extends Construct {
  readonly createOrderFn: lambda.Function;
  readonly listPurchasesForApprovalFn: lambda.Function;
  readonly approvePurchaseFn: lambda.Function;
  readonly rejectPurchaseFn: lambda.Function;

  constructor(scope: Construct, id: string, props: PaymentConstructProps) {
    super(scope, id);

    const {
      config,
      ordersTable,
      purchasesTable,
      photosTable,
      eventsTable,
      photographersTable,
      ses,
      httpApiId,
      httpAuthorizerId,
      sesFromAddress,
      approvalsUrl,
      appBaseUrl,
      cdnBaseUrl,
    } = props;

    const httpApi = apigatewayv2.HttpApi.fromHttpApiAttributes(this, 'HttpApi', { httpApiId });

    // Build an IHttpRouteAuthorizer from the stored authorizer ID — same pattern
    // as PhotographerConstruct. Required for all RS-011 photographer routes.
    const jwtAuthorizer: apigatewayv2.IHttpRouteAuthorizer = {
      bind: () => ({
        authorizerId: httpAuthorizerId,
        authorizationType: apigatewayv2.HttpAuthorizerType.JWT,
      }),
    };

    // ── create-order Lambda ───────────────────────────────────────────────────
    this.createOrderFn = new lambda.Function(this, 'CreateOrderFn', {
      functionName: `racephotos-create-order-${config.envName}`,
      runtime: lambda.Runtime.PROVIDED_AL2023,
      architecture: lambda.Architecture.ARM_64,
      handler: 'bootstrap',
      memorySize: 256,
      timeout: cdk.Duration.seconds(15),
      code: lambda.Code.fromAsset(path.join(__dirname, '../../../lambdas/create-order')),
      environment: {
        RACEPHOTOS_ENV: config.envName,
        RACEPHOTOS_ORDERS_TABLE: ordersTable.tableName,
        RACEPHOTOS_PURCHASES_TABLE: purchasesTable.tableName,
        RACEPHOTOS_PHOTOS_TABLE: photosTable.tableName,
        RACEPHOTOS_EVENTS_TABLE: eventsTable.tableName,
        RACEPHOTOS_PHOTOGRAPHERS_TABLE: photographersTable.tableName,
        RACEPHOTOS_SES_FROM_ADDRESS: sesFromAddress,
        RACEPHOTOS_APPROVALS_URL: approvalsUrl,
      },
    });

    // DynamoDB grants — principle of least privilege per table and operation.
    ordersTable.grant(this.createOrderFn, 'dynamodb:PutItem', 'dynamodb:GetItem');
    // PutItem and GetItem on the purchases base table.
    purchasesTable.grant(this.createOrderFn, 'dynamodb:PutItem', 'dynamodb:GetItem');
    // Query on the photoId-runnerEmail-index GSI requires an explicit grant on the
    // index ARN. table.grant() only covers the base table ARN — CDK does not
    // automatically include index/* for manual grant() calls.
    this.createOrderFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['dynamodb:Query'],
        resources: [`${purchasesTable.tableArn}/index/photoId-runnerEmail-index`],
      }),
    );
    photosTable.grant(this.createOrderFn, 'dynamodb:GetItem');
    eventsTable.grant(this.createOrderFn, 'dynamodb:GetItem');
    photographersTable.grant(this.createOrderFn, 'dynamodb:GetItem');

    // SES grant — SendEmail + SendTemplatedEmail on the verified identity ARN.
    ses.grantSendEmail(this.createOrderFn);

    new ObservabilityConstruct(this, 'CreateOrderObs', {
      lambda: this.createOrderFn,
      logRetentionDays: config.photoRetentionDays,
      // No DLQ — API Gateway-triggered Lambda, not SQS
    });

    // POST /orders — public route, no authorizer.
    new apigatewayv2.HttpRoute(this, 'CreateOrderRoute', {
      httpApi,
      routeKey: apigatewayv2.HttpRouteKey.with('/orders', apigatewayv2.HttpMethod.POST),
      integration: new integrations.HttpLambdaIntegration(
        'CreateOrderIntegration',
        this.createOrderFn,
      ),
    });

    // ── list-purchases-for-approval Lambda ────────────────────────────────────
    // GET /photographer/me/purchases?status=pending — JWT auth (RS-011 AC1, AC12, AC13).
    this.listPurchasesForApprovalFn = new lambda.Function(this, 'ListPurchasesForApprovalFn', {
      functionName: `racephotos-list-purchases-for-approval-${config.envName}`,
      runtime: lambda.Runtime.PROVIDED_AL2023,
      architecture: lambda.Architecture.ARM_64,
      handler: 'bootstrap',
      memorySize: 256,
      timeout: cdk.Duration.seconds(15),
      code: lambda.Code.fromAsset(
        path.join(__dirname, '../../../lambdas/list-purchases-for-approval'),
      ),
      environment: {
        RACEPHOTOS_ENV: config.envName,
        RACEPHOTOS_ORDERS_TABLE: ordersTable.tableName,
        RACEPHOTOS_PURCHASES_TABLE: purchasesTable.tableName,
        RACEPHOTOS_PHOTOS_TABLE: photosTable.tableName,
        RACEPHOTOS_CDN_BASE_URL: `https://${cdnBaseUrl}`,
      },
    });

    // Query on photographerId-claimedAt-index GSI (orders table).
    this.listPurchasesForApprovalFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['dynamodb:Query'],
        resources: [
          `${ordersTable.tableArn}/index/photographerId-claimedAt-index`,
        ],
      }),
    );
    // Query on orderId-index GSI (purchases table).
    this.listPurchasesForApprovalFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['dynamodb:Query'],
        resources: [
          `${purchasesTable.tableArn}/index/orderId-index`,
        ],
      }),
    );
    // BatchGetItem on the photos base table.
    photosTable.grant(this.listPurchasesForApprovalFn, 'dynamodb:BatchGetItem');

    new ObservabilityConstruct(this, 'ListPurchasesForApprovalObs', {
      lambda: this.listPurchasesForApprovalFn,
      logRetentionDays: config.photoRetentionDays,
    });

    new apigatewayv2.HttpRoute(this, 'ListPurchasesForApprovalRoute', {
      httpApi,
      routeKey: apigatewayv2.HttpRouteKey.with(
        '/photographer/me/purchases',
        apigatewayv2.HttpMethod.GET,
      ),
      integration: new integrations.HttpLambdaIntegration(
        'ListPurchasesForApprovalIntegration',
        this.listPurchasesForApprovalFn,
      ),
      authorizer: jwtAuthorizer,
    });

    // ── approve-purchase Lambda ───────────────────────────────────────────────
    // PUT /purchases/{id}/approve — JWT auth (RS-011 AC2, AC3, AC6, AC7, AC8).
    this.approvePurchaseFn = new lambda.Function(this, 'ApprovePurchaseFn', {
      functionName: `racephotos-approve-purchase-${config.envName}`,
      runtime: lambda.Runtime.PROVIDED_AL2023,
      architecture: lambda.Architecture.ARM_64,
      handler: 'bootstrap',
      memorySize: 256,
      timeout: cdk.Duration.seconds(15),
      code: lambda.Code.fromAsset(
        path.join(__dirname, '../../../lambdas/approve-purchase'),
      ),
      environment: {
        RACEPHOTOS_ENV: config.envName,
        RACEPHOTOS_PURCHASES_TABLE: purchasesTable.tableName,
        RACEPHOTOS_ORDERS_TABLE: ordersTable.tableName,
        RACEPHOTOS_SES_FROM_ADDRESS: sesFromAddress,
        RACEPHOTOS_APP_BASE_URL: appBaseUrl,
      },
    });

    // GetItem + UpdateItem on the purchases base table.
    purchasesTable.grant(this.approvePurchaseFn, 'dynamodb:GetItem', 'dynamodb:UpdateItem');
    // Query on orderId-index GSI (purchases table).
    this.approvePurchaseFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['dynamodb:Query'],
        resources: [`${purchasesTable.tableArn}/index/orderId-index`],
      }),
    );
    // GetItem + UpdateItem on the orders base table.
    ordersTable.grant(this.approvePurchaseFn, 'dynamodb:GetItem', 'dynamodb:UpdateItem');

    // SES grant — send runner approval email.
    ses.grantSendEmail(this.approvePurchaseFn);

    new ObservabilityConstruct(this, 'ApprovePurchaseObs', {
      lambda: this.approvePurchaseFn,
      logRetentionDays: config.photoRetentionDays,
    });

    new apigatewayv2.HttpRoute(this, 'ApprovePurchaseRoute', {
      httpApi,
      routeKey: apigatewayv2.HttpRouteKey.with(
        '/purchases/{id}/approve',
        apigatewayv2.HttpMethod.PUT,
      ),
      integration: new integrations.HttpLambdaIntegration(
        'ApprovePurchaseIntegration',
        this.approvePurchaseFn,
      ),
      authorizer: jwtAuthorizer,
    });

    // ── reject-purchase Lambda ────────────────────────────────────────────────
    // PUT /purchases/{id}/reject — JWT auth (RS-011 AC4, AC5, AC6, AC7, AC8).
    this.rejectPurchaseFn = new lambda.Function(this, 'RejectPurchaseFn', {
      functionName: `racephotos-reject-purchase-${config.envName}`,
      runtime: lambda.Runtime.PROVIDED_AL2023,
      architecture: lambda.Architecture.ARM_64,
      handler: 'bootstrap',
      memorySize: 256,
      timeout: cdk.Duration.seconds(15),
      code: lambda.Code.fromAsset(
        path.join(__dirname, '../../../lambdas/reject-purchase'),
      ),
      environment: {
        RACEPHOTOS_ENV: config.envName,
        RACEPHOTOS_PURCHASES_TABLE: purchasesTable.tableName,
        RACEPHOTOS_ORDERS_TABLE: ordersTable.tableName,
        RACEPHOTOS_FROM_EMAIL: sesFromAddress,
      },
    });

    // GetItem + UpdateItem on the purchases base table.
    purchasesTable.grant(this.rejectPurchaseFn, 'dynamodb:GetItem', 'dynamodb:UpdateItem');
    // Query on orderId-index GSI (purchases table).
    this.rejectPurchaseFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['dynamodb:Query'],
        resources: [`${purchasesTable.tableArn}/index/orderId-index`],
      }),
    );
    // GetItem + UpdateItem on the orders base table.
    ordersTable.grant(this.rejectPurchaseFn, 'dynamodb:GetItem', 'dynamodb:UpdateItem');

    // SES grant — SendTemplatedEmail for runner rejection notification (RS-021).
    ses.grantSendEmail(this.rejectPurchaseFn);

    new ObservabilityConstruct(this, 'RejectPurchaseObs', {
      lambda: this.rejectPurchaseFn,
      logRetentionDays: config.photoRetentionDays,
    });

    new apigatewayv2.HttpRoute(this, 'RejectPurchaseRoute', {
      httpApi,
      routeKey: apigatewayv2.HttpRouteKey.with(
        '/purchases/{id}/reject',
        apigatewayv2.HttpMethod.PUT,
      ),
      integration: new integrations.HttpLambdaIntegration(
        'RejectPurchaseIntegration',
        this.rejectPurchaseFn,
      ),
      authorizer: jwtAuthorizer,
    });
  }
}
