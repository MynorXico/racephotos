import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import { EnvConfig } from "../config/environments";

interface RacePhotosStageProps extends cdk.StageProps {
    config: EnvConfig;
}

/**
 * RacePhotosStage — instantiated once per environment.
 *
 * This Stage is the unit of deployment. The pipeline deploys the same Stage
 * class to Dev, QA, Staging, and Prod — parameterised by EnvConfig.
 *
 * Application stacks are added here as features are built. Currently a
 * skeleton — no stacks yet.
 *
 * To add a new stack:
 *   1. Create it in infra/cdk/stacks/
 *   2. Instantiate it here, passing config
 */
export class RacePhotosStage extends cdk.Stage {
    constructor(scope: Construct, id: string, props: RacePhotosStageProps) {
        super(scope, id, props);

        const { config } = props;

        // Stacks are added here incrementally.
        //
        // Example:
        // new PhotoStorageStack(this, "PhotoStorage", { config });
        // new ProcessingStack(this, "Processing", { config });
        //
        // For now this stage is intentionally empty — the pipeline will still
        // deploy and self-mutate successfully with no stacks inside it.

        // Suppress unused variable warning during skeleton phase
        void config;
    }
}
