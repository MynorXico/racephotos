import * as cdk from 'aws-cdk-lib';
import * as apigatewayv2 from 'aws-cdk-lib/aws-apigatewayv2';
import * as authorizers from 'aws-cdk-lib/aws-apigatewayv2-authorizers';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import { Construct } from 'constructs';
import { EnvConfig } from '../config/types';
import { CognitoConstruct } from './cognito-construct';

interface ApiConstructProps {
  config: EnvConfig;
  cognitoConstruct: CognitoConstruct;
}

/**
 * ApiConstruct
 *
 * Creates:
 *   - HTTP API `racephotos-api` with Cognito JWT default authorizer
 *   - SSM parameter `/racephotos/env/{envName}/api-url` — consumed by
 *     FrontendConstruct to inject apiBaseUrl into config.json
 *
 * CORS origins:
 *   - Custom domain set (config.domainName !== "none"): locked to that origin.
 *   - No custom domain (dev/local):                    wildcard "*".
 *
 * Routes are added per Lambda story (photo-upload, search, payment, …).
 * The default authorizer is applied automatically to every route added later.
 */
export class ApiConstruct extends Construct {
  readonly httpApi: apigatewayv2.HttpApi;
  /** Full HTTPS URL of the API Gateway stage endpoint. */
  readonly apiUrl: string;

  constructor(scope: Construct, id: string, props: ApiConstructProps) {
    super(scope, id);

    const { config, cognitoConstruct } = props;

    const corsAllowOrigins =
      config.domainName !== 'none' ? [`https://${config.domainName}`] : ['*'];

    const jwtIssuer = `https://cognito-idp.${cdk.Stack.of(this).region}.amazonaws.com/${cognitoConstruct.userPoolId}`;

    this.httpApi = new apigatewayv2.HttpApi(this, 'HttpApi', {
      apiName: 'racephotos-api',
      corsPreflight: {
        allowOrigins: corsAllowOrigins,
        allowMethods: [apigatewayv2.CorsHttpMethod.ANY],
        allowHeaders: ['Content-Type', 'Authorization'],
      },
      defaultAuthorizer: new authorizers.HttpJwtAuthorizer('CognitoAuthorizer', jwtIssuer, {
        jwtAudience: [cognitoConstruct.clientId],
      }),
    });

    this.apiUrl = this.httpApi.apiEndpoint;

    // Store API URL in SSM so the pipeline can inject it into config.json
    // without creating a circular dependency between AuthStack and FrontendStack.
    new ssm.StringParameter(this, 'ApiUrlParameter', {
      parameterName: `/racephotos/env/${config.envName}/api-url`,
      stringValue: this.apiUrl,
      description: `RaceShots API Gateway base URL — ${config.envName}`,
    });
  }
}
