import * as cdk from "aws-cdk-lib";
import * as iam from "aws-cdk-lib/aws-iam";
import * as ssm from "aws-cdk-lib/aws-ssm";
import { Construct } from "constructs";
import {
    CodePipeline,
    CodePipelineSource,
    ShellStep,
} from "aws-cdk-lib/pipelines";
import { PipelineConfig } from "../config/types";

/**
 * PipelineStack — lives in the TOOLS account.
 *
 * SSM lookups are scoped to `this` (the stack) which is the correct scope
 * for valueFromLookup. All /racephotos/* parameters must exist in the TOOLS
 * account before running cdk synth. Run scripts/seed-ssm.sh to create them.
 *
 * To add a new environment stage:
 *   1. Import RacePhotosStage
 *   2. Uncomment the relevant block in the addStage section below
 */
export class PipelineStack extends cdk.Stack {
    constructor(scope: Construct, id: string, props: cdk.StackProps) {
        super(scope, id, props);

        // SSM lookups are scoped to `this` — the stack construct.
        // On first synth CDK returns dummy placeholder values and caches the real
        // ones in cdk.context.json. Run cdk synth twice if values look wrong.
        const config = this.loadConfig();

        const pipeline = new CodePipeline(this, "Pipeline", {
            pipelineName: "racephotos-pipeline",
            crossAccountKeys: true,
            selfMutation: true,

            // Grant the synth CodeBuild project permission to read SSM parameters
            // used by valueFromLookup during cdk synth.
            synthCodeBuildDefaults: {
                rolePolicy: [
                    new iam.PolicyStatement({
                        effect: iam.Effect.ALLOW,
                        actions: ["ssm:GetParameter"],
                        resources: [
                            `arn:aws:ssm:${this.region}:${this.account}:parameter/racephotos/*`,
                        ],
                    }),
                ],
            },

            synth: new ShellStep("Synth", {
                input: CodePipelineSource.connection(
                    `${config.githubOwner}/${config.githubRepo}`,
                    config.githubBranch,
                    {
                        connectionArn: config.codestarConnectionArn,
                        triggerOnPush: true,
                    }
                ),
                commands: [
                    "cd infra/cdk",
                    "npm ci",
                    "npm run build",
                    "npx cdk synth",
                ],
                primaryOutputDirectory: "infra/cdk/cdk.out",
            }),
        });

        // -------------------------------------------------------------------------
        // Application stages — uncomment as environments are ready.

        const devEnv = config.environments.dev;
        if (devEnv) {
          pipeline.addStage(
            new RacePhotosStage(this, "Dev", {
              env: { account: devEnv.account, region: devEnv.region },
              config: devEnv,
            })
          );
        }
        //
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
        // -------------------------------------------------------------------------
    }

    /**
     * Reads all pipeline configuration from SSM Parameter Store.
     * Scoped to `this` (the stack) — required by valueFromLookup.
     */
    private loadConfig(): PipelineConfig {
        const param = (name: string) =>
            ssm.StringParameter.valueFromLookup(this, name);

        return {
            toolsAccount: this.account,
            toolsRegion: this.region,
            githubOwner: param("/racephotos/github/owner"),
            githubRepo: param("/racephotos/github/repo"),
            githubBranch: param("/racephotos/github/branch"),
            codestarConnectionArn: param("/racephotos/github/codestar-connection-arn"),
            environments: {
                dev: {
                    envName: "dev",
                    account: param("/racephotos/env/dev/account-id"),
                    region: param("/racephotos/env/dev/region"),
                    rekognitionConfidenceThreshold: 0.7,
                    watermarkStyle: "text_overlay",
                    photoRetentionDays: 90,
                    enableDeletionProtection: false,
                },
                qa: {
                    envName: "qa",
                    account: param("/racephotos/env/qa/account-id"),
                    region: param("/racephotos/env/qa/region"),
                    rekognitionConfidenceThreshold: 0.8,
                    watermarkStyle: "text_overlay",
                    photoRetentionDays: 90,
                    enableDeletionProtection: false,
                },
                // staging: {
                //     envName: "staging",
                //     account: param("/racephotos/env/staging/account-id"),
                //     region: param("/racephotos/env/staging/region"),
                //     rekognitionConfidenceThreshold: 0.85,
                //     watermarkStyle: "text_overlay",
                //     photoRetentionDays: 180,
                //     enableDeletionProtection: true,
                // },
                prod: {
                    envName: "prod",
                    account: param("/racephotos/env/prod/account-id"),
                    region: param("/racephotos/env/prod/region"),
                    rekognitionConfidenceThreshold: 0.9,
                    watermarkStyle: "text_overlay",
                    photoRetentionDays: 365,
                    enableDeletionProtection: true,
                },
            },
        };
    }
}
