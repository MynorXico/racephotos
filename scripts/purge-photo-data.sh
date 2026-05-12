#!/usr/bin/env bash
# =============================================================================
# purge-photo-data.sh
#
# Deletes ALL photo data for ALL photographers in a given environment.
# Clears four resources:
#   - S3 raw bucket        (original uploads)
#   - S3 processed bucket  (watermarked outputs)
#   - DynamoDB photos table      (photo metadata)
#   - DynamoDB bib-index table   (bib fan-out records)
#
# Usage:
#   bash scripts/purge-photo-data.sh
#
# The script will prompt for the target environment and AWS profile, then ask
# for explicit confirmation before deleting anything.
#
# Requirements:
#   - AWS CLI v2 installed and configured
#   - jq installed
#   - Sufficient IAM permissions:
#       s3:DeleteObject, s3:ListBucket
#       dynamodb:Scan, dynamodb:BatchWriteItem
# =============================================================================

set -euo pipefail

RED='\033[0;31m'
YELLOW='\033[1;33m'
GREEN='\033[0;32m'
BOLD='\033[1m'
RESET='\033[0m'

# ── Prompt for environment ────────────────────────────────────────────────────

echo ""
echo -e "${BOLD}RaceShots — Purge photo data${RESET}"
echo ""
echo "Available environments: dev, qa, staging, prod"
read -rp "Target environment: " ENV_NAME

if [[ -z "$ENV_NAME" ]]; then
  echo "Environment cannot be empty." >&2
  exit 1
fi

# Extra safety gate for production.
if [[ "$ENV_NAME" == "prod" ]]; then
  echo ""
  echo -e "${RED}${BOLD}WARNING: You are about to purge PRODUCTION data.${RESET}"
  read -rp "Type 'delete production' to continue: " PROD_CONFIRM
  if [[ "$PROD_CONFIRM" != "delete production" ]]; then
    echo "Aborted." >&2
    exit 1
  fi
fi

# ── Prompt for AWS profile ────────────────────────────────────────────────────

read -rp "AWS profile [${ENV_NAME}]: " AWS_PROFILE
AWS_PROFILE="${AWS_PROFILE:-${ENV_NAME}}"

# ── Derive resource names ─────────────────────────────────────────────────────
# S3 bucket names include envName (globally unique namespace).
# DynamoDB table names: check whether env suffix is present in this account.

RAW_BUCKET="racephotos-raw-${ENV_NAME}"
PROCESSED_BUCKET="racephotos-processed-${ENV_NAME}"

# Determine DynamoDB table name convention by probing both forms.
# Some deployments use a suffix (racephotos-photos-dev); others don't.
if aws dynamodb describe-table \
    --table-name "racephotos-photos-${ENV_NAME}" \
    --profile "$AWS_PROFILE" \
    --output json > /dev/null 2>&1; then
  PHOTOS_TABLE="racephotos-photos-${ENV_NAME}"
  BIB_TABLE="racephotos-bib-index-${ENV_NAME}"
else
  PHOTOS_TABLE="racephotos-photos"
  BIB_TABLE="racephotos-bib-index"
fi

# ── Confirmation ──────────────────────────────────────────────────────────────

echo ""
echo -e "${YELLOW}${BOLD}The following resources will be PERMANENTLY DELETED:${RESET}"
echo "  S3 bucket (raw):       s3://${RAW_BUCKET}"
echo "  S3 bucket (processed): s3://${PROCESSED_BUCKET}"
echo "  DynamoDB table:        ${PHOTOS_TABLE}"
echo "  DynamoDB table:        ${BIB_TABLE}"
echo "  AWS profile:           ${AWS_PROFILE}"
echo ""
read -rp "Type 'yes' to confirm: " CONFIRM

if [[ "$CONFIRM" != "yes" ]]; then
  echo "Aborted." >&2
  exit 1
fi

# ── Helper ────────────────────────────────────────────────────────────────────

dynamo_purge() {
  local table="$1"
  local keys_projection="$2"    # e.g. "id" or "bibKey photoId"
  local key_builder="$3"         # jq expression to build the Key object

  echo -e "\n${BOLD}Clearing ${table}...${RESET}"

  local last_key=""
  local total=0

  while true; do
    local scan_args=(
      --table-name "$table"
      --attributes-to-get $keys_projection
      --profile "$AWS_PROFILE"
      --output json
    )
    if [[ -n "$last_key" ]]; then
      scan_args+=(--exclusive-start-key "$last_key")
    fi

    local result
    result=$(aws dynamodb scan "${scan_args[@]}")

    local count
    count=$(echo "$result" | jq '.Items | length')

    if [[ "$count" -eq 0 ]]; then
      break
    fi

    # Build delete requests and send in batches of 25.
    local batches
    batches=$(echo "$result" | jq -c \
      "[.Items[] | {\"DeleteRequest\": {\"Key\": ${key_builder}}}]
       | _nwise(25)
       | {\"${table}\": .}")

    while IFS= read -r batch; do
      aws dynamodb batch-write-item \
        --request-items "$batch" \
        --profile "$AWS_PROFILE" \
        --output json > /dev/null
      total=$((total + 25))
      echo "  deleted batch (≈${total} items so far)"
    done <<< "$batches"

    # Paginate if DynamoDB returned a continuation key.
    last_key=$(echo "$result" | jq -c '.LastEvaluatedKey // empty')
    if [[ -z "$last_key" ]]; then
      break
    fi
  done

  echo -e "  ${GREEN}done${RESET}"
}

# ── Execute ───────────────────────────────────────────────────────────────────

echo ""
echo -e "${BOLD}Step 1/4 — Empty raw S3 bucket${RESET}"
aws s3 rm "s3://${RAW_BUCKET}" --recursive --profile "$AWS_PROFILE"
echo -e "  ${GREEN}done${RESET}"

echo ""
echo -e "${BOLD}Step 2/4 — Empty processed S3 bucket${RESET}"
aws s3 rm "s3://${PROCESSED_BUCKET}" --recursive --profile "$AWS_PROFILE"
echo -e "  ${GREEN}done${RESET}"

dynamo_purge \
  "$PHOTOS_TABLE" \
  "id" \
  '{"id": {"S": .id.S}}'

dynamo_purge \
  "$BIB_TABLE" \
  "bibKey photoId" \
  '{"bibKey": {"S": .bibKey.S}, "photoId": {"S": .photoId.S}}'

echo ""
echo -e "${GREEN}${BOLD}All photo data purged for environment: ${ENV_NAME}${RESET}"
echo ""
