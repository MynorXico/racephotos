#!/usr/bin/env bash
# =============================================================================
# seed-ssm.sh
#
# One-time setup: creates all SSM parameters in the TOOLS account.
# Run this with credentials for the TOOLS account before the first cdk deploy.
#
# Usage:
#   AWS_PROFILE=tools ./scripts/seed-ssm.sh
#
# You will be prompted for each value. Nothing is hardcoded here.
# Re-run at any time to update a value — put-parameter with --overwrite
# updates existing parameters safely.
# =============================================================================

set -euo pipefail

REGION=${AWS_REGION:-us-east-1}

# ── AWS profile ───────────────────────────────────────────────────────────────
# Prompt for the profile rather than falling back to the ambient default,
# to avoid accidentally writing parameters to the wrong account.
echo ""
echo "RaceShots — SSM parameter setup"
echo ""
read -rp "AWS profile to use (e.g. tools): " INPUT_PROFILE
if [[ -z "$INPUT_PROFILE" ]]; then
  echo "ERROR: AWS profile is required. Aborting."
  exit 1
fi
export AWS_PROFILE="$INPUT_PROFILE"

# Verify the profile resolves to the expected account before writing anything.
RESOLVED_ACCOUNT=$(aws sts get-caller-identity --query Account --output text 2>/dev/null || true)
if [[ -z "$RESOLVED_ACCOUNT" ]]; then
  echo "ERROR: Could not authenticate with profile '$AWS_PROFILE'."
  echo "Check that the profile exists in ~/.aws/config and credentials are valid."
  exit 1
fi
echo "Authenticated as account: $RESOLVED_ACCOUNT (profile: $AWS_PROFILE)"
echo "Region: $REGION"
echo ""

put() {
  local name=$1
  local value=$2
  aws ssm put-parameter \
    --name "$name" \
    --value "$value" \
    --type "String" \
    --overwrite \
    --region "$REGION" \
    --query "Version" \
    --output text
  echo "  set $name"
}

# ── TOOLS account ─────────────────────────────────────────────────────────────
read -rp "TOOLS account ID:  " TOOLS_ACCOUNT
read -rp "TOOLS region:      " TOOLS_REGION

put "/racephotos/tools/account-id" "$TOOLS_ACCOUNT"
put "/racephotos/tools/region"     "$TOOLS_REGION"

# ── GitHub ────────────────────────────────────────────────────────────────────
read -rp "GitHub owner (org or username): " GH_OWNER
read -rp "GitHub repo name:               " GH_REPO
read -rp "GitHub branch [main]:           " GH_BRANCH
GH_BRANCH=${GH_BRANCH:-main}
read -rp "CodeStar connection ARN:        " CS_ARN

put "/racephotos/github/owner"                  "$GH_OWNER"
put "/racephotos/github/repo"                   "$GH_REPO"
put "/racephotos/github/branch"                 "$GH_BRANCH"
put "/racephotos/github/codestar-connection-arn" "$CS_ARN"

# ── Target accounts ───────────────────────────────────────────────────────────
for ENV_NAME in dev qa staging prod; do
  echo ""
  echo "── $ENV_NAME ──"
  read -rp "  Account ID (leave blank to skip): " ACC
  if [[ -z "$ACC" ]]; then
    echo "  Skipping $ENV_NAME"
    continue
  fi
  read -rp "  Region [$TOOLS_REGION]: " REG
  REG=${REG:-$TOOLS_REGION}
  put "/racephotos/env/$ENV_NAME/account-id" "$ACC"
  put "/racephotos/env/$ENV_NAME/region"     "$REG"

  # Custom domain — leave blank for CloudFront default (*.cloudfront.net)
  read -rp "  Custom domain (e.g. app.dev.example.com, blank = none): " DOMAIN
  DOMAIN=${DOMAIN:-none}
  put "/racephotos/env/$ENV_NAME/domain-name" "$DOMAIN"

  # ACM certificate ARN — must be in us-east-1 (CloudFront requirement)
  if [[ "$DOMAIN" == "none" ]]; then
    put "/racephotos/env/$ENV_NAME/certificate-arn" "none"
  else
    echo "  Certificate must be in us-east-1 in the $ENV_NAME account."
    echo "  See docs/setup/aws-bootstrap.md for ACM setup instructions."
    read -rp "  ACM certificate ARN (us-east-1): " CERT_ARN
    put "/racephotos/env/$ENV_NAME/certificate-arn" "$CERT_ARN"
  fi
done

echo ""
echo "Done. Run 'cdk synth' to verify all parameters resolve correctly."
echo ""
echo "Tip: verify with:"
echo "  AWS_PROFILE=$AWS_PROFILE aws ssm get-parameters-by-path \\"
echo "    --path '/racephotos' --recursive --output table"
