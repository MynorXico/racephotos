import * as cdk from 'aws-cdk-lib';
import * as apigatewayv2 from 'aws-cdk-lib/aws-apigatewayv2';
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
 *   - HTTP API `racephotos-api`
 *   - JWT authorizer backed by the Cognito User Pool
 *   - SSM parameter `/racephotos/env/{envName}/api-url`       — FrontendConstruct
 *   - SSM parameter `/racephotos/env/{envName}/api-id`        — feature stacks (PhotographerStack, …)
 *   - SSM parameter `/racephotos/env/{envName}/api-authorizer-id` — feature stacks that need auth
 *
 * CORS origins:
 *   - Custom domain set (config.domainName !== "none"): locked to that origin.
 *   - No custom domain: reads FrontendConstruct's CloudFront domain from SSM
 *     (/racephotos/env/{envName}/frontend-origin) via CDK valueFromLookup.
 *     On the first deploy the value is a dummy → falls back to "*". The
 *     pipeline self-mutates and tightens CORS to the real domain on the next
 *     synth run (generate-cdk-context.sh pre-populates the lookup cache).
 *
 * Authorization pattern for feature stacks:
 *   Feature stacks import the HTTP API by ID (via api-id SSM param) and the
 *   Cognito JWT authorizer by ID (via api-authorizer-id SSM param). Both are
 *   read with valueForStringParameter (resolved at CloudFormation deploy time,
 *   not at CDK synth time) to avoid cross-stack cyclic dependencies.
 *
 *   ⚠️  Routes that must be UNAUTHENTICATED (runner-facing) must explicitly
 *   pass `new HttpNoneAuthorizer()` as the route's authorizer:
 *     - GET  /events/{eventId}/photos?bib={bib}  (bib search — RS-006)
 *     - POST /purchases                          (purchase claim — RS-007)
 *     - GET  /purchases/{id}/download            (download link — RS-007)
 *
 *   ⚠️  Routes that must be AUTHENTICATED (photographer-facing) must pass
 *   the IHttpRouteAuthorizer built from the api-authorizer-id SSM param
 *   (see PhotographerConstruct for the pattern).
 */
export class ApiConstruct extends Construct {
  readonly httpApi: apigatewayv2.HttpApi;
  /** Full HTTPS URL of the API Gateway stage endpoint. */
  readonly apiUrl: string;
  /** Cognito JWT authorizer ID — store in SSM for feature stacks. */
  readonly authorizerId: string;

  constructor(scope: Construct, id: string, props: ApiConstructProps) {
    super(scope, id);

    const { config, cognitoConstruct } = props;

    // Mirror the FrontendConstruct guard: treat the CDK dummy-value-for-* string
    // (returned on first pipeline synth before SSM context is populated) the same
    // as "no custom domain". Only use config.domainName when both the domain name
    // looks like a real domain AND the ACM certificate ARN looks like a real ARN.
    // The domainName dummy-value guard handles the case where a contributor sets
    // a real domain in SSM but the certificate lookup hasn't been populated yet —
    // without it, CORS would silently fall back to '*' for a configured domain.
    const hasCustomDomain =
      config.domainName !== 'none' &&
      !config.domainName.startsWith('dummy-value-for-') &&
      config.certificateArn.startsWith('arn:');

    let corsAllowOrigins: string[];
    if (hasCustomDomain) {
      corsAllowOrigins = [`https://${config.domainName}`];
    } else {
      // Read FrontendConstruct's CloudFront domain from SSM context. The
      // generate-cdk-context.sh script populates this before cdk synth runs.
      // On the very first deploy the param doesn't exist yet → CDK returns a
      // dummy → fall back to '*'. The pipeline self-mutates and subsequent
      // synths will resolve to the real domain.
      const frontendDomain = ssm.StringParameter.valueFromLookup(
        this,
        `/racephotos/env/${config.envName}/frontend-origin`,
      );
      corsAllowOrigins = frontendDomain.startsWith('dummy-value-for-')
        ? ['*']
        : [`https://${frontendDomain}`];
    }

    // Create the HTTP API without a defaultAuthorizer — authorization is set
    // explicitly on every route. This keeps AuthStack independent of the route
    // stacks (PhotographerStack, etc.) and avoids cross-stack cyclic dependencies.
    this.httpApi = new apigatewayv2.HttpApi(this, 'HttpApi', {
      apiName: 'racephotos-api',
      corsPreflight: {
        allowOrigins: corsAllowOrigins,
        allowMethods: [apigatewayv2.CorsHttpMethod.ANY],
        allowHeaders: ['Content-Type', 'Authorization'],
      },
    });

    this.apiUrl = this.httpApi.apiEndpoint;

    // Create the JWT authorizer explicitly so the AWS::ApiGatewayV2::Authorizer
    // resource is always present in AuthStack — regardless of which routes exist.
    // Using HttpAuthorizer (L2) rather than HttpJwtAuthorizer (higher-level helper)
    // because HttpJwtAuthorizer binds lazily (only when addRoutes() is called) and
    // that call no longer happens in AuthStack after the cyclic-dependency refactor.
    const jwtIssuer = `https://cognito-idp.${cdk.Stack.of(this).region}.amazonaws.com/${cognitoConstruct.userPoolId}`;
    const jwtAuthorizer = new apigatewayv2.HttpAuthorizer(this, 'CognitoJwtAuthorizer', {
      httpApi: this.httpApi,
      authorizerName: 'CognitoJwtAuthorizer',
      type: apigatewayv2.HttpAuthorizerType.JWT,
      identitySource: ['$request.header.Authorization'],
      jwtAudience: [cognitoConstruct.clientId],
      jwtIssuer,
    });
    this.authorizerId = jwtAuthorizer.authorizerId;

    // All three SSM parameters are consumed by downstream stacks (FrontendStack,
    // PhotographerStack, and future feature stacks). In production environments
    // they must be retained on stack deletion to prevent breaking those stacks.
    const ssmRemovalPolicy = config.enableDeletionProtection
      ? cdk.RemovalPolicy.RETAIN
      : cdk.RemovalPolicy.DESTROY;

    // Store API URL in SSM so the pipeline can inject it into config.json
    // without creating a circular dependency between AuthStack and FrontendStack.
    const apiUrlParam = new ssm.StringParameter(this, 'ApiUrlParameter', {
      parameterName: `/racephotos/env/${config.envName}/api-url`,
      stringValue: this.apiUrl,
      description: `RaceShots API Gateway base URL — ${config.envName}`,
    });
    apiUrlParam.applyRemovalPolicy(ssmRemovalPolicy);

    // Store API ID in SSM so downstream stacks (e.g. PhotographerStack) can
    // import the HTTP API by ID via valueForStringParameter — avoiding a direct
    // CDK object reference that would create a cross-stack cyclic dependency.
    const apiIdParam = new ssm.StringParameter(this, 'ApiIdParameter', {
      parameterName: `/racephotos/env/${config.envName}/api-id`,
      stringValue: this.httpApi.apiId,
      description: `RaceShots API Gateway ID — ${config.envName}`,
    });
    apiIdParam.applyRemovalPolicy(ssmRemovalPolicy);

    // Store the JWT authorizer ID in SSM so downstream stacks can attach it to
    // routes without a CDK cross-stack token (which would recreate the cyclic dep).
    const apiAuthorizerIdParam = new ssm.StringParameter(this, 'ApiAuthorizerIdParameter', {
      parameterName: `/racephotos/env/${config.envName}/api-authorizer-id`,
      stringValue: this.authorizerId,
      description: `RaceShots API Gateway Cognito JWT authorizer ID — ${config.envName}`,
    });
    apiAuthorizerIdParam.applyRemovalPolicy(ssmRemovalPolicy);
  }
}
