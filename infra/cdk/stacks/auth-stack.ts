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

  /**
   * CloudFormation export names consumed by FrontendStack via Fn.importValue().
   *
   * These exports exist because CDK's BucketDeployment Source.jsonData substitution
   * mechanism does not trigger the normal CDK cross-stack export/import path. Without
   * explicit CfnOutput + Fn.importValue(), the synthesized FrontendStack template
   * contains raw Fn::GetAtt references to AuthStack resources, which CloudFormation
   * rejects at deploy time ("references undefined resource").
   */
  readonly apiUrlExportName: string;
  readonly userPoolIdExportName: string;
  readonly clientIdExportName: string;

  constructor(scope: Construct, id: string, props: AuthStackProps) {
    super(scope, id, props);

    const { config } = props;

    this.cognito = new CognitoConstruct(this, 'Cognito', { config });
    this.api = new ApiConstruct(this, 'Api', {
      config,
      cognitoConstruct: this.cognito,
    });

    this.apiUrlExportName = `racephotos-${config.envName}-api-url`;
    this.userPoolIdExportName = `racephotos-${config.envName}-user-pool-id`;
    this.clientIdExportName = `racephotos-${config.envName}-client-id`;

    new cdk.CfnOutput(this, 'ApiUrlExport', {
      exportName: this.apiUrlExportName,
      value: this.api.apiUrl,
      description: `RaceShots API Gateway base URL — ${config.envName}`,
    });

    new cdk.CfnOutput(this, 'UserPoolIdExport', {
      exportName: this.userPoolIdExportName,
      value: this.cognito.userPoolId,
      description: `Cognito User Pool ID — ${config.envName}`,
    });

    new cdk.CfnOutput(this, 'ClientIdExport', {
      exportName: this.clientIdExportName,
      value: this.cognito.clientId,
      description: `Cognito User Pool Client ID — ${config.envName}`,
    });
  }
}
