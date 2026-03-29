import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { EnvConfig } from '../config/types';
import { CognitoConstruct } from '../constructs/cognito-construct';
import { ApiConstruct } from '../constructs/api-construct';

interface AuthStackProps extends cdk.StackProps {
  config: EnvConfig;
}

/**
 * AuthStack — Cognito User Pool + HTTP API Gateway.
 *
 * Deployed before FrontendStack so its outputs (userPoolId, clientId, region,
 * apiUrl) can be passed into FrontendConstruct's config.json.
 *
 * FrontendStack depends on AuthStack (one-way); there is no circular dependency.
 */
export class AuthStack extends cdk.Stack {
  readonly cognito: CognitoConstruct;
  readonly api: ApiConstruct;

  constructor(scope: Construct, id: string, props: AuthStackProps) {
    super(scope, id, props);

    this.cognito = new CognitoConstruct(this, 'Cognito', { config: props.config });
    this.api = new ApiConstruct(this, 'Api', {
      config: props.config,
      cognitoConstruct: this.cognito,
    });
  }
}
