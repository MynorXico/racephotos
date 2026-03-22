/**
 * types.ts — committed to the repository
 *
 * Contains only type definitions. No account IDs, no secrets, no region names.
 * Imported by all CDK stacks and stages.
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
