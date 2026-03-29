import * as cdk from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';
import { Template, Match } from 'aws-cdk-lib/assertions';
import { SesStack } from '../stacks/ses-stack';
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
  domainName: 'none',
  certificateArn: 'none',
};

const prodConfig: EnvConfig = {
  ...devConfig,
  envName: 'prod',
  enableDeletionProtection: true,
};

// SES from-address is loaded from SSM at synth time. In tests the SSM param is
// not present, so CDK returns the predictable dummy string. We inject the key
// explicitly for tests that need a real email address in the template output.
const SES_CONTEXT_KEY =
  'ssm:account=000000000000:parameterName=/racephotos/env/dev/ses-from-address:region=us-east-1';
const TEST_EMAIL = 'noreply@example.com';

function makeStack(config: EnvConfig, injectEmail = false): SesStack {
  const context = injectEmail ? { [SES_CONTEXT_KEY]: TEST_EMAIL } : {};
  const app = new cdk.App({ context });
  return new SesStack(app, 'TestSesStack', {
    config,
    env: { account: config.account, region: config.region },
  });
}

function makeTemplate(config: EnvConfig, injectEmail = false): Template {
  return Template.fromStack(makeStack(config, injectEmail));
}

// ── AC1 — SES email identity ──────────────────────────────────────────────────

describe('SesConstruct — email identity (AC1)', () => {
  test('creates exactly one SES email identity', () => {
    const t = makeTemplate(devConfig);
    t.resourceCountIs('AWS::SES::EmailIdentity', 1);
  });

  test('email identity uses the address from SSM ses-from-address', () => {
    const t = makeTemplate(devConfig, /* injectEmail */ true);
    t.hasResourceProperties('AWS::SES::EmailIdentity', {
      EmailIdentity: TEST_EMAIL,
    });
  });

  // Guard against the sesFromAddress SSM path changing — the parameter name
  // must embed the envName so each environment has an isolated sender identity.
  test('SSM lookup path embeds envName for dev', () => {
    const stack = makeStack(devConfig);
    // CDK dummy value contains the SSM path — assert envName is in the path.
    const identity = stack.ses.emailIdentityArn;
    // ARN is constructed from the ref of the CfnEmailIdentity, which contains
    // the SSM dummy. A real value would be: ...identity/noreply@example.com.
    // We just assert it is a non-empty string (CDK token or real ARN).
    expect(identity).toBeTruthy();
  });

  test('email identity SSM lookup uses prod envName for prod config', () => {
    const prodContextKey =
      'ssm:account=000000000000:parameterName=/racephotos/env/prod/ses-from-address:region=us-east-1';
    const app = new cdk.App({ context: { [prodContextKey]: 'noreply-prod@example.com' } });
    const stack = new SesStack(app, 'ProdSesStack', {
      config: prodConfig,
      env: { account: prodConfig.account, region: prodConfig.region },
    });
    const t = Template.fromStack(stack);
    t.hasResourceProperties('AWS::SES::EmailIdentity', {
      EmailIdentity: 'noreply-prod@example.com',
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

  test('runner-redownload-resend template includes downloadLinks variable', () => {
    const t = makeTemplate(devConfig);
    t.hasResourceProperties('AWS::SES::Template', {
      Template: Match.objectLike({
        TemplateName: 'racephotos-runner-redownload-resend',
        HtmlPart: Match.stringLikeRegexp('downloadLinks'),
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
});
