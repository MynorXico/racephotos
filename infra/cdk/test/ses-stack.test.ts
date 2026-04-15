import * as cdk from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';
import { Template, Match } from 'aws-cdk-lib/assertions';
import { SesStack } from '../stacks/ses-stack';
import { SesConstruct } from '../constructs/ses-construct';
import { EnvConfig } from '../config/types';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const devConfig: EnvConfig = {
  envName: 'dev',
  account: '000000000000',
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
  enableDeletionProtection: true,
    sqsMaxConcurrency: 50,
};

// SES from-address is loaded from SSM at deploy time via a CloudFormation
// dynamic reference ({{resolve:ssm:...}}). No CDK context injection is needed —
// the token is resolved by CloudFormation during stack deployment, not at synth.
function makeStack(config: EnvConfig): SesStack {
  const app = new cdk.App();
  return new SesStack(app, 'TestSesStack', {
    config,
    env: { account: config.account, region: config.region },
  });
}

function makeTemplate(config: EnvConfig): Template {
  return Template.fromStack(makeStack(config));
}

// ── AC1 — SES email identity ──────────────────────────────────────────────────

describe('SesConstruct — email identity (AC1)', () => {
  test('creates exactly one SES email identity', () => {
    const t = makeTemplate(devConfig);
    t.resourceCountIs('AWS::SES::EmailIdentity', 1);
  });

  // sesFromAddress uses valueForStringParameter — CDK emits exactly one
  // AWS::SSM::Parameter::Value<String> CloudFormation parameter whose Default
  // is the SSM path, resolved by CloudFormation at deploy time. The
  // EmailIdentity resource must Ref that specific parameter (not a hardcoded
  // string and not the BootstrapVersion parameter also present in the stack).
  test('email identity is backed by exactly one SSM parameter for the correct dev path', () => {
    const t = makeTemplate(devConfig);
    const params = t.findParameters('*', {
      Type: 'AWS::SSM::Parameter::Value<String>',
      Default: '/racephotos/env/dev/ses-from-address',
    });
    const paramNames = Object.keys(params);
    expect(paramNames).toHaveLength(1);
    t.hasResourceProperties('AWS::SES::EmailIdentity', {
      EmailIdentity: { Ref: paramNames[0] },
    });
  });

  test('email identity SSM parameter path uses prod envName for prod config', () => {
    const t = makeTemplate(prodConfig);
    const params = t.findParameters('*', {
      Type: 'AWS::SSM::Parameter::Value<String>',
      Default: '/racephotos/env/prod/ses-from-address',
    });
    const paramNames = Object.keys(params);
    expect(paramNames).toHaveLength(1);
    t.hasResourceProperties('AWS::SES::EmailIdentity', {
      EmailIdentity: { Ref: paramNames[0] },
    });
  });
});

// ── AC2 — Four SES email templates ────────────────────────────────────────────

describe('SesConstruct — email templates (AC2)', () => {
  test('creates exactly four email templates', () => {
    const t = makeTemplate(devConfig);
    t.resourceCountIs('AWS::SES::Template', 4);
  });

  test.each([
    'racephotos-photographer-claim',
    'racephotos-runner-claim-confirmation',
    'racephotos-runner-purchase-approved',
    'racephotos-runner-redownload-resend',
  ])('creates template named %s', (templateName) => {
    const t = makeTemplate(devConfig);
    t.hasResourceProperties('AWS::SES::Template', {
      Template: Match.objectLike({ TemplateName: templateName }),
    });
  });

  test('every template has a SubjectPart', () => {
    const t = makeTemplate(devConfig);
    const resources = t.findResources('AWS::SES::Template');
    for (const resource of Object.values(resources)) {
      const tmpl = (resource as Record<string, Record<string, Record<string, string>>>)[
        'Properties'
      ]['Template'];
      expect(tmpl['SubjectPart']).toBeTruthy();
    }
  });

  // Story: "Plain text alternative required for all templates."
  test('every template has a TextPart (plain text fallback)', () => {
    const t = makeTemplate(devConfig);
    const resources = t.findResources('AWS::SES::Template');
    for (const resource of Object.values(resources)) {
      const tmpl = (resource as Record<string, Record<string, Record<string, string>>>)[
        'Properties'
      ]['Template'];
      expect(tmpl['TextPart']).toBeTruthy();
    }
  });

  test('photographer-claim template references runner email mask variable', () => {
    const t = makeTemplate(devConfig);
    t.hasResourceProperties('AWS::SES::Template', {
      Template: Match.objectLike({
        TemplateName: 'racephotos-photographer-claim',
        HtmlPart: Match.stringLikeRegexp('runnerEmailMasked'),
      }),
    });
  });

  test('runner-purchase-approved template includes downloadUrl variable', () => {
    const t = makeTemplate(devConfig);
    t.hasResourceProperties('AWS::SES::Template', {
      Template: Match.objectLike({
        TemplateName: 'racephotos-runner-purchase-approved',
        HtmlPart: Match.stringLikeRegexp('downloadUrl'),
      }),
    });
  });

  test('runner-claim-confirmation template includes paymentReference variable', () => {
    const t = makeTemplate(devConfig);
    t.hasResourceProperties('AWS::SES::Template', {
      Template: Match.objectLike({
        TemplateName: 'racephotos-runner-claim-confirmation',
        HtmlPart: Match.stringLikeRegexp('paymentReference'),
      }),
    });
  });

  test('runner-redownload-resend template uses Handlebars each iteration over downloads array', () => {
    const t = makeTemplate(devConfig);
    t.hasResourceProperties('AWS::SES::Template', {
      Template: Match.objectLike({
        TemplateName: 'racephotos-runner-redownload-resend',
        HtmlPart: Match.stringLikeRegexp('#each downloads'),
      }),
    });
  });

  test('runner-redownload-resend template includes url and eventName variables inside each block', () => {
    const t = makeTemplate(devConfig);
    t.hasResourceProperties('AWS::SES::Template', {
      Template: Match.objectLike({
        TemplateName: 'racephotos-runner-redownload-resend',
        HtmlPart: Match.stringLikeRegexp('\\{\\{url\\}\\}'),
      }),
    });
    t.hasResourceProperties('AWS::SES::Template', {
      Template: Match.objectLike({
        TemplateName: 'racephotos-runner-redownload-resend',
        HtmlPart: Match.stringLikeRegexp('\\{\\{eventName\\}\\}'),
      }),
    });
  });
});

// ── AC3 — grantSendEmail ──────────────────────────────────────────────────────

describe('SesConstruct — grantSendEmail (AC3)', () => {
  test('grantSendEmail grants ses:SendEmail and ses:SendTemplatedEmail on identity ARN', () => {
    const app = new cdk.App();
    const stack = new SesStack(app, 'TestSesStack', {
      config: devConfig,
      env: { account: devConfig.account, region: devConfig.region },
    });
    const role = new iam.Role(stack, 'TestRole', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
    });

    stack.ses.grantSendEmail(role);

    const t = Template.fromStack(stack);
    t.hasResourceProperties('AWS::IAM::Policy', {
      PolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({
            Action: Match.arrayWith(['ses:SendEmail', 'ses:SendTemplatedEmail']),
            Effect: 'Allow',
          }),
        ]),
      },
    });
  });

  test('grantSendEmail does NOT grant ses:SendRawEmail (not required by this service)', () => {
    const app = new cdk.App();
    const stack = new SesStack(app, 'TestSesStack', {
      config: devConfig,
      env: { account: devConfig.account, region: devConfig.region },
    });
    const role = new iam.Role(stack, 'TestRole', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
    });

    stack.ses.grantSendEmail(role);

    const t = Template.fromStack(stack);
    const policies = t.findResources('AWS::IAM::Policy');
    for (const policy of Object.values(policies)) {
      const statements = (policy as Record<string, Record<string, Record<string, unknown[]>>>)[
        'Properties'
      ]['PolicyDocument']['Statement'];
      for (const stmt of statements as Record<string, unknown[]>[]) {
        const actions = stmt['Action'] as string[];
        if (Array.isArray(actions)) {
          expect(actions).not.toContain('ses:SendRawEmail');
        }
      }
    }
  });

  test('grantSendEmail scopes grant to the email identity ARN, not wildcard', () => {
    const app = new cdk.App();
    const stack = new SesStack(app, 'TestSesStack', {
      config: devConfig,
      env: { account: devConfig.account, region: devConfig.region },
    });
    const role = new iam.Role(stack, 'TestRole', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
    });

    stack.ses.grantSendEmail(role);

    const t = Template.fromStack(stack);
    const policies = t.findResources('AWS::IAM::Policy');
    let foundSesPolicy = false;
    for (const policy of Object.values(policies)) {
      const statements = (policy as Record<string, Record<string, Record<string, unknown[]>>>)[
        'Properties'
      ]['PolicyDocument']['Statement'];
      for (const stmt of statements as Record<string, unknown[]>[]) {
        const actions = stmt['Action'] as string | string[];
        const actionsArr = Array.isArray(actions) ? actions : [actions];
        if (actionsArr.includes('ses:SendEmail')) {
          foundSesPolicy = true;
          // Resource must not be wildcard
          const resource = stmt['Resource'];
          expect(resource).not.toBe('*');
        }
      }
    }
    expect(foundSesPolicy).toBe(true);
  });

  test('grantSendEmail includes all four template ARNs (ses:SendTemplatedEmail requires template resource grant)', () => {
    // Regression test: ses:SendTemplatedEmail requires an IAM grant on the template
    // resource ARN in addition to the sender identity. Missing template ARNs causes
    // AccessDenied on SendTemplatedEmail even when the identity grant is correct.
    const app = new cdk.App();
    const stack = new SesStack(app, 'TestSesStack', {
      config: devConfig,
      env: { account: devConfig.account, region: devConfig.region },
    });
    const role = new iam.Role(stack, 'TestRole', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
    });

    stack.ses.grantSendEmail(role);

    const t = Template.fromStack(stack);
    const policies = t.findResources('AWS::IAM::Policy');

    // Collect all resource strings from SES statements (some are Fn::Join objects
    // at synth time, so serialize the whole statement to locate template names).
    const sesResourceJson = JSON.stringify(
      Object.values(policies).flatMap(policy => {
        const stmts = (policy as Record<string, Record<string, Record<string, unknown[]>>>)[
          'Properties'
        ]['PolicyDocument']['Statement'] as Record<string, unknown>[];
        return stmts.filter(stmt => {
          const actions = stmt['Action'] as string | string[];
          const arr = Array.isArray(actions) ? actions : [actions];
          return arr.includes('ses:SendTemplatedEmail');
        });
      }),
    );

    const expectedTemplates = Object.values(SesConstruct.TEMPLATES);

    for (const templateName of expectedTemplates) {
      expect(sesResourceJson).toContain(`template/${templateName}`);
    }
  });
});
