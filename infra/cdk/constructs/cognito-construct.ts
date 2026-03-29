import * as cdk from 'aws-cdk-lib';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import { Construct } from 'constructs';
import { EnvConfig } from '../config/types';

interface CognitoConstructProps {
  config: EnvConfig;
}

/**
 * CognitoConstruct
 *
 * Creates:
 *   - Cognito User Pool `racephotos-photographers`
 *   - User Pool Client `racephotos-photographers-client` (no secret, SPA-safe)
 *
 * Outputs consumed by:
 *   - ApiConstruct  — JWT authorizer issuer + audience
 *   - FrontendConstruct — config.json runtime config (userPoolId, clientId, region)
 *
 * Auth flow: custom Angular login page using Amplify signIn() (USER_SRP_AUTH).
 * The Cognito hosted UI is not used.
 */
export class CognitoConstruct extends Construct {
  readonly userPool: cognito.UserPool;
  readonly userPoolClient: cognito.UserPoolClient;
  readonly userPoolId: string;
  readonly userPoolArn: string;
  readonly clientId: string;
  /** AWS region — used by Amplify to locate the User Pool. */
  readonly region: string;

  constructor(scope: Construct, id: string, props: CognitoConstructProps) {
    super(scope, id);

    const { config } = props;

    this.userPool = new cognito.UserPool(this, 'UserPool', {
      userPoolName: 'racephotos-photographers',
      // Photographers self-register — admin-only creation is disabled.
      selfSignUpEnabled: true,
      signInAliases: { email: true },
      autoVerify: { email: true },
      standardAttributes: {
        email: { required: true, mutable: true },
      },
      passwordPolicy: {
        minLength: 8,
        requireUppercase: true,
        requireLowercase: true,
        requireDigits: true,
        requireSymbols: true,
      },
    });

    // Removal policy: RETAIN in prod to prevent accidental data loss.
    this.userPool.applyRemovalPolicy(
      config.enableDeletionProtection ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY,
    );

    this.userPoolClient = new cognito.UserPoolClient(this, 'UserPoolClient', {
      userPool: this.userPool,
      userPoolClientName: 'racephotos-photographers-client',
      // No client secret — Angular SPA cannot store secrets securely.
      generateSecret: false,
      authFlows: {
        // USER_SRP_AUTH: Amplify default — secure, password never sent in plaintext.
        userSrp: true,
        // USER_PASSWORD_AUTH: needed for local dev / test automation.
        userPassword: true,
        // ALLOW_REFRESH_TOKEN_AUTH is automatically included by CDK when any
        // auth flow is enabled — no explicit field needed.
      },
    });

    this.userPoolId = this.userPool.userPoolId;
    this.userPoolArn = this.userPool.userPoolArn;
    this.clientId = this.userPoolClient.userPoolClientId;
    this.region = cdk.Stack.of(this).region;
  }
}
