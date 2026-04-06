#!/usr/bin/env bash
# -----------------------------------------------------------------------------
# create-photographer.sh
#
# Creates a Cognito user for a photographer in a given environment and sets a
# permanent password immediately, bypassing the FORCE_CHANGE_PASSWORD state.
# The photographer can log in straight away with the password entered here.
#
# No email is sent by Cognito — communicate the password to the photographer
# through a secure channel of your choice.
#
# Usage:
#   ./scripts/create-photographer.sh
#
# Prerequisites:
#   - AWS CLI configured with a profile that has the following permissions:
#       ssm:GetParameter        on /racephotos/env/{env}/user-pool-id
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

read -r -p "Photographer email:              " EMAIL
read -r -p "AWS profile:                     " PROFILE
read -r -p "Environment (dev/qa/staging/prod): " ENV
read -r -s -p "Permanent password:              " PERM_PASS
echo

# ── Resolve User Pool ID from SSM ────────────────────────────────────────────

echo "Resolving User Pool ID from SSM..."

USER_POOL_ID=$(aws ssm get-parameter \
  --name "/racephotos/env/${ENV}/user-pool-id" \
  --profile "$PROFILE" \
  --query "Parameter.Value" \
  --output text)

echo "User Pool: ${USER_POOL_ID}"

# ── Create the user (no email sent) ──────────────────────────────────────────
# --message-action SUPPRESS prevents Cognito from sending a temporary-password
# email. The user is created in FORCE_CHANGE_PASSWORD state; the next command
# immediately promotes it to CONFIRMED.

echo "Creating user ${EMAIL}..."

aws cognito-idp admin-create-user \
  --user-pool-id "$USER_POOL_ID" \
  --username "$EMAIL" \
  --user-attributes \
      Name=email,Value="$EMAIL" \
      Name=email_verified,Value=true \
  --message-action SUPPRESS \
  --profile "$PROFILE"

# ── Set permanent password (moves user to CONFIRMED) ─────────────────────────
# Without this step the user would be stuck in FORCE_CHANGE_PASSWORD and
# blocked from logging in until they complete a change-password flow.

echo "Setting permanent password..."

aws cognito-idp admin-set-user-password \
  --user-pool-id "$USER_POOL_ID" \
  --username "$EMAIL" \
  --password "$PERM_PASS" \
  --permanent \
  --profile "$PROFILE"

echo ""
echo "Done. ${EMAIL} is confirmed in ${ENV} and can log in immediately."
echo "Communicate the password to them via a secure channel."
