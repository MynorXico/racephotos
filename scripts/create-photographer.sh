#!/usr/bin/env bash
# -----------------------------------------------------------------------------
# create-photographer.sh
#
# Creates a Cognito user for a photographer in a given environment and sets a
# permanent password immediately, bypassing the FORCE_CHANGE_PASSWORD state.
# The photographer can log in straight away with the password entered here.
#
# If the user already exists you will be asked whether to update their password.
#
# No email is sent by Cognito — communicate the password to the photographer
# through a secure channel of your choice.
#
# Usage:
#   ./scripts/create-photographer.sh
#
# Prerequisites:
#   - AWS CLI configured with a profile that has the following permissions:
#       ssm:GetParameter            on /racephotos/env/{env}/user-pool-id
#       cognito-idp:AdminGetUser
#       cognito-idp:AdminCreateUser
#       cognito-idp:AdminSetUserPassword
#   - The target environment must already be deployed (AuthStack must exist so
#     the SSM parameter /racephotos/env/{env}/user-pool-id is present).
#
# Password requirements (Cognito default policy):
#   - Minimum 8 characters
#   - At least one uppercase letter, one lowercase letter, one number,
#     and one special character
# -----------------------------------------------------------------------------

set -euo pipefail

# ── Prompts ──────────────────────────────────────────────────────────────────

read -r -p "Photographer email:                " EMAIL
[[ -z "$EMAIL" ]] && { echo "Error: email is required."; exit 1; }

read -r -p "AWS profile:                       " PROFILE
[[ -z "$PROFILE" ]] && { echo "Error: AWS profile is required."; exit 1; }

read -r -p "Environment (dev/qa/staging/prod): " ENV
case "$ENV" in
  dev|qa|staging|prod) ;;
  *) echo "Error: invalid environment '${ENV}'. Must be one of: dev, qa, staging, prod"; exit 1 ;;
esac

# ── Resolve User Pool ID from SSM ────────────────────────────────────────────

echo "Resolving User Pool ID from SSM..."

USER_POOL_ID=$(aws ssm get-parameter \
  --name "/racephotos/env/${ENV}/user-pool-id" \
  --profile "$PROFILE" \
  --query "Parameter.Value" \
  --output text)

echo "User Pool: ${USER_POOL_ID}"

# ── Check if user already exists ─────────────────────────────────────────────

USER_EXISTS=false
if USER_CHECK=$(aws cognito-idp admin-get-user \
     --user-pool-id "$USER_POOL_ID" \
     --username "$EMAIL" \
     --profile "$PROFILE" 2>&1); then
  USER_EXISTS=true
elif [[ "$USER_CHECK" != *"UserNotFoundException"* ]]; then
  echo "Error checking user existence: $USER_CHECK"
  exit 1
fi

if $USER_EXISTS; then
  echo "User ${EMAIL} already exists."
  read -r -p "Update their password? [y/N] " CONFIRM
  if [[ ! "$CONFIRM" =~ ^[Yy]$ ]]; then
    echo "Aborted."
    exit 0
  fi
fi

# ── Prompt for password ───────────────────────────────────────────────────────
# Prompted after the existence check so a re-run after a failed password
# attempt does not require re-entering email/profile/environment first.

read -r -s -p "Permanent password:                " PERM_PASS
echo
[[ -z "$PERM_PASS" ]] && { echo "Error: password is required."; exit 1; }
read -r -s -p "Confirm password:                  " PERM_PASS_CONFIRM
echo
[[ "$PERM_PASS" != "$PERM_PASS_CONFIRM" ]] && { echo "Error: passwords do not match."; exit 1; }

# ── Create the user if needed ────────────────────────────────────────────────
# --message-action SUPPRESS prevents Cognito from sending a temporary-password
# email. The user is created in FORCE_CHANGE_PASSWORD state; the next command
# immediately promotes it to CONFIRMED.

if ! $USER_EXISTS; then
  echo "Creating user ${EMAIL}..."
  aws cognito-idp admin-create-user \
    --user-pool-id "$USER_POOL_ID" \
    --username "$EMAIL" \
    --user-attributes \
        Name=email,Value="$EMAIL" \
        Name=email_verified,Value=true \
    --message-action SUPPRESS \
    --profile "$PROFILE"
fi

# ── Set permanent password (moves user to CONFIRMED) ─────────────────────────
# Without this step the user would be stuck in FORCE_CHANGE_PASSWORD and
# blocked from logging in until they complete a change-password flow.
# If this fails (e.g. password does not meet the policy) the user account
# will already exist, and re-running the script will offer to update the
# password without attempting to recreate the account.

echo "Setting permanent password..."
if ! aws cognito-idp admin-set-user-password \
       --user-pool-id "$USER_POOL_ID" \
       --username "$EMAIL" \
       --password "$PERM_PASS" \
       --permanent \
       --profile "$PROFILE"; then
  echo ""
  echo "ERROR: failed to set password for ${EMAIL}."
  echo "The user account was created (or already existed)."
  echo "Re-run this script to try a different password — you will be asked"
  echo "whether to update the existing user rather than recreating them."
  exit 1
fi

echo ""
echo "Done. ${EMAIL} is confirmed in ${ENV} and can log in immediately."
echo "Communicate the password to them via a secure channel."
