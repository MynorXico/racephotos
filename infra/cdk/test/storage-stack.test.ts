import * as cdk from 'aws-cdk-lib';
import { Template, Match } from 'aws-cdk-lib/assertions';
import { StorageStack } from '../stacks/storage-stack';
import { EnvConfig } from '../config/types';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const devConfig: EnvConfig = {
  envName: 'dev',
  account: '123456789012',
  region: 'us-east-1',
  rekognitionConfidenceThreshold: 0.7,
  watermarkStyle: 'text_overlay',
  photoRetentionDays: 90,
  enableDeletionProtection: false,
  domainName: 'none',
  certificateArn: 'none',
};

const prodConfig: EnvConfig = {
  ...devConfig,
  envName: 'prod',
  photoRetentionDays: 365,
  enableDeletionProtection: true,
};

function makeTemplate(config: EnvConfig): Template {
  const app = new cdk.App();
  const stack = new StorageStack(app, 'TestStorageStack', { config });
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

  test('both buckets have lifecycle rule expiring objects after photoRetentionDays', () => {
    const t = makeTemplate(devConfig);
    // photoRetentionDays = 90 for devConfig
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
    t.hasResourceProperties('AWS::S3::Bucket', {
      BucketName: 'racephotos-processed-dev',
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
        Match.objectLike({ IndexName: 'photoId-runnerEmail-index' }),
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

  test('racephotos-processing queue has 5-minute visibility timeout', () => {
    const t = makeTemplate(devConfig);
    t.hasResourceProperties('AWS::SQS::Queue', {
      QueueName: 'racephotos-processing',
      VisibilityTimeout: 300,
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
});
