import * as cdk from 'aws-cdk-lib';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import { Construct } from 'constructs';
import { EnvConfig } from '../config/types';

interface DatabaseConstructProps {
  config: EnvConfig;
}

/**
 * DatabaseConstruct
 *
 * Creates the six DynamoDB tables that underpin all RaceShots data access patterns.
 * All tables use ON_DEMAND billing and explicit names (no envName suffix — each
 * environment is deployed to an isolated AWS account, so names never collide).
 *
 * Tables:
 *   racephotos-events        — photographer events; GSIs for photographer and status queries
 *   racephotos-photos        — photo metadata; GSI for event-based listing
 *   racephotos-bib-index     — fan-out bib lookup table (ADR-0003); one item per (eventId, bib, photoId)
 *   racephotos-purchases     — purchase records; GSIs for approval workflow and runner history
 *   racephotos-photographers — photographer profiles; simple PK-only lookup
 *   racephotos-rate-limits   — per-email rate limit tokens; TTL-based auto-expiry
 *
 * Removal policy driven by config.enableDeletionProtection:
 *   false → DESTROY (dev/qa)
 *   true  → RETAIN (staging/prod)
 *
 * AC: RS-001 AC2
 */
export class DatabaseConstruct extends Construct {
  readonly eventsTable: dynamodb.Table;
  readonly photosTable: dynamodb.Table;
  readonly bibIndexTable: dynamodb.Table;
  readonly purchasesTable: dynamodb.Table;
  readonly photographersTable: dynamodb.Table;
  readonly rateLimitsTable: dynamodb.Table;

  constructor(scope: Construct, id: string, props: DatabaseConstructProps) {
    super(scope, id);

    const { config } = props;

    const removalPolicy = config.enableDeletionProtection
      ? cdk.RemovalPolicy.RETAIN
      : cdk.RemovalPolicy.DESTROY;

    // ── racephotos-events ─────────────────────────────────────────────────────
    // PK: id (photographer creates event; event ID is the partition key)
    // GSI photographerId-createdAt-index: list events by photographer in date order
    // GSI status-createdAt-index: list events by processing status (future: moderation)
    this.eventsTable = new dynamodb.Table(this, 'EventsTable', {
      tableName: 'racephotos-events',
      partitionKey: { name: 'id', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy,
    });

    this.eventsTable.addGlobalSecondaryIndex({
      indexName: 'photographerId-createdAt-index',
      partitionKey: { name: 'photographerId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'createdAt', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    this.eventsTable.addGlobalSecondaryIndex({
      indexName: 'status-createdAt-index',
      partitionKey: { name: 'status', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'createdAt', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // ── racephotos-photos ─────────────────────────────────────────────────────
    // PK: id (photo ID, UUID assigned at upload time)
    // GSI eventId-uploadedAt-index: list photos for an event in upload order
    this.photosTable = new dynamodb.Table(this, 'PhotosTable', {
      tableName: 'racephotos-photos',
      partitionKey: { name: 'id', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy,
    });

    this.photosTable.addGlobalSecondaryIndex({
      indexName: 'eventId-uploadedAt-index',
      partitionKey: { name: 'eventId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'uploadedAt', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // ── racephotos-bib-index ──────────────────────────────────────────────────
    // Separate fan-out table for multi-bib lookup (ADR-0003).
    // DynamoDB does not support CONTAINS on a GSI partition key, so a photo
    // with bibs [101, 102] writes two items: {bibKey: "{eventId}#101", photoId} and
    // {bibKey: "{eventId}#102", photoId}.
    // PK: bibKey (format: "{eventId}#{bibNumber}")
    // SK: photoId — supports multiple photos per bib, and retag cleanup via batch delete
    // GSI photoId-index: reverse lookup — find all bibs for a photo (retag use case)
    this.bibIndexTable = new dynamodb.Table(this, 'BibIndexTable', {
      tableName: 'racephotos-bib-index',
      partitionKey: { name: 'bibKey', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'photoId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy,
    });

    this.bibIndexTable.addGlobalSecondaryIndex({
      indexName: 'photoId-index',
      partitionKey: { name: 'photoId', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // ── racephotos-purchases ──────────────────────────────────────────────────
    // PK: id (system-generated purchase UUID)
    // GSI photoId-claimedAt-index         : list all purchase claims for a photo
    // GSI runnerEmail-claimedAt-index      : runner purchase history
    // GSI downloadToken-index              : token-based download URL lookup
    // GSI photoId-runnerEmail-index        : idempotency check in create-purchase
    // GSI photographerId-claimedAt-index   : photographer approval queue (list-purchases-for-approval)
    this.purchasesTable = new dynamodb.Table(this, 'PurchasesTable', {
      tableName: 'racephotos-purchases',
      partitionKey: { name: 'id', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy,
    });

    this.purchasesTable.addGlobalSecondaryIndex({
      indexName: 'photoId-claimedAt-index',
      partitionKey: { name: 'photoId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'claimedAt', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    this.purchasesTable.addGlobalSecondaryIndex({
      indexName: 'runnerEmail-claimedAt-index',
      partitionKey: { name: 'runnerEmail', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'claimedAt', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    this.purchasesTable.addGlobalSecondaryIndex({
      indexName: 'downloadToken-index',
      partitionKey: { name: 'downloadToken', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    this.purchasesTable.addGlobalSecondaryIndex({
      indexName: 'photoId-runnerEmail-index',
      partitionKey: { name: 'photoId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'runnerEmail', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    this.purchasesTable.addGlobalSecondaryIndex({
      indexName: 'photographerId-claimedAt-index',
      partitionKey: { name: 'photographerId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'claimedAt', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // ── racephotos-photographers ──────────────────────────────────────────────
    // PK: id (Cognito sub for the photographer)
    // Simple key-value profile store — no secondary access patterns needed at v1.
    this.photographersTable = new dynamodb.Table(this, 'PhotographersTable', {
      tableName: 'racephotos-photographers',
      partitionKey: { name: 'id', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy,
    });

    // ── racephotos-rate-limits ────────────────────────────────────────────────
    // PK: rateLimitKey (format: "REDOWNLOAD#{email}")
    // TTL attribute: expiresAt — DynamoDB auto-deletes expired tokens, so the
    // redownload-resend Lambda never needs to clean up.
    this.rateLimitsTable = new dynamodb.Table(this, 'RateLimitsTable', {
      tableName: 'racephotos-rate-limits',
      partitionKey: { name: 'rateLimitKey', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy,
      timeToLiveAttribute: 'expiresAt',
    });
  }
}
