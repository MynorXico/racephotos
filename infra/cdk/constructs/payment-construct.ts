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
   * SES sender address (from SSM valueForStringParameter).
   * Injected as RACEPHOTOS_SES_FROM_ADDRESS.
   */
  sesFromAddress: string;
  /**
   * Base URL for the photographer approvals dashboard.
   * Injected as RACEPHOTOS_APPROVALS_URL.
   */
  approvalsUrl: string;
}

/**
 * PaymentConstruct — RS-010
 *
 * Creates:
 *   - create-order Lambda  POST /orders  (no auth — runner-facing)
 *
 * IAM grants:
 *   - dynamodb:PutItem on ordersTable
 *   - dynamodb:GetItem on ordersTable
 *   - dynamodb:PutItem, dynamodb:Query, dynamodb:GetItem on purchasesTable
 *   - dynamodb:GetItem on photosTable
 *   - dynamodb:GetItem on eventsTable
 *   - dynamodb:GetItem on photographersTable
 *   - ses:SendEmail, ses:SendTemplatedEmail (via SesConstruct.grantSendEmail)
 *
 * Authorization:
 *   POST /orders is public — no Cognito JWT authorizer is attached.
 *   Runners submit purchase claims without authentication (Journey 3).
 *
 * AC: RS-010 AC1–AC9
 */
export class PaymentConstruct extends Construct {
  readonly createOrderFn: lambda.Function;

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
      sesFromAddress,
      approvalsUrl,
    } = props;

    const httpApi = apigatewayv2.HttpApi.fromHttpApiAttributes(this, 'HttpApi', { httpApiId });

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
  }
}
