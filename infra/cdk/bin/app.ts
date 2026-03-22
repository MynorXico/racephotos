#!/usr/bin/env node
import "source-map-support/register";
import * as cdk from "aws-cdk-lib";
import { PipelineStack } from "../stacks/pipeline-stack";

/**
 * CDK app entry point.
 *
 * All environment-specific values are stored in SSM Parameter Store in the
 * TOOLS account and resolved at synth time inside the stack.
 *
 * Prerequisites:
 *   - Run scripts/seed-ssm.sh once in the TOOLS account
 *   - Export CDK_DEFAULT_ACCOUNT and CDK_DEFAULT_REGION before running cdk synth
 *
 *   export CDK_DEFAULT_ACCOUNT=$(aws sts get-caller-identity --query Account --output text)
 *   export CDK_DEFAULT_REGION=us-east-1
 *   AWS_PROFILE=tools npx cdk synth
 */

const app = new cdk.App();

const toolsAccount = process.env.CDK_DEFAULT_ACCOUNT;
const toolsRegion = process.env.CDK_DEFAULT_REGION;

if (!toolsAccount || !toolsRegion) {
    throw new Error(
        "CDK_DEFAULT_ACCOUNT and CDK_DEFAULT_REGION must be set.\n" +
        "Run:\n" +
        "  export CDK_DEFAULT_ACCOUNT=$(AWS_PROFILE=tools aws sts get-caller-identity --query Account --output text)\n" +
        "  export CDK_DEFAULT_REGION=us-east-1"
    );
}

// SSM lookups happen inside PipelineStack, scoped to the stack construct.
// valueFromLookup requires a Stack as its scope — passing the App directly
// causes "no Stack found" errors.
new PipelineStack(app, "RacePhotosPipeline", {
    env: {
        account: toolsAccount,
        region: toolsRegion,
    },
    description: "RaceShots — CI/CD pipeline (TOOLS account)",
});

app.synth();

