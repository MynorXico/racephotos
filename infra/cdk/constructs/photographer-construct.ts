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
  /** The HTTP API to which routes are added. */
  httpApi: apigatewayv2.HttpApi;
}

/**
 * PhotographerConstruct
 *
 * Creates:
 *   - get-photographer Lambda  → GET  /photographer/me (Cognito JWT required)
 *   - update-photographer Lambda → PUT  /photographer/me (Cognito JWT required)
 *
 * IAM:
 *   - get-photographer    : dynamodb:GetItem on photographersTable
 *   - update-photographer : dynamodb:PutItem  on photographersTable
 *                         + dynamodb:GetItem  (needed to preserve CreatedAt)
 *
 * Both Lambdas inherit the HTTP API's default JWT authorizer automatically —
 * no explicit authorizer override is needed.
 *
 * AC: RS-004
 */
export class PhotographerConstruct extends Construct {
  readonly getPhotographerFn: lambda.Function;
  readonly updatePhotographerFn: lambda.Function;

  constructor(scope: Construct, id: string, props: PhotographerConstructProps) {
    super(scope, id);

    const { config, photographersTable, httpApi } = props;

    // ── get-photographer Lambda ───────────────────────────────────────────────
    this.getPhotographerFn = new lambda.Function(this, 'GetPhotographerFn', {
      functionName: `racephotos-get-photographer-${config.envName}`,
      runtime: lambda.Runtime.PROVIDED_AL2023,
      architecture: lambda.Architecture.X86_64,
      handler: 'bootstrap',
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

    httpApi.addRoutes({
      path: '/photographer/me',
      methods: [apigatewayv2.HttpMethod.GET],
      integration: new integrations.HttpLambdaIntegration(
        'GetPhotographerIntegration',
        this.getPhotographerFn,
      ),
    });

    // ── update-photographer Lambda ────────────────────────────────────────────
    this.updatePhotographerFn = new lambda.Function(this, 'UpdatePhotographerFn', {
      functionName: `racephotos-update-photographer-${config.envName}`,
      runtime: lambda.Runtime.PROVIDED_AL2023,
      architecture: lambda.Architecture.X86_64,
      handler: 'bootstrap',
      code: lambda.Code.fromAsset(path.join(__dirname, '../../../lambdas/update-photographer')),
      environment: {
        RACEPHOTOS_ENV: config.envName,
        RACEPHOTOS_PHOTOGRAPHERS_TABLE: photographersTable.tableName,
      },
    });

    // update-photographer needs GetItem (to preserve CreatedAt) + PutItem
    photographersTable.grant(this.updatePhotographerFn, 'dynamodb:GetItem', 'dynamodb:PutItem');

    new ObservabilityConstruct(this, 'UpdatePhotographerObs', {
      lambda: this.updatePhotographerFn,
      logRetentionDays: config.photoRetentionDays,
    });

    httpApi.addRoutes({
      path: '/photographer/me',
      methods: [apigatewayv2.HttpMethod.PUT],
      integration: new integrations.HttpLambdaIntegration(
        'UpdatePhotographerIntegration',
        this.updatePhotographerFn,
      ),
    });
  }
}
