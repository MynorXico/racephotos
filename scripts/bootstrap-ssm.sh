#!/usr/bin/env bash
# =============================================================================
# bootstrap-ssm.sh
#
# Creates the SSM parameters that CDK stacks read at CloudFormation deploy time
# in the TARGET ENVIRONMENT account (dev, qa, staging, prod).
#
# These are sensitive values that cannot come from environments.ts (version
# control) and must exist in each environment account BEFORE the pipeline
# deploys stacks into that account.
#
# Run once per environment account, with credentials for that account:
#
#   AWS_PROFILE=dev  ./scripts/bootstrap-ssm.sh dev
#   AWS_PROFILE=prod ./scripts/bootstrap-ssm.sh prod
#
# Or omit the env argument to be prompted:
#
#   ./scripts/bootstrap-ssm.sh
#
# Re-run at any time to update a value. Each prompt shows the current SSM
# value in brackets — press Enter to keep it.
#
# NOTE: This script is distinct from seed-ssm.sh, which targets the TOOLS
# account and seeds pipeline / GitHub / cross-account config. This script
# targets the environment account and seeds only the values that deployed
# CloudFormation stacks need to resolve at deploy time.
# =============================================================================

set -euo pipefail

REGION=${AWS_REGION:-us-east-1}

# ── Environment argument ───────────────────────────────────────────────────────
ENV_NAME="${1:-}"
if [[ -z "$ENV_NAME" ]]; then
  read -rp "Environment name (dev | qa | staging | prod): " ENV_NAME
fi
if [[ -z "$ENV_NAME" ]]; then
  echo "ERROR: environment name is required. Aborting."
  exit 1
fi

# ── AWS profile ───────────────────────────────────────────────────────────────
echo ""
echo "RaceShots — SSM bootstrap for environment: $ENV_NAME"
echo ""
if [[ -z "${AWS_PROFILE:-}" ]]; then
  read -rp "AWS profile to use (e.g. dev): " INPUT_PROFILE
  if [[ -z "$INPUT_PROFILE" ]]; then
    echo "ERROR: AWS profile is required. Aborting."
    exit 1
  fi
  export AWS_PROFILE="$INPUT_PROFILE"
fi

RESOLVED_ACCOUNT=$(aws sts get-caller-identity --profile "$AWS_PROFILE" --query Account --output text 2>/dev/null || true)
if [[ -z "$RESOLVED_ACCOUNT" ]]; then
  echo "ERROR: Could not authenticate with profile '$AWS_PROFILE'."
  echo "Check that the profile exists in ~/.aws/config and credentials are valid."
  exit 1
fi
echo "Authenticated as account: $RESOLVED_ACCOUNT (profile: $AWS_PROFILE)"
echo "Region: $REGION"
echo ""

# current <ssm-path>
current() {
  aws ssm get-parameter \
    --profile "$AWS_PROFILE" \
    --name "$1" \
    --region "$REGION" \
    --query "Parameter.Value" \
    --output text 2>/dev/null || true
}

# prompt <display-label> <ssm-path> [<fallback-default>]
# Stores result in $PROMPT_RESULT.
prompt() {
  local label="$1"
  local ssm_path="$2"
  local fallback="${3:-}"
  local existing
  existing=$(current "$ssm_path")
  local default="${existing:-$fallback}"

  if [[ -n "$default" ]]; then
    read -rp "${label} [${default}]: " PROMPT_RESULT
    PROMPT_RESULT="${PROMPT_RESULT:-$default}"
  else
    read -rp "${label}: " PROMPT_RESULT
  fi
}

put() {
  local name=$1
  local value=$2
  aws ssm put-parameter \
    --profile "$AWS_PROFILE" \
    --name "$name" \
    --value "$value" \
    --type "String" \
    --overwrite \
    --region "$REGION" \
    --query "Version" \
    --output text
  echo "  set $name"
}

# ── SES sender address (RS-003) ───────────────────────────────────────────────
# Required by SesStack — CloudFormation resolves this at deploy time via
# AWS::SSM::Parameter::Value<String>. Must exist in this account before the
# pipeline deploys the SES stack.
#
# The address must be verified in SES in this account:
#   SES console → Verified identities → Create identity
# In dev/qa you can use any individual address you control.
# In prod, SES must be out of sandbox mode for sending to arbitrary addresses.
echo "── SES sender address ──"
echo "  Must be verified in SES in account $RESOLVED_ACCOUNT."
echo "  See docs/setup/aws-bootstrap.md for SES verification steps."
prompt "  SES from-address (e.g. noreply@yourdomain.com)" \
  "/racephotos/env/$ENV_NAME/ses-from-address"
SES_FROM="$PROMPT_RESULT"
if [[ -z "$SES_FROM" ]]; then
  echo "  ERROR: ses-from-address is required. Aborting."
  exit 1
fi
put "/racephotos/env/$ENV_NAME/ses-from-address" "$SES_FROM"

# ── Future pre-deploy parameters go here ─────────────────────────────────────
# Add new prompts + put calls below as new stacks require them.
# Keep this script limited to values that CloudFormation must resolve at deploy
# time (valueForStringParameter). Values written by CDK stacks themselves (e.g.
# Cognito IDs, API URLs) do NOT belong here.

echo ""
echo "Done. Verify with:"
echo "  aws ssm get-parameters-by-path --profile $AWS_PROFILE \\"
echo "    --path '/racephotos/env/$ENV_NAME' --recursive --output table"
echo ""
