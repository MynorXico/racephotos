import * as cdk from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import { Construct } from 'constructs';
import { CodePipeline, CodePipelineSource, ShellStep } from 'aws-cdk-lib/pipelines';
import { PipelineConfig } from '../config/types';
import { RacePhotosStage } from '../stages/racephotos-stage';

/**
 * PipelineStack — lives in the TOOLS account.
 *
 * All /racephotos/* SSM parameters must exist in the TOOLS account before
 * running cdk synth. Run scripts/seed-ssm.sh to create them.
 *
 * The Synth ShellStep builds the Angular app before running cdk synth so that
 * the dist/ directory is available as a CDK asset for BucketDeployment.
 */
export class PipelineStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: cdk.StackProps) {
    super(scope, id, props);

    const config = this.loadConfig();

    const pipeline = new CodePipeline(this, 'Pipeline', {
      pipelineName: 'racephotos-pipeline',
      crossAccountKeys: true,
      selfMutation: true,

      // Grant the synth CodeBuild project permission to read all SSM
      // parameters. GetParameter covers individual valueFromLookup calls;
      // GetParametersByPath is used by generate-cdk-context.sh to fetch
      // all /racephotos/* params in one call to build cdk.context.json.
      synthCodeBuildDefaults: {
        rolePolicy: [
          new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            actions: ['ssm:GetParameter', 'ssm:GetParametersByPath'],
            resources: [
              `arn:aws:ssm:${this.region}:${this.account}:parameter/racephotos`,
              `arn:aws:ssm:${this.region}:${this.account}:parameter/racephotos/*`,
            ],
          }),
        ],
      },

      synth: new ShellStep('Synth', {
        input: CodePipelineSource.connection(
          `${config.githubOwner}/${config.githubRepo}`,
          config.githubBranch,
          {
            connectionArn: config.codestarConnectionArn,
            triggerOnPush: true,
          },
        ),
        commands: [
          // Ensure Node 20 is active. CodeBuild standard images ship
          // with nvm pre-installed; nvm install is a no-op if already present.
          'source /root/.nvm/nvm.sh',
          'nvm install 20',
          'nvm use 20',
          // Build Angular first — FrontendConstruct references dist/browser/
          // as a CDK asset so it must exist before cdk synth runs.
          'cd frontend/angular && npm ci && npx ng build --configuration=production && cd ../..',
          // Verify Angular build produced the expected output directory.
          // Fails fast with a clear message rather than a cryptic CDK asset error.
          'test -d frontend/angular/dist/racephotos/browser || { echo "ERROR: Angular build did not produce frontend/angular/dist/racephotos/browser"; exit 1; }',
          // Populate cdk.context.json from SSM so valueFromLookup gets real
          // values on every synth run — no dummy-value failures, no account
          // IDs committed to git.
          'chmod +x scripts/generate-cdk-context.sh && ./scripts/generate-cdk-context.sh',
          // CDK synth
          'cd infra/cdk && npm ci && npm run build && npx cdk synth',
        ],
        primaryOutputDirectory: 'infra/cdk/cdk.out',
      }),
    });

    // ── Application stages — uncomment as environments are ready ──────────

    const devEnv = config.environments.dev;
    if (devEnv) {
      pipeline.addStage(
        new RacePhotosStage(this, 'Dev', {
          env: { account: devEnv.account, region: devEnv.region },
          config: devEnv,
        }),
      );
    }

    // const qaEnv = config.environments.qa;
    // if (qaEnv) {
    //   pipeline.addStage(
    //     new RacePhotosStage(this, "QA", {
    //       env: { account: qaEnv.account, region: qaEnv.region },
    //       config: qaEnv,
    //     })
    //   );
    // }

    // const stagingEnv = config.environments.staging;
    // if (stagingEnv) {
    //   pipeline.addStage(
    //     new RacePhotosStage(this, "Staging", {
    //       env: { account: stagingEnv.account, region: stagingEnv.region },
    //       config: stagingEnv,
    //     }),
    //     { pre: [new ManualApprovalStep("PromoteToStaging")] }
    //   );
    // }
  }

  /**
   * Loads all pipeline and per-environment configuration from SSM.
   * All /racephotos/* parameters live in the TOOLS account.
   * Scoped to `this` (the stack) — required by valueFromLookup.
   */
  private loadConfig(): PipelineConfig {
    const param = (name: string) => ssm.StringParameter.valueFromLookup(this, name);

    return {
      toolsAccount: this.account,
      toolsRegion: this.region,
      githubOwner: param('/racephotos/github/owner'),
      githubRepo: param('/racephotos/github/repo'),
      githubBranch: param('/racephotos/github/branch'),
      codestarConnectionArn: param('/racephotos/github/codestar-connection-arn'),
      environments: {
        dev: {
          envName: 'dev',
          account: param('/racephotos/env/dev/account-id'),
          region: param('/racephotos/env/dev/region'),
          rekognitionConfidenceThreshold: 0.7,
          watermarkStyle: 'text_overlay',
          photoRetentionDays: 90,
          enableDeletionProtection: false,
          domainName: param('/racephotos/env/dev/domain-name'),
          certificateArn: param('/racephotos/env/dev/certificate-arn'),
        },
        qa: {
          envName: 'qa',
          account: param('/racephotos/env/qa/account-id'),
          region: param('/racephotos/env/qa/region'),
          rekognitionConfidenceThreshold: 0.8,
          watermarkStyle: 'text_overlay',
          photoRetentionDays: 90,
          enableDeletionProtection: false,
          domainName: param('/racephotos/env/qa/domain-name'),
          certificateArn: param('/racephotos/env/qa/certificate-arn'),
        },
        // staging: {
        //     envName: "staging",
        //     account: param("/racephotos/env/staging/account-id"),
        //     region: param("/racephotos/env/staging/region"),
        //     rekognitionConfidenceThreshold: 0.85,
        //     watermarkStyle: "text_overlay",
        //     photoRetentionDays: 180,
        //     enableDeletionProtection: true,
        //     domainName: param("/racephotos/env/staging/domain-name"),
        //     certificateArn: param("/racephotos/env/staging/certificate-arn"),
        // },
        prod: {
          envName: 'prod',
          account: param('/racephotos/env/prod/account-id'),
          region: param('/racephotos/env/prod/region'),
          rekognitionConfidenceThreshold: 0.9,
          watermarkStyle: 'text_overlay',
          photoRetentionDays: 365,
          enableDeletionProtection: true,
          domainName: param('/racephotos/env/prod/domain-name'),
          certificateArn: param('/racephotos/env/prod/certificate-arn'),
        },
      },
    };
  }
}
