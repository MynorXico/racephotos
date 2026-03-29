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

# S3 bucket names include envName (globally unique namespace)
RAW_BUCKET="racephotos-raw-${ENV_NAME}"
PROCESSED_BUCKET="racephotos-processed-${ENV_NAME}"

# DynamoDB and SQS names have NO envName suffix — each environment is deployed
# to an isolated AWS account, so names never collide (matches CDK constructs).
EVENTS_TABLE="racephotos-events"
PHOTOS_TABLE="racephotos-photos"
BIB_INDEX_TABLE="racephotos-bib-index"
PURCHASES_TABLE="racephotos-purchases"
PHOTOGRAPHERS_TABLE="racephotos-photographers"
RATE_LIMITS_TABLE="racephotos-rate-limits"

PROCESSING_QUEUE="racephotos-processing"
PROCESSING_DLQ="racephotos-processing-dlq"
WATERMARK_QUEUE="racephotos-watermark"
WATERMARK_DLQ="racephotos-watermark-dlq"

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

# racephotos-events — PK: id, GSI: photographerId-createdAt-index, status-createdAt-index
$AWS dynamodb create-table \
  --table-name "${EVENTS_TABLE}" \
  --attribute-definitions \
    AttributeName=id,AttributeType=S \
    AttributeName=photographerId,AttributeType=S \
    AttributeName=createdAt,AttributeType=S \
    AttributeName=status,AttributeType=S \
  --key-schema \
    AttributeName=id,KeyType=HASH \
  --global-secondary-indexes '[
    {
      "IndexName": "photographerId-createdAt-index",
      "KeySchema": [
        {"AttributeName":"photographerId","KeyType":"HASH"},
        {"AttributeName":"createdAt","KeyType":"RANGE"}
      ],
      "Projection": {"ProjectionType":"ALL"}
    },
    {
      "IndexName": "status-createdAt-index",
      "KeySchema": [
        {"AttributeName":"status","KeyType":"HASH"},
        {"AttributeName":"createdAt","KeyType":"RANGE"}
      ],
      "Projection": {"ProjectionType":"ALL"}
    }
  ]' \
  --billing-mode PAY_PER_REQUEST \
  2>/dev/null || true
log "table: ${EVENTS_TABLE}"

# racephotos-photos — PK: id, GSI: eventId-uploadedAt-index
$AWS dynamodb create-table \
  --table-name "${PHOTOS_TABLE}" \
  --attribute-definitions \
    AttributeName=id,AttributeType=S \
    AttributeName=eventId,AttributeType=S \
    AttributeName=uploadedAt,AttributeType=S \
  --key-schema \
    AttributeName=id,KeyType=HASH \
  --global-secondary-indexes '[
    {
      "IndexName": "eventId-uploadedAt-index",
      "KeySchema": [
        {"AttributeName":"eventId","KeyType":"HASH"},
        {"AttributeName":"uploadedAt","KeyType":"RANGE"}
      ],
      "Projection": {"ProjectionType":"ALL"}
    }
  ]' \
  --billing-mode PAY_PER_REQUEST \
  2>/dev/null || true
log "table: ${PHOTOS_TABLE}"

# racephotos-bib-index — PK: bibKey, SK: photoId, GSI: photoId-index (ADR-0003 fan-out)
$AWS dynamodb create-table \
  --table-name "${BIB_INDEX_TABLE}" \
  --attribute-definitions \
    AttributeName=bibKey,AttributeType=S \
    AttributeName=photoId,AttributeType=S \
  --key-schema \
    AttributeName=bibKey,KeyType=HASH \
    AttributeName=photoId,KeyType=RANGE \
  --global-secondary-indexes '[
    {
      "IndexName": "photoId-index",
      "KeySchema": [
        {"AttributeName":"photoId","KeyType":"HASH"}
      ],
      "Projection": {"ProjectionType":"ALL"}
    }
  ]' \
  --billing-mode PAY_PER_REQUEST \
  2>/dev/null || true
log "table: ${BIB_INDEX_TABLE}"

# racephotos-purchases — PK: id, 5 GSIs
$AWS dynamodb create-table \
  --table-name "${PURCHASES_TABLE}" \
  --attribute-definitions \
    AttributeName=id,AttributeType=S \
    AttributeName=photoId,AttributeType=S \
    AttributeName=claimedAt,AttributeType=S \
    AttributeName=runnerEmail,AttributeType=S \
    AttributeName=downloadToken,AttributeType=S \
    AttributeName=photographerId,AttributeType=S \
  --key-schema \
    AttributeName=id,KeyType=HASH \
  --global-secondary-indexes '[
    {
      "IndexName": "photoId-claimedAt-index",
      "KeySchema": [
        {"AttributeName":"photoId","KeyType":"HASH"},
        {"AttributeName":"claimedAt","KeyType":"RANGE"}
      ],
      "Projection": {"ProjectionType":"ALL"}
    },
    {
      "IndexName": "runnerEmail-claimedAt-index",
      "KeySchema": [
        {"AttributeName":"runnerEmail","KeyType":"HASH"},
        {"AttributeName":"claimedAt","KeyType":"RANGE"}
      ],
      "Projection": {"ProjectionType":"ALL"}
    },
    {
      "IndexName": "downloadToken-index",
      "KeySchema": [
        {"AttributeName":"downloadToken","KeyType":"HASH"}
      ],
      "Projection": {"ProjectionType":"ALL"}
    },
    {
      "IndexName": "photoId-runnerEmail-index",
      "KeySchema": [
        {"AttributeName":"photoId","KeyType":"HASH"},
        {"AttributeName":"runnerEmail","KeyType":"RANGE"}
      ],
      "Projection": {"ProjectionType":"ALL"}
    },
    {
      "IndexName": "photographerId-claimedAt-index",
      "KeySchema": [
        {"AttributeName":"photographerId","KeyType":"HASH"},
        {"AttributeName":"claimedAt","KeyType":"RANGE"}
      ],
      "Projection": {"ProjectionType":"ALL"}
    }
  ]' \
  --billing-mode PAY_PER_REQUEST \
  2>/dev/null || true
log "table: ${PURCHASES_TABLE}"

# racephotos-photographers — PK: id (simple profile store)
$AWS dynamodb create-table \
  --table-name "${PHOTOGRAPHERS_TABLE}" \
  --attribute-definitions \
    AttributeName=id,AttributeType=S \
  --key-schema \
    AttributeName=id,KeyType=HASH \
  --billing-mode PAY_PER_REQUEST \
  2>/dev/null || true
log "table: ${PHOTOGRAPHERS_TABLE}"

# racephotos-rate-limits — PK: rateLimitKey, TTL: expiresAt
$AWS dynamodb create-table \
  --table-name "${RATE_LIMITS_TABLE}" \
  --attribute-definitions \
    AttributeName=rateLimitKey,AttributeType=S \
  --key-schema \
    AttributeName=rateLimitKey,KeyType=HASH \
  --billing-mode PAY_PER_REQUEST \
  2>/dev/null || true

$AWS dynamodb update-time-to-live \
  --table-name "${RATE_LIMITS_TABLE}" \
  --time-to-live-specification "Enabled=true,AttributeName=expiresAt" \
  2>/dev/null || true
log "table: ${RATE_LIMITS_TABLE} (TTL: expiresAt)"

# ── SQS queues ────────────────────────────────────────────────────────────────
step "SQS"

# ── Processing pipeline ───────────────────────────────────────────────────────
$AWS sqs create-queue \
  --queue-name "${PROCESSING_DLQ}" \
  --query "QueueUrl" --output text 2>/dev/null || true
log "DLQ: ${PROCESSING_DLQ}"

PROCESSING_DLQ_ARN="arn:aws:sqs:${REGION}:${ACCOUNT_ID}:${PROCESSING_DLQ}"

$AWS sqs create-queue \
  --queue-name "${PROCESSING_QUEUE}" \
  --attributes "VisibilityTimeout=300,RedrivePolicy={\"deadLetterTargetArn\":\"${PROCESSING_DLQ_ARN}\",\"maxReceiveCount\":\"3\"}" \
  2>/dev/null || true
log "queue: ${PROCESSING_QUEUE} (redrive → ${PROCESSING_DLQ}, maxReceiveCount=3, visibilityTimeout=300s)"

PROCESSING_QUEUE_URL="http://sqs.${REGION}.localhost.localstack.cloud:4566/${ACCOUNT_ID}/${PROCESSING_QUEUE}"

# ── Watermark pipeline ────────────────────────────────────────────────────────
$AWS sqs create-queue \
  --queue-name "${WATERMARK_DLQ}" \
  --query "QueueUrl" --output text 2>/dev/null || true
log "DLQ: ${WATERMARK_DLQ}"

WATERMARK_DLQ_ARN="arn:aws:sqs:${REGION}:${ACCOUNT_ID}:${WATERMARK_DLQ}"

$AWS sqs create-queue \
  --queue-name "${WATERMARK_QUEUE}" \
  --attributes "RedrivePolicy={\"deadLetterTargetArn\":\"${WATERMARK_DLQ_ARN}\",\"maxReceiveCount\":\"3\"}" \
  2>/dev/null || true
log "queue: ${WATERMARK_QUEUE} (redrive → ${WATERMARK_DLQ}, maxReceiveCount=3)"

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
echo "   RACEPHOTOS_EVENTS_TABLE=${EVENTS_TABLE}"
echo "   RACEPHOTOS_PHOTOS_TABLE=${PHOTOS_TABLE}"
echo "   RACEPHOTOS_BIB_INDEX_TABLE=${BIB_INDEX_TABLE}"
echo "   RACEPHOTOS_PURCHASES_TABLE=${PURCHASES_TABLE}"
echo "   RACEPHOTOS_PHOTOGRAPHERS_TABLE=${PHOTOGRAPHERS_TABLE}"
echo "   RACEPHOTOS_RATE_LIMITS_TABLE=${RATE_LIMITS_TABLE}"
echo "   RACEPHOTOS_PROCESSING_QUEUE_URL=${PROCESSING_QUEUE_URL}"
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
