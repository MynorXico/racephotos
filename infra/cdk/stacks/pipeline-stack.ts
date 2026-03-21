import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import {
    CodePipeline,
    CodePipelineSource,
    ShellStep,
} from "aws-cdk-lib/pipelines";
import { PipelineConfig } from "../config/environments";

interface PipelineStackProps extends cdk.StackProps {
    config: PipelineConfig;
}

/**
 * PipelineStack — lives in the TOOLS account.
 *
 * This is the skeleton pipeline. It connects to GitHub, builds the CDK app,
 * and self-mutates when infra changes are pushed. Application stages
 * (Dev, QA, Staging, Prod) are added here incrementally as features are built.
 *
 * To add a new environment stage:
 *   1. Import RacePhotosStage
 *   2. Call pipeline.addStage(new RacePhotosStage(...)) below the comment marker
 */
export class PipelineStack extends cdk.Stack {
    constructor(scope: Construct, id: string, props: PipelineStackProps) {
        super(scope, id, props);

        const { config } = props;

        const pipeline = new CodePipeline(this, "Pipeline", {
            pipelineName: "racephotos-pipeline",
            crossAccountKeys: true, // required for cross-account deployments

            // Self-mutation: when you push changes to the pipeline stack itself,
            // CodePipeline updates its own definition automatically.
            selfMutation: true,

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
        // Application stages are added here as features are built.
        // See docs/setup/aws-bootstrap.md for how to add a new environment.
        //
        // Example (uncomment when ready to deploy to DEV):
        //
        // const devEnv = config.environments.dev;
        // if (devEnv) {
        //   pipeline.addStage(
        //     new RacePhotosStage(this, "Dev", {
        //       env: { account: devEnv.account, region: devEnv.region },
        //       config: devEnv,
        //     })
        //   );
        // }
        //
        // Example with manual approval gate (for staging/prod):
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
}
