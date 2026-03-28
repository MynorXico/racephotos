#!/usr/bin/env bash
# =============================================================================
# seed-local.sh
#
# Creates all LocalStack resources that mirror the CDK definitions.
# Run once after `docker-compose up -d`, or re-run at any time (idempotent).
#
# Usage:
#   make seed-local
#   # or directly:
#   bash scripts/seed-local.sh
#
# Requirements:
#   - LocalStack running: docker-compose up -d
#   - awslocal installed: pip install awscli-local
#     (or set AWS_ENDPOINT_URL=http://localhost:4566 and use 'aws' directly)
#
# When new CDK resources are added, mirror them here.
# =============================================================================

set -euo pipefail

# ── Config ────────────────────────────────────────────────────────────────────
ENDPOINT="http://localhost:4566"
REGION="us-east-1"
ENV_NAME="local"
ACCOUNT_ID="000000000000" # LocalStack fixed account ID

# Resource names must match future CDK constructs (envName in the suffix)
RAW_BUCKET="racephotos-raw-${ENV_NAME}"
PROCESSED_BUCKET="racephotos-processed-${ENV_NAME}"
TABLE_NAME="racephotos-photos-${ENV_NAME}"
QUEUE_NAME="racephotos-processing-${ENV_NAME}"
DLQ_NAME="racephotos-processing-dlq-${ENV_NAME}"
USER_POOL_NAME="racephotos-users-${ENV_NAME}"
USER_POOL_CLIENT_NAME="racephotos-app-${ENV_NAME}"

# Use awslocal if available, otherwise fall back to aws with endpoint
if command -v awslocal &>/dev/null; then
  AWS="awslocal"
else
  AWS="aws --endpoint-url=${ENDPOINT} --region=${REGION}"
fi

# ── Helpers ───────────────────────────────────────────────────────────────────
log()  { echo "  ✓ $*"; }
step() { echo ""; echo "── $* ──"; }

wait_for_localstack() {
  echo "Waiting for LocalStack..."
  for i in $(seq 1 30); do
    if curl -sf "${ENDPOINT}/_localstack/health" | grep -q '"s3": "available"' 2>/dev/null || \
       curl -sf "${ENDPOINT}/_localstack/health" | grep -q '"s3": "running"' 2>/dev/null; then
      echo "LocalStack is ready."
      return 0
    fi
    echo "  attempt $i/30..."
    sleep 2
  done
  echo "ERROR: LocalStack did not become ready in time."
  echo "Make sure it is running: docker-compose up -d"
  exit 1
}

# ── Start ─────────────────────────────────────────────────────────────────────
echo ""
echo "RaceShots — LocalStack seed"
echo "Endpoint: ${ENDPOINT}"
echo "Env:      ${ENV_NAME}"

wait_for_localstack

# ── S3 buckets ────────────────────────────────────────────────────────────────
step "S3"

$AWS s3api create-bucket \
  --bucket "${RAW_BUCKET}" \
  --region "${REGION}" 2>/dev/null || true
log "bucket: ${RAW_BUCKET}"

$AWS s3api create-bucket \
  --bucket "${PROCESSED_BUCKET}" \
  --region "${REGION}" 2>/dev/null || true
log "bucket: ${PROCESSED_BUCKET}"

# Block public access on both buckets (matches CDK defaults)
for BUCKET in "${RAW_BUCKET}" "${PROCESSED_BUCKET}"; do
  $AWS s3api put-public-access-block \
    --bucket "${BUCKET}" \
    --public-access-block-configuration \
      "BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true" \
    2>/dev/null || true
done
log "public access blocked on both buckets"

# ── DynamoDB ──────────────────────────────────────────────────────────────────
step "DynamoDB"

$AWS dynamodb create-table \
  --table-name "${TABLE_NAME}" \
  --attribute-definitions \
    AttributeName=PK,AttributeType=S \
    AttributeName=SK,AttributeType=S \
    AttributeName=GSI1PK,AttributeType=S \
    AttributeName=GSI1SK,AttributeType=S \
  --key-schema \
    AttributeName=PK,KeyType=HASH \
    AttributeName=SK,KeyType=RANGE \
  --global-secondary-indexes '[
    {
      "IndexName": "GSI1",
      "KeySchema": [
        {"AttributeName":"GSI1PK","KeyType":"HASH"},
        {"AttributeName":"GSI1SK","KeyType":"RANGE"}
      ],
      "Projection": {"ProjectionType":"ALL"}
    }
  ]' \
  --billing-mode PAY_PER_REQUEST \
  2>/dev/null || true
log "table: ${TABLE_NAME} (PK/SK + GSI1)"

# ── SQS queues ────────────────────────────────────────────────────────────────
step "SQS"

# Dead-letter queue first
DLQ_URL=$($AWS sqs create-queue \
  --queue-name "${DLQ_NAME}" \
  --query "QueueUrl" --output text 2>/dev/null || \
  $AWS sqs get-queue-url --queue-name "${DLQ_NAME}" --query "QueueUrl" --output text)
log "DLQ: ${DLQ_NAME}"

DLQ_ARN="arn:aws:sqs:${REGION}:${ACCOUNT_ID}:${DLQ_NAME}"

# Main processing queue with DLQ redrive (maxReceiveCount: 3 — matches CDK)
$AWS sqs create-queue \
  --queue-name "${QUEUE_NAME}" \
  --attributes "{\"RedrivePolicy\":\"{\\\"deadLetterTargetArn\\\":\\\"${DLQ_ARN}\\\",\\\"maxReceiveCount\\\":\\\"3\\\"}\"}" \
  2>/dev/null || true
log "queue: ${QUEUE_NAME} (redrive → ${DLQ_NAME}, maxReceiveCount=3)"

QUEUE_URL="http://sqs.${REGION}.localhost.localstack.cloud:4566/${ACCOUNT_ID}/${QUEUE_NAME}"
log "queue URL: ${QUEUE_URL}"

# ── Cognito User Pool ─────────────────────────────────────────────────────────
step "Cognito"

# Create user pool (or get existing)
EXISTING_POOL_ID=$($AWS cognito-idp list-user-pools --max-results 10 \
  --query "UserPools[?Name=='${USER_POOL_NAME}'].Id | [0]" --output text 2>/dev/null || echo "None")

if [[ -z "${EXISTING_POOL_ID}" || "${EXISTING_POOL_ID}" == "None" ]]; then
  USER_POOL_ID=$($AWS cognito-idp create-user-pool \
    --pool-name "${USER_POOL_NAME}" \
    --auto-verified-attributes email \
    --username-attributes email \
    --policies '{"PasswordPolicy":{"MinimumLength":8,"RequireUppercase":false,"RequireLowercase":false,"RequireNumbers":false,"RequireSymbols":false}}' \
    --query "UserPool.Id" --output text)
else
  USER_POOL_ID="${EXISTING_POOL_ID}"
fi
log "user pool: ${USER_POOL_NAME} (${USER_POOL_ID})"

# Create app client (or get existing)
EXISTING_CLIENT_ID=$($AWS cognito-idp list-user-pool-clients \
  --user-pool-id "${USER_POOL_ID}" \
  --query "UserPoolClients[?ClientName=='${USER_POOL_CLIENT_NAME}'].ClientId | [0]" \
  --output text 2>/dev/null || echo "None")

if [[ -z "${EXISTING_CLIENT_ID}" || "${EXISTING_CLIENT_ID}" == "None" ]]; then
  CLIENT_ID=$($AWS cognito-idp create-user-pool-client \
    --user-pool-id "${USER_POOL_ID}" \
    --client-name "${USER_POOL_CLIENT_NAME}" \
    --no-generate-secret \
    --explicit-auth-flows ALLOW_USER_PASSWORD_AUTH ALLOW_REFRESH_TOKEN_AUTH ALLOW_USER_SRP_AUTH \
    --query "UserPoolClient.ClientId" --output text)
else
  CLIENT_ID="${EXISTING_CLIENT_ID}"
fi
log "app client: ${USER_POOL_CLIENT_NAME} (${CLIENT_ID})"

# ── SES sender identity ───────────────────────────────────────────────────────
step "SES"

$AWS ses verify-email-identity \
  --email-address "noreply@example.com" 2>/dev/null || true
log "verified sender: noreply@example.com"

# ── Summary ───────────────────────────────────────────────────────────────────
echo ""
echo "════════════════════════════════════════════════════════════"
echo " Seed complete. Add these to your .env.local:"
echo ""
echo "   RACEPHOTOS_ENV=local"
echo "   RACEPHOTOS_RAW_BUCKET=${RAW_BUCKET}"
echo "   RACEPHOTOS_PROCESSED_BUCKET=${PROCESSED_BUCKET}"
echo "   RACEPHOTOS_TABLE_NAME=${TABLE_NAME}"
echo "   RACEPHOTOS_QUEUE_URL=${QUEUE_URL}"
echo "   AWS_ENDPOINT_URL=${ENDPOINT}"
echo "   AWS_ACCESS_KEY_ID=test"
echo "   AWS_SECRET_ACCESS_KEY=test"
echo "   AWS_REGION=${REGION}"
echo ""
echo " Update frontend/angular/src/assets/config.json with:"
echo ""
echo "   \"cognitoUserPoolId\": \"${USER_POOL_ID}\","
echo "   \"cognitoClientId\":   \"${CLIENT_ID}\","
echo "   \"cognitoOauthDomain\": \"localhost.localstack.cloud:4566\""
echo "════════════════════════════════════════════════════════════"
echo ""
