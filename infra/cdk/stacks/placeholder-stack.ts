import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import { EnvConfig } from "../config/types";

interface PlaceholderStackProps extends cdk.StackProps {
    config: EnvConfig;
}

/**
 * PlaceholderStack — temporary stack that satisfies the CDK Pipelines
 * requirement of at least one Stack per Stage.
 *
 * Replace this with real application stacks (PhotoStorageStack,
 * ProcessingStack, etc.) as features are built. Delete this file once
 * at least one real stack exists in RacePhotosStage.
 */
export class PlaceholderStack extends cdk.Stack {
    constructor(scope: Construct, id: string, props: PlaceholderStackProps) {
        super(scope, id, props);
        // Intentionally empty — exists only to satisfy CDK Pipelines.
        void props.config;
    }
}
