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
 *   racephotos-orders        — purchase orders (ADR-0010); GSIs for runner history, photographer queue, paymentRef
 *   racephotos-purchases     — purchase line items; GSIs for idempotency and download
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
  readonly ordersTable: dynamodb.Table;
  readonly purchasesTable: dynamodb.Table;
  readonly photographersTable: dynamodb.Table;
  readonly rateLimitsTable: dynamodb.Table;

  constructor(scope: Construct, id: string, props: DatabaseConstructProps) {
    super(scope, id);

    const { config } = props;

    const removalPolicy = config.enableDeletionProtection
      ? cdk.RemovalPolicy.RETAIN
      : cdk.RemovalPolicy.DESTROY;

    // All tables use AWS_MANAGED encryption (AES-256 with an AWS-managed CMK).
    // This gives a CloudTrail key-usage audit trail and a key-rotation path without
    // the operational overhead of customer-managed KMS keys at v1.
    // Upgrade to CUSTOMER_MANAGED for staging/prod when compliance requires it.
    const encryption = dynamodb.TableEncryption.AWS_MANAGED;

    // ── racephotos-events ─────────────────────────────────────────────────────
    // PK: id (photographer creates event; event ID is the partition key)
    // GSI photographerId-createdAt-index: list events by photographer in date order
    // GSI status-createdAt-index: list events by processing status (future: moderation)
    //
    // NOTE — status-createdAt-index hot-partition concern (raised in security review):
    // `status` is a low-cardinality field (e.g. "active", "draft", "closed"). At large
    // scale all active events share one GSI partition. This GSI is reserved for a future
    // platform-level moderation feature; it is NOT used by any v1 Lambda. Before any
    // Lambda queries this GSI, evaluate whether a sharded PK (e.g. "active#0"…"active#7")
    // or a sparse GSI approach is more appropriate for the query volume at that time.
    this.eventsTable = new dynamodb.Table(this, 'EventsTable', {
      tableName: 'racephotos-events',
      partitionKey: { name: 'id', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      encryption,
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
      encryption,
      removalPolicy,
    });

    this.photosTable.addGlobalSecondaryIndex({
      indexName: 'eventId-uploadedAt-index',
      partitionKey: { name: 'eventId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'uploadedAt', type: dynamodb.AttributeType.STRING },
      // ALL projection — DynamoDB does not allow changing a GSI's projection type
      // in-place (CloudFormation rejects the update). The INCLUDE optimisation
      // (status, watermarkedS3Key, bibNumbers, errorReason only) can be applied in
      // a future story by deleting this GSI and recreating it under a new name in a
      // two-step migration. Using ALL is correct and the existing GSI in dev already
      // has this projection type.
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
      encryption,
      removalPolicy,
    });

    // KEYS_ONLY: the retag cleanup path only needs bibKey (base PK, always projected)
    // to issue DeleteItem calls. ALL projection would double write cost on the
    // highest-throughput table (up to 10,000 writes per event burst).
    this.bibIndexTable.addGlobalSecondaryIndex({
      indexName: 'photoId-index',
      partitionKey: { name: 'photoId', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.KEYS_ONLY,
    });

    // ── racephotos-orders ─────────────────────────────────────────────────────
    // Primary purchase grouping entity (ADR-0010). One Order per bank transfer;
    // each photo becomes a Purchase line item linked by orderId.
    // PK: id (system-generated order UUID)
    // GSI runnerEmail-claimedAt-index    : runner order history
    // GSI photographerId-claimedAt-index : photographer approval queue
    // GSI paymentRef-index               : lookup by payment reference
    this.ordersTable = new dynamodb.Table(this, 'OrdersTable', {
      tableName: 'racephotos-orders',
      partitionKey: { name: 'id', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      encryption,
      removalPolicy,
    });

    this.ordersTable.addGlobalSecondaryIndex({
      indexName: 'runnerEmail-claimedAt-index',
      partitionKey: { name: 'runnerEmail', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'claimedAt', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    this.ordersTable.addGlobalSecondaryIndex({
      indexName: 'photographerId-claimedAt-index',
      partitionKey: { name: 'photographerId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'claimedAt', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // KEYS_ONLY: paymentRef lookup only needs the order id to resolve the record —
    // a GetItem on the base table fetches the full Order.
    this.ordersTable.addGlobalSecondaryIndex({
      indexName: 'paymentRef-index',
      partitionKey: { name: 'paymentRef', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.KEYS_ONLY,
    });

    // ── racephotos-purchases ──────────────────────────────────────────────────
    // Purchase line items linked to an Order via orderId (ADR-0010).
    // PK: id (system-generated purchase UUID)
    // GSI photoId-claimedAt-index    : list all purchase claims for a photo
    // GSI runnerEmail-claimedAt-index : runner purchase history (by line item)
    // GSI downloadToken-index         : token-based download URL lookup
    // GSI photoId-runnerEmail-index   : idempotency check in create-order
    //
    // Note: photographerId-claimedAt-index previously on this table is superseded
    // by the same GSI on racephotos-orders (ADR-0010, RS-010).
    this.purchasesTable = new dynamodb.Table(this, 'PurchasesTable', {
      tableName: 'racephotos-purchases',
      partitionKey: { name: 'id', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      encryption,
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

    // KEYS_ONLY: idempotency check in create-order only needs to resolve the
    // purchase id — it never reads attributes from this GSI projection.
    this.purchasesTable.addGlobalSecondaryIndex({
      indexName: 'photoId-runnerEmail-index',
      partitionKey: { name: 'photoId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'runnerEmail', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.KEYS_ONLY,
    });

    // ── racephotos-photographers ──────────────────────────────────────────────
    // PK: id (Cognito sub for the photographer)
    // Simple key-value profile store — no secondary access patterns needed at v1.
    this.photographersTable = new dynamodb.Table(this, 'PhotographersTable', {
      tableName: 'racephotos-photographers',
      partitionKey: { name: 'id', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      encryption,
      removalPolicy,
    });

    // ── racephotos-rate-limits ────────────────────────────────────────────────
    // PK: rateLimitKey (format: "REDOWNLOAD#{email}")
    // TTL attribute: expiresAt — DynamoDB auto-deletes expired tokens, so the
    // redownload-resend Lambda never needs to clean up.
    // AWS_MANAGED encryption is particularly important here: rateLimitKey embeds
    // runner email addresses as the partition key.
    this.rateLimitsTable = new dynamodb.Table(this, 'RateLimitsTable', {
      tableName: 'racephotos-rate-limits',
      partitionKey: { name: 'rateLimitKey', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      encryption,
      removalPolicy,
      timeToLiveAttribute: 'expiresAt',
    });
  }
}
