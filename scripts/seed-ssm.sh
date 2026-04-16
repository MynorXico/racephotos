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
# Each prompt shows the current SSM value in brackets — press Enter to keep it.
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

# current <ssm-path>
# Returns the current value of an SSM parameter, or empty string if not set.
current() {
  aws ssm get-parameter \
    --profile "$AWS_PROFILE" \
    --name "$1" \
    --region "$REGION" \
    --query "Parameter.Value" \
    --output text 2>/dev/null || true
}

# prompt <display-label> <ssm-path> [<fallback-default>]
# Reads a value from the user, defaulting to the current SSM value.
# Stores the result in $PROMPT_RESULT.
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

# ── TOOLS account ─────────────────────────────────────────────────────────────
prompt "TOOLS account ID " "/racephotos/tools/account-id"
TOOLS_ACCOUNT="$PROMPT_RESULT"

prompt "TOOLS region     " "/racephotos/tools/region" "$REGION"
TOOLS_REGION="$PROMPT_RESULT"

put "/racephotos/tools/account-id" "$TOOLS_ACCOUNT"
put "/racephotos/tools/region"     "$TOOLS_REGION"

# ── GitHub ────────────────────────────────────────────────────────────────────
prompt "GitHub owner (org or username)" "/racephotos/github/owner"
GH_OWNER="$PROMPT_RESULT"

prompt "GitHub repo name               " "/racephotos/github/repo"
GH_REPO="$PROMPT_RESULT"

prompt "GitHub branch                  " "/racephotos/github/branch" "main"
GH_BRANCH="$PROMPT_RESULT"

prompt "CodeStar connection ARN        " "/racephotos/github/codestar-connection-arn"
CS_ARN="$PROMPT_RESULT"

put "/racephotos/github/owner"                   "$GH_OWNER"
put "/racephotos/github/repo"                    "$GH_REPO"
put "/racephotos/github/branch"                  "$GH_BRANCH"
put "/racephotos/github/codestar-connection-arn" "$CS_ARN"

# ── Target accounts ───────────────────────────────────────────────────────────
for ENV_NAME in dev qa staging prod; do
  echo ""
  echo "── $ENV_NAME ──"

  existing_acc=$(current "/racephotos/env/$ENV_NAME/account-id")
  if [[ -n "$existing_acc" ]]; then
    read -rp "  Account ID [${existing_acc}] (leave blank to keep, type 'skip' to skip env): " ACC
    if [[ "$ACC" == "skip" ]]; then
      echo "  Skipping $ENV_NAME"
      continue
    fi
    ACC="${ACC:-$existing_acc}"
  else
    read -rp "  Account ID (leave blank to skip): " ACC
    if [[ -z "$ACC" ]]; then
      echo "  Skipping $ENV_NAME"
      continue
    fi
  fi

  prompt "  Region                  " "/racephotos/env/$ENV_NAME/region" "$TOOLS_REGION"
  REG="$PROMPT_RESULT"
  put "/racephotos/env/$ENV_NAME/account-id" "$ACC"
  put "/racephotos/env/$ENV_NAME/region"     "$REG"

  # Custom domain — leave blank for CloudFront default (*.cloudfront.net)
  prompt "  Custom domain (blank = none)" "/racephotos/env/$ENV_NAME/domain-name" "none"
  DOMAIN="$PROMPT_RESULT"
  put "/racephotos/env/$ENV_NAME/domain-name" "$DOMAIN"

  # ACM certificate ARN — must be in us-east-1 (CloudFront requirement)
  if [[ "$DOMAIN" == "none" ]]; then
    put "/racephotos/env/$ENV_NAME/certificate-arn" "none"
  else
    echo "  Certificate must be in us-east-1 in the $ENV_NAME account."
    echo "  See docs/setup/aws-bootstrap.md for ACM setup instructions."
    prompt "  ACM certificate ARN (us-east-1)" "/racephotos/env/$ENV_NAME/certificate-arn"
    put "/racephotos/env/$ENV_NAME/certificate-arn" "$PROMPT_RESULT"
  fi

  # SES verified sender address (RS-003)
  # This value is intentionally NOT in environments.ts — email addresses must
  # not appear in version control. In dev you can use any address you have
  # verified in the SES console. In prod SES must be out of sandbox mode.
  # See docs/setup/aws-bootstrap.md for SES sandbox lift instructions.
  echo "  SES sender address: the verified From: address for all outbound emails."
  echo "  e.g. noreply@yourdomain.com — must be verified in SES in this account."
  prompt "  SES from-address" "/racephotos/env/$ENV_NAME/ses-from-address"
  SES_FROM="$PROMPT_RESULT"
  if [[ -z "$SES_FROM" ]]; then
    echo "  ERROR: ses-from-address is required. Aborting."
    echo "  Verify an address in SES first (SES console → Verified identities), then re-run this script."
    exit 1
  fi
  put "/racephotos/env/$ENV_NAME/ses-from-address" "$SES_FROM"

  # SES configuration set name (RS-010)
  # The name of the SES configuration set associated with the sending identity
  # in this environment (used for click/open tracking or suppression lists).
  # Leave blank or enter "none" if no configuration set is associated.
  # Find the name in SES console → Configuration sets, or under the verified
  # identity's "Default configuration set" setting.
  prompt "  SES configuration set name (blank = none)" "/racephotos/env/$ENV_NAME/ses-configuration-set-name" "none"
  SES_CONFIG_SET="${PROMPT_RESULT:-none}"
  put "/racephotos/env/$ENV_NAME/ses-configuration-set-name" "$SES_CONFIG_SET"

  # Write env-specific parameters to the target environment account.
  # CloudFormation resolves valueForStringParameter at deploy time in the
  # account where the stack is deployed — not in the tools account.
  # Providing the env profile here avoids having to run a separate script.
  echo ""
  echo "  Some parameters must also exist in the $ENV_NAME account itself"
  echo "  (CloudFormation resolves them there at deploy time)."
  read -rp "  $ENV_NAME AWS profile (leave blank to skip — you can set these later): " ENV_PROFILE
  if [[ -n "$ENV_PROFILE" ]]; then
    ENV_ACCOUNT=$(aws sts get-caller-identity --profile "$ENV_PROFILE" --query Account --output text 2>/dev/null || true)
    if [[ -z "$ENV_ACCOUNT" ]]; then
      echo "  WARNING: could not authenticate with profile '$ENV_PROFILE'. Skipping $ENV_NAME account writes."
    else
      echo "  Writing to $ENV_NAME account: $ENV_ACCOUNT (profile: $ENV_PROFILE)"
      aws ssm put-parameter \
        --profile "$ENV_PROFILE" \
        --name "/racephotos/env/$ENV_NAME/ses-from-address" \
        --value "$SES_FROM" \
        --type "String" \
        --overwrite \
        --region "$REG" \
        --query "Version" \
        --output text
      echo "  set /racephotos/env/$ENV_NAME/ses-from-address (in $ENV_NAME account)"
    fi
  else
    echo "  Skipped. To set this parameter later, run:"
    echo "    aws ssm put-parameter --profile <$ENV_NAME-profile> \\"
    echo "      --name \"/racephotos/env/$ENV_NAME/ses-from-address\" \\"
    echo "      --value \"$SES_FROM\" --region \"$REG\" --type String --overwrite"
  fi
done

echo ""
echo "Done. Run 'cdk synth' to verify all parameters resolve correctly."
echo ""
echo "Tip: verify with:"
echo "  AWS_PROFILE=$AWS_PROFILE aws ssm get-parameters-by-path \\"
echo "    --path '/racephotos' --recursive --output table"
