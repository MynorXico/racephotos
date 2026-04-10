import * as cdk from 'aws-cdk-lib';
import { Template, Match } from 'aws-cdk-lib/assertions';
import { StorageStack } from '../stacks/storage-stack';
import { EnvConfig } from '../config/types';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const devConfig: EnvConfig = {
  envName: 'dev',
  account: '000000000000', // LocalStack canonical placeholder — not a real AWS account ID
  region: 'us-east-1',
  rekognitionConfidenceThreshold: 0.7,
  watermarkStyle: 'text_overlay',
  photoRetentionDays: 90,
  enableDeletionProtection: false,
    sqsMaxConcurrency: 3,
  domainName: 'none',
  certificateArn: 'none',
};

const prodConfig: EnvConfig = {
  ...devConfig,
  envName: 'prod',
  photoRetentionDays: 365,
  enableDeletionProtection: true,
    sqsMaxConcurrency: 50,
};

function makeTemplate(config: EnvConfig): Template {
  const app = new cdk.App();
  const stack = new StorageStack(app, 'TestStorageStack', {
    config,
    env: { account: config.account, region: config.region },
  });
  return Template.fromStack(stack);
}

// ── PhotoStorageConstruct ─────────────────────────────────────────────────────

describe('PhotoStorageConstruct', () => {
  test('creates raw and processed S3 buckets with envName suffix', () => {
    const t = makeTemplate(devConfig);
    t.hasResourceProperties('AWS::S3::Bucket', {
      BucketName: 'racephotos-raw-dev',
    });
    t.hasResourceProperties('AWS::S3::Bucket', {
      BucketName: 'racephotos-processed-dev',
    });
  });

  test('both buckets block all public access', () => {
    const t = makeTemplate(devConfig);
    // There must be at least 2 buckets with full public-access blocking
    const resources = t.findResources('AWS::S3::Bucket', {
      Properties: {
        PublicAccessBlockConfiguration: {
          BlockPublicAcls: true,
          BlockPublicPolicy: true,
          IgnorePublicAcls: true,
          RestrictPublicBuckets: true,
        },
      },
    });
    // raw + processed = 2 (website bucket is in FrontendStack, not here)
    expect(Object.keys(resources).length).toBeGreaterThanOrEqual(2);
  });

  test('raw bucket has lifecycle rule expiring originals after photoRetentionDays', () => {
    const t = makeTemplate(devConfig);
    t.hasResourceProperties('AWS::S3::Bucket', {
      BucketName: 'racephotos-raw-dev',
      LifecycleConfiguration: {
        Rules: Match.arrayWith([
          Match.objectLike({
            ExpirationInDays: 90,
            Status: 'Enabled',
          }),
        ]),
      },
    });
  });

  test('processed bucket has NO expiry lifecycle rule (watermarked copies must outlive runner purchases)', () => {
    const t = makeTemplate(devConfig);
    const processed = t.findResources('AWS::S3::Bucket', {
      Properties: { BucketName: 'racephotos-processed-dev' },
    });
    const [resource] = Object.values(processed);
    const props = (resource as Record<string, Record<string, unknown>>)['Properties'];
    // LifecycleConfiguration must be absent or have no expiry rules
    expect(props['LifecycleConfiguration']).toBeUndefined();
  });

  test('buckets have DESTROY removal policy when enableDeletionProtection is false', () => {
    const t = makeTemplate(devConfig);
    // CDK emits DeletionPolicy: Delete for DESTROY
    const buckets = t.findResources('AWS::S3::Bucket', {
      Properties: {
        BucketName: Match.stringLikeRegexp('racephotos-(raw|processed)-dev'),
      },
    });
    for (const [, resource] of Object.entries(buckets)) {
      expect((resource as Record<string, unknown>)['DeletionPolicy']).toBe('Delete');
    }
  });

  test('buckets have RETAIN removal policy when enableDeletionProtection is true', () => {
    const t = makeTemplate(prodConfig);
    const buckets = t.findResources('AWS::S3::Bucket', {
      Properties: {
        BucketName: Match.stringLikeRegexp('racephotos-(raw|processed)-prod'),
      },
    });
    for (const [, resource] of Object.entries(buckets)) {
      expect((resource as Record<string, unknown>)['DeletionPolicy']).toBe('Retain');
    }
  });

  test('creates a CloudFront distribution in front of the processed bucket', () => {
    const t = makeTemplate(devConfig);
    t.resourceCountIs('AWS::CloudFront::Distribution', 1);
  });

  test('distribution domain name is emitted as a CloudFormation output', () => {
    const t = makeTemplate(devConfig);
    const outputs = t.findOutputs('*', {
      Description: Match.stringLikeRegexp('CloudFront CDN domain.*processed photos'),
    });
    expect(Object.keys(outputs).length).toBe(1);
  });

  test('raw bucket has CORS rule allowing PUT for presigned uploads', () => {
    const t = makeTemplate(devConfig);
    // devConfig has no custom domain and SSM returns a dummy → only localhost:4200
    // is present (no wildcard fallback).
    t.hasResourceProperties('AWS::S3::Bucket', {
      BucketName: 'racephotos-raw-dev',
      CorsConfiguration: {
        CorsRules: [
          Match.objectLike({
            AllowedOrigins: ['http://localhost:4200'],
            AllowedMethods: ['PUT'],
            AllowedHeaders: ['*'],
          }),
        ],
      },
    });
  });

  test('raw bucket CORS allows custom domain origin for prod', () => {
    const prodWithDomain: EnvConfig = {
      ...prodConfig,
      domainName: 'app.example.com',
      certificateArn: 'arn:aws:acm:us-east-1:000000000000:certificate/abc',
    };
    const t = makeTemplate(prodWithDomain);
    t.hasResourceProperties('AWS::S3::Bucket', {
      BucketName: 'racephotos-raw-prod',
      CorsConfiguration: {
        CorsRules: [
          Match.objectLike({
            AllowedOrigins: ['https://app.example.com'],
            AllowedMethods: ['PUT'],
          }),
        ],
      },
    });
  });
});

// ── DatabaseConstruct ─────────────────────────────────────────────────────────

describe('DatabaseConstruct', () => {
  test('creates exactly six DynamoDB tables', () => {
    const t = makeTemplate(devConfig);
    t.resourceCountIs('AWS::DynamoDB::Table', 6);
  });

  test('all tables use PAY_PER_REQUEST billing', () => {
    const t = makeTemplate(devConfig);
    const tables = t.findResources('AWS::DynamoDB::Table');
    for (const [, resource] of Object.entries(tables)) {
      const props = (resource as Record<string, Record<string, unknown>>)['Properties'];
      expect(props['BillingMode']).toBe('PAY_PER_REQUEST');
    }
  });

  test('racephotos-events table has correct PK and two GSIs', () => {
    const t = makeTemplate(devConfig);
    t.hasResourceProperties('AWS::DynamoDB::Table', {
      TableName: 'racephotos-events',
      KeySchema: [{ AttributeName: 'id', KeyType: 'HASH' }],
      GlobalSecondaryIndexes: Match.arrayWith([
        Match.objectLike({ IndexName: 'photographerId-createdAt-index' }),
        Match.objectLike({ IndexName: 'status-createdAt-index' }),
      ]),
    });
  });

  test('racephotos-photos table has correct PK and eventId GSI', () => {
    const t = makeTemplate(devConfig);
    t.hasResourceProperties('AWS::DynamoDB::Table', {
      TableName: 'racephotos-photos',
      KeySchema: [{ AttributeName: 'id', KeyType: 'HASH' }],
      GlobalSecondaryIndexes: Match.arrayWith([
        Match.objectLike({ IndexName: 'eventId-uploadedAt-index' }),
      ]),
    });
  });

  test('racephotos-bib-index table has PK + SK and photoId GSI', () => {
    const t = makeTemplate(devConfig);
    t.hasResourceProperties('AWS::DynamoDB::Table', {
      TableName: 'racephotos-bib-index',
      KeySchema: [
        { AttributeName: 'bibKey', KeyType: 'HASH' },
        { AttributeName: 'photoId', KeyType: 'RANGE' },
      ],
      GlobalSecondaryIndexes: Match.arrayWith([Match.objectLike({ IndexName: 'photoId-index' })]),
    });
  });

  test('racephotos-purchases table has correct PK and five GSIs', () => {
    const t = makeTemplate(devConfig);
    t.hasResourceProperties('AWS::DynamoDB::Table', {
      TableName: 'racephotos-purchases',
      KeySchema: [{ AttributeName: 'id', KeyType: 'HASH' }],
      GlobalSecondaryIndexes: Match.arrayWith([
        Match.objectLike({ IndexName: 'photoId-claimedAt-index' }),
        Match.objectLike({ IndexName: 'runnerEmail-claimedAt-index' }),
        Match.objectLike({ IndexName: 'downloadToken-index' }),
        Match.objectLike({
          IndexName: 'photoId-runnerEmail-index',
          Projection: Match.objectLike({ ProjectionType: 'KEYS_ONLY' }),
        }),
        Match.objectLike({ IndexName: 'photographerId-claimedAt-index' }),
      ]),
    });
  });

  test('racephotos-photographers table has simple PK', () => {
    const t = makeTemplate(devConfig);
    t.hasResourceProperties('AWS::DynamoDB::Table', {
      TableName: 'racephotos-photographers',
      KeySchema: [{ AttributeName: 'id', KeyType: 'HASH' }],
    });
  });

  test('racephotos-rate-limits table has PK and TTL enabled', () => {
    const t = makeTemplate(devConfig);
    t.hasResourceProperties('AWS::DynamoDB::Table', {
      TableName: 'racephotos-rate-limits',
      KeySchema: [{ AttributeName: 'rateLimitKey', KeyType: 'HASH' }],
      TimeToLiveSpecification: {
        AttributeName: 'expiresAt',
        Enabled: true,
      },
    });
  });

  test('tables use DESTROY removal policy when enableDeletionProtection is false', () => {
    const t = makeTemplate(devConfig);
    const tables = t.findResources('AWS::DynamoDB::Table');
    for (const [, resource] of Object.entries(tables)) {
      expect((resource as Record<string, unknown>)['DeletionPolicy']).toBe('Delete');
    }
  });

  test('tables use RETAIN removal policy when enableDeletionProtection is true', () => {
    const t = makeTemplate(prodConfig);
    const tables = t.findResources('AWS::DynamoDB::Table');
    for (const [, resource] of Object.entries(tables)) {
      expect((resource as Record<string, unknown>)['DeletionPolicy']).toBe('Retain');
    }
  });
});

// ── ProcessingPipelineConstruct ───────────────────────────────────────────────

describe('ProcessingPipelineConstruct', () => {
  test('creates four SQS queues (2 main + 2 DLQs)', () => {
    const t = makeTemplate(devConfig);
    t.resourceCountIs('AWS::SQS::Queue', 4);
  });

  test('racephotos-processing queue has 6-minute visibility timeout', () => {
    const t = makeTemplate(devConfig);
    t.hasResourceProperties('AWS::SQS::Queue', {
      QueueName: 'racephotos-processing',
      VisibilityTimeout: 360,
    });
  });

  test('racephotos-watermark queue is created', () => {
    const t = makeTemplate(devConfig);
    t.hasResourceProperties('AWS::SQS::Queue', {
      QueueName: 'racephotos-watermark',
    });
  });

  test('racephotos-processing-dlq is created', () => {
    const t = makeTemplate(devConfig);
    t.hasResourceProperties('AWS::SQS::Queue', {
      QueueName: 'racephotos-processing-dlq',
    });
  });

  test('racephotos-watermark-dlq is created', () => {
    const t = makeTemplate(devConfig);
    t.hasResourceProperties('AWS::SQS::Queue', {
      QueueName: 'racephotos-watermark-dlq',
    });
  });

  test('processing queue has redrive policy with maxReceiveCount 3', () => {
    const t = makeTemplate(devConfig);
    t.hasResourceProperties('AWS::SQS::Queue', {
      QueueName: 'racephotos-processing',
      RedrivePolicy: Match.objectLike({
        maxReceiveCount: 3,
      }),
    });
  });

  test('watermark queue has redrive policy with maxReceiveCount 3', () => {
    const t = makeTemplate(devConfig);
    t.hasResourceProperties('AWS::SQS::Queue', {
      QueueName: 'racephotos-watermark',
      RedrivePolicy: Match.objectLike({
        maxReceiveCount: 3,
      }),
    });
  });

  test('S3 ObjectCreated event on raw bucket sends to processing queue', () => {
    const t = makeTemplate(devConfig);
    t.hasResourceProperties('Custom::S3BucketNotifications', {
      NotificationConfiguration: Match.objectLike({
        QueueConfigurations: Match.arrayWith([
          Match.objectLike({
            Events: ['s3:ObjectCreated:*'],
          }),
        ]),
      }),
    });
  });

  test('S3 notification is attached to the raw bucket (not the processed bucket)', () => {
    const app = new cdk.App();
    const stack = new StorageStack(app, 'TestStorageStack', {
      config: devConfig,
      env: { account: devConfig.account, region: devConfig.region },
    });
    const t = Template.fromStack(stack);
    // The S3BucketNotifications custom resource references the raw bucket's logical ID.
    // Obtain both bucket logical IDs and confirm the notification references the raw one.
    const buckets = t.findResources('AWS::S3::Bucket');
    const rawBucketId = Object.entries(buckets).find(([, r]) => {
      const props = (r as Record<string, Record<string, unknown>>)['Properties'];
      return (
        typeof props['BucketName'] === 'string' && props['BucketName'].startsWith('racephotos-raw-')
      );
    })?.[0];
    expect(rawBucketId).toBeDefined();

    const notifs = t.findResources('Custom::S3BucketNotifications');
    const [notifResource] = Object.values(notifs);
    const notifProps = (notifResource as Record<string, Record<string, unknown>>)['Properties'];
    const bucketRef = JSON.stringify(notifProps['BucketName']);
    expect(bucketRef).toContain(rawBucketId);
  });

  test('watermark queue has 6-minute visibility timeout', () => {
    const t = makeTemplate(devConfig);
    t.hasResourceProperties('AWS::SQS::Queue', {
      QueueName: 'racephotos-watermark',
      VisibilityTimeout: 360,
    });
  });

  test('all four SQS queues have SQS_MANAGED server-side encryption', () => {
    const t = makeTemplate(devConfig);
    const queues = t.findResources('AWS::SQS::Queue');
    for (const [, resource] of Object.entries(queues)) {
      const props = (resource as Record<string, Record<string, unknown>>)['Properties'];
      expect(props['SqsManagedSseEnabled']).toBe(true);
    }
  });
});

// ── Security hardening ────────────────────────────────────────────────────────

describe('Security hardening', () => {
  test('both S3 buckets enforce TLS (deny HTTP requests)', () => {
    const t = makeTemplate(devConfig);
    // enforceSSL: true emits a bucket policy that denies aws:SecureTransport=false
    const policies = t.findResources('AWS::S3::BucketPolicy');
    const policyDocs = Object.values(policies).map((r) =>
      JSON.stringify(
        (r as Record<string, Record<string, unknown>>)['Properties']['PolicyDocument'],
      ),
    );
    // Both raw and processed buckets should have a deny-HTTP statement
    const denyCount = policyDocs.filter((p) => p.includes('aws:SecureTransport')).length;
    expect(denyCount).toBeGreaterThanOrEqual(2);
  });

  test('CloudFront distribution uses REDIRECT_TO_HTTPS viewer protocol policy', () => {
    const t = makeTemplate(devConfig);
    t.hasResourceProperties('AWS::CloudFront::Distribution', {
      DistributionConfig: Match.objectLike({
        DefaultCacheBehavior: Match.objectLike({
          ViewerProtocolPolicy: 'redirect-to-https',
        }),
      }),
    });
  });

  test('all DynamoDB tables have server-side encryption enabled', () => {
    const t = makeTemplate(devConfig);
    const tables = t.findResources('AWS::DynamoDB::Table');
    for (const [, resource] of Object.entries(tables)) {
      const props = (resource as Record<string, Record<string, unknown>>)['Properties'];
      // CDK TableEncryption.AWS_MANAGED emits { SSEEnabled: true } — SSEType is
      // implicit (KMS is the only supported value when SSEEnabled is true).
      expect((props['SSESpecification'] as Record<string, unknown>)?.['SSEEnabled']).toBe(true);
    }
  });

  test('prod stack has no autoDeleteObjects custom resource (RETAIN policy)', () => {
    const app = new cdk.App();
    const stack = new StorageStack(app, 'ProdStack', {
      config: prodConfig,
      env: { account: prodConfig.account, region: prodConfig.region },
    });
    const t = Template.fromStack(stack);
    // CDK emits a Custom::S3AutoDeleteObjects resource only when autoDeleteObjects=true.
    // With enableDeletionProtection=true that resource must be absent.
    const autoDeleteResources = t.findResources('Custom::S3AutoDeleteObjects');
    expect(Object.keys(autoDeleteResources).length).toBe(0);
  });
});
