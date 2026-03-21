/**
 * environments.example.ts
 *
 * Copy this file to environments.ts and fill in your own values.
 * environments.ts is gitignored — never commit real account IDs.
 *
 * All REPLACE_WITH_* values are required before running `cdk deploy`.
 */

export interface EnvConfig {
    envName: "dev" | "qa" | "staging" | "prod";
    account: string;
    region: string;
    rekognitionConfidenceThreshold: number;
    watermarkStyle: "text_overlay" | "diagonal_tile" | "bottom_bar";
    photoRetentionDays: number;
    enableDeletionProtection: boolean;
}

export interface PipelineConfig {
    toolsAccount: string;
    toolsRegion: string;
    githubOwner: string;
    githubRepo: string;
    githubBranch: string;
    codestarConnectionArn: string;
    environments: Partial<Record<EnvConfig["envName"], EnvConfig>>;
}

export const pipelineConfig: PipelineConfig = {
    toolsAccount: "REPLACE_WITH_TOOLS_ACCOUNT_ID",
    toolsRegion: "REPLACE_WITH_REGION", // e.g. "us-east-1"
    githubOwner: "REPLACE_WITH_GITHUB_ORG_OR_USERNAME",
    githubRepo: "racephotos",
    githubBranch: "main",
    codestarConnectionArn:
        "REPLACE_WITH_CODESTAR_CONNECTION_ARN",

    // Add or remove environments as needed.
    // A minimal self-hosted setup only needs dev and prod.
    environments: {
        dev: {
            envName: "dev",
            account: "REPLACE_WITH_DEV_ACCOUNT_ID",
            region: "REPLACE_WITH_REGION",
            rekognitionConfidenceThreshold: 0.7,
            watermarkStyle: "text_overlay",
            photoRetentionDays: 90,
            enableDeletionProtection: false,
        },
        qa: {
            envName: "qa",
            account: "REPLACE_WITH_QA_ACCOUNT_ID",
            region: "REPLACE_WITH_REGION",
            rekognitionConfidenceThreshold: 0.8,
            watermarkStyle: "text_overlay",
            photoRetentionDays: 90,
            enableDeletionProtection: false,
        },
        staging: {
            envName: "staging",
            account: "REPLACE_WITH_STAGING_ACCOUNT_ID",
            region: "REPLACE_WITH_REGION",
            rekognitionConfidenceThreshold: 0.85,
            watermarkStyle: "text_overlay",
            photoRetentionDays: 180,
            enableDeletionProtection: true,
        },
        prod: {
            envName: "prod",
            account: "REPLACE_WITH_PROD_ACCOUNT_ID",
            region: "REPLACE_WITH_REGION",
            rekognitionConfidenceThreshold: 0.9,
            watermarkStyle: "text_overlay",
            photoRetentionDays: 365,
            enableDeletionProtection: true,
        },
    },
};
