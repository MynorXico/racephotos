#!/usr/bin/env bash
# =============================================================================
# generate-cdk-context.sh
#
# Generates infra/cdk/cdk.context.json from SSM Parameter Store.
#
# CDK's valueFromLookup resolves parameters at synth time and caches the
# results in cdk.context.json. Without the cache, CDK substitutes dummy
# values and synth fails on resources that validate ARNs or bucket names.
#
# This script builds the cache file dynamically from SSM so that:
#   - No account IDs are committed to git
#   - Any fork just runs this script with their own credentials
#   - The pipeline Synth ShellStep calls it automatically before cdk synth
#
# Usage (from repo root):
#   AWS_PROFILE=tools ./scripts/generate-cdk-context.sh
#
# Called automatically by the pipeline — no manual step needed in CI.
# =============================================================================

set -euo pipefail

REGION=${AWS_DEFAULT_REGION:-us-east-1}
ACCT=$(aws sts get-caller-identity --query Account --output text)

echo "Generating cdk.context.json — account: $ACCT  region: $REGION"

# Fetch all /racephotos/* parameters in one API call.
# AWS CLI v2 auto-paginates, so all parameters are returned regardless of count.
# Pass account and region as argv to the Python script to avoid bash variable
# expansion inside the heredoc (quoted PYEOF delimiter).
python3 - "$ACCT" "$REGION" << 'PYEOF'
import subprocess, json, sys

acct, region = sys.argv[1], sys.argv[2]

result = subprocess.run(
    [
        "aws", "ssm", "get-parameters-by-path",
        "--path", "/racephotos",
        "--recursive",
        "--output", "json",
        "--region", region,
    ],
    capture_output=True,
    text=True,
    check=True,
)

data = json.loads(result.stdout)
ctx = {}
for p in data.get("Parameters", []):
    # Key format matches what CDK writes when it resolves valueFromLookup:
    #   ssm:account=ACCOUNT:parameterName=NAME:region=REGION
    key = f"ssm:account={acct}:parameterName={p['Name']}:region={region}"
    ctx[key] = p["Value"]

with open("infra/cdk/cdk.context.json", "w") as f:
    json.dump(ctx, f, indent=2)

print(f"Generated infra/cdk/cdk.context.json with {len(ctx)} entries")
PYEOF
