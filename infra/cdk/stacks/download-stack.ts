import * as cdk from 'aws-cdk-lib';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import { Construct } from 'constructs';
import { EnvConfig } from '../config/types';
import { DatabaseConstruct } from '../constructs/database-construct';
import { DownloadConstruct } from '../constructs/download-construct';
import { PhotoStorageConstruct } from '../constructs/photo-storage-construct';
import { SesConstruct } from '../constructs/ses-construct';

interface DownloadStackProps extends cdk.StackProps {
  config: EnvConfig;
  /** DatabaseConstruct from StorageStack — provides purchases, photos, rate-limits tables. */
  db: DatabaseConstruct;
  /** PhotoStorageConstruct from StorageStack — provides the private raw S3 bucket. */
  photoStorage: PhotoStorageConstruct;
  /** SesConstruct from SesStack — grants SendTemplatedEmail on the verified identity. */
  ses: SesConstruct;
}

/**
 * DownloadStack — RS-012
 *
 * Creates:
 *   GET  /download/{token}            — get-download Lambda (no auth)
 *   POST /purchases/redownload-resend — redownload-resend Lambda (no auth)
 *
 * Dependencies (must be deployed first):
 *   StorageStack — racephotos-purchases, racephotos-photos, racephotos-rate-limits,
 *                  raw S3 bucket
 *   AuthStack    — HTTP API (api-id SSM param)
 *   SesStack     — verified SES identity + email templates
 *   FrontendStack — writes /racephotos/env/{env}/app-base-url SSM param
 *
 * sesFromAddress and appBaseUrl are resolved from SSM at deploy time using
 * valueForStringParameter (resolved by CloudFormation — not by CDK at synth time).
 */
export class DownloadStack extends cdk.Stack {
  readonly download: DownloadConstruct;

  constructor(scope: Construct, id: string, props: DownloadStackProps) {
    super(scope, id, props);

    const { config, db, photoStorage, ses } = props;

    const httpApiId = ssm.StringParameter.valueForStringParameter(
      this,
      `/racephotos/env/${config.envName}/api-id`,
    );

    const sesFromAddress = ssm.StringParameter.valueForStringParameter(
      this,
      `/racephotos/env/${config.envName}/ses-from-address`,
    );

    const appBaseUrl = ssm.StringParameter.valueForStringParameter(
      this,
      `/racephotos/env/${config.envName}/app-base-url`,
    );

    this.download = new DownloadConstruct(this, 'Download', {
      config,
      purchasesTable: db.purchasesTable,
      photosTable: db.photosTable,
      rateLimitsTable: db.rateLimitsTable,
      rawBucket: photoStorage.rawBucket,
      ses,
      httpApiId,
      sesFromAddress,
      appBaseUrl,
    });
  }
}
