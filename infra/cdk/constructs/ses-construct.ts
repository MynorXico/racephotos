import * as fs from 'fs';
import * as path from 'path';
import * as cdk from 'aws-cdk-lib';
import * as ses from 'aws-cdk-lib/aws-ses';
import * as iam from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';

interface SesConstructProps {
  /**
   * Verified SES sender email address.
   * Loaded via ssm.StringParameter.valueFromLookup in the parent stack:
   *   /racephotos/env/{envName}/ses-from-address
   *
   * NOT stored in EnvConfig — email addresses must not appear in version
   * control. SSM is the correct layer for this value.
   */
  sesFromAddress: string;
}

/**
 * SesConstruct
 *
 * Creates:
 *   - SES email identity for the verified sender (one per environment)
 *   - Four SES email templates used by payment and download Lambda stories:
 *       racephotos-photographer-claim         (ADR-0001)
 *       racephotos-runner-claim-confirmation  (ADR-0002)
 *       racephotos-runner-purchase-approved   (ADR-0002)
 *       racephotos-runner-redownload-resend   (ADR-0002)
 *
 * Template names have NO {envName} suffix — SES templates are account-scoped
 * and each environment is deployed to an isolated AWS account.
 *
 * Downstream Lambda constructs call grantSendEmail(lambdaRole) to receive
 * ses:SendEmail + ses:SendTemplatedEmail on the verified identity ARN.
 *
 * SES template variable conventions (Handlebars {{variableName}}):
 *   photographer-claim:        runnerEmailMasked, eventName, photoReference, dashboardUrl
 *   runner-claim-confirmation: eventName, photoReference, paymentReference
 *   runner-purchase-approved:  eventName, downloadUrl
 *   runner-redownload-resend:  downloads (array) — each item: { url, eventName, photoReference }
 *                             Passed as JSON array to SendTemplatedEmail TemplateData.
 *                             Use Handlebars {{#each downloads}} iteration; never pass raw HTML.
 *
 * Template HTML and plain-text sources live in ./ses-templates/ alongside this file.
 * Edit them there — the construct reads them at synth time with fs.readFileSync.
 */
export class SesConstruct extends Construct {
  /** ARN of the verified SES sender identity — used for IAM grant scoping. */
  readonly emailIdentityArn: string;

  private readonly emailIdentity: ses.EmailIdentity;

  /**
   * Account-scoped SES template names used by this service.
   * Centralised here so the constructor (template creation) and grantSendEmail
   * (IAM grant) always reference the same list — adding a template in one place
   * automatically keeps the IAM grant in sync.
   */
  static readonly TEMPLATE_NAMES = [
    'racephotos-photographer-claim',
    'racephotos-runner-claim-confirmation',
    'racephotos-runner-purchase-approved',
    'racephotos-runner-redownload-resend',
  ] as const;

  constructor(scope: Construct, id: string, props: SesConstructProps) {
    super(scope, id);

    const { sesFromAddress } = props;
    const tmplDir = path.join(__dirname, 'ses-templates');

    // ── Verified sender identity ────────────────────────────────────────────
    //
    // EmailIdentity L2 is used over CfnEmailIdentity L1 for its built-in
    // grant() helper. DKIM is enabled by default (Easy DKIM, no hosted zone
    // needed for email-only identities — AWS manages the DNS records).
    this.emailIdentity = new ses.EmailIdentity(this, 'SenderIdentity', {
      identity: ses.Identity.email(sesFromAddress),
    });

    this.emailIdentityArn = this.emailIdentity.emailIdentityArn;

    // ── Email templates ─────────────────────────────────────────────────────
    //
    // All four templates are defined here so they exist before any Lambda
    // story (RS-006, RS-011) calls ses:SendTemplatedEmail. Plain text
    // alternatives are required for all templates (RFC 1341, accessibility).
    //
    // HTML and text sources are in ./ses-templates/ — edit there for syntax
    // highlighting, linting, and preview support.

    // Template 1 — Photographer: new purchase claim (ADR-0001)
    new ses.CfnTemplate(this, 'PhotographerClaimTemplate', {
      template: {
        templateName: SesConstruct.TEMPLATE_NAMES[0],
        subjectPart: 'New purchase claim — {{eventName}}',
        htmlPart: fs.readFileSync(path.join(tmplDir, 'photographer-claim.html'), 'utf8'),
        textPart: fs.readFileSync(path.join(tmplDir, 'photographer-claim.txt'), 'utf8'),
      },
    });

    // Template 2 — Runner: claim confirmation (ADR-0002)
    new ses.CfnTemplate(this, 'RunnerClaimConfirmationTemplate', {
      template: {
        templateName: SesConstruct.TEMPLATE_NAMES[1],
        subjectPart: 'Payment claim received — {{eventName}}',
        htmlPart: fs.readFileSync(path.join(tmplDir, 'runner-claim-confirmation.html'), 'utf8'),
        textPart: fs.readFileSync(path.join(tmplDir, 'runner-claim-confirmation.txt'), 'utf8'),
      },
    });

    // Template 3 — Runner: purchase approved + permanent download link (ADR-0002)
    //
    // downloadUrl must be the permanent platform route /download/{downloadToken},
    // never a short-lived S3 presigned URL. The token does not expire.
    new ses.CfnTemplate(this, 'RunnerPurchaseApprovedTemplate', {
      template: {
        templateName: SesConstruct.TEMPLATE_NAMES[2],
        subjectPart: 'Your photo is ready to download — {{eventName}}',
        htmlPart: fs.readFileSync(path.join(tmplDir, 'runner-purchase-approved.html'), 'utf8'),
        textPart: fs.readFileSync(path.join(tmplDir, 'runner-purchase-approved.txt'), 'utf8'),
      },
    });

    // Template 4 — Runner: re-download resend (ADR-0002 recovery path)
    //
    // TemplateData contract for SendTemplatedEmail (RS-011):
    //   { "downloads": [ { "url": "...", "eventName": "...", "photoReference": "..." }, ... ] }
    //
    // Uses Handlebars {{#each downloads}} iteration to avoid a raw-HTML injection
    // surface. The calling Lambda must never pass pre-built HTML — supply the
    // structured array and let SES render it.
    new ses.CfnTemplate(this, 'RunnerRedownloadResendTemplate', {
      template: {
        templateName: SesConstruct.TEMPLATE_NAMES[3],
        subjectPart: 'Your RaceShots download links',
        htmlPart: fs.readFileSync(path.join(tmplDir, 'runner-redownload-resend.html'), 'utf8'),
        textPart: fs.readFileSync(path.join(tmplDir, 'runner-redownload-resend.txt'), 'utf8'),
      },
    });
  }

  /**
   * Grants ses:SendEmail and ses:SendTemplatedEmail on:
   *
   *   Identity ARNs (two, to cover both verified-address and verified-domain setups):
   *     1. The email-level identity ARN (identity/noreply@example.com)
   *     2. The domain-level identity ARN (identity/example.com)
   *
   *   Template ARNs (one per template defined in this construct):
   *     ses:SendTemplatedEmail requires an explicit grant on the template resource
   *     in addition to the sender identity. Template names are account-scoped
   *     static strings — no envName suffix needed.
   *
   * The domain is extracted from the email address via CFN intrinsics
   * (cdk.Fn.split / cdk.Fn.select) so the ARN is resolved at deploy time from
   * the SSM parameter value, keeping the grant narrowly scoped to this one
   * sending domain rather than granting identity/*.
   *
   * Note: intentionally does NOT grant ses:SendRawEmail — raw email sending is
   * not used by this service. The CDK built-in grantSendEmail() grants
   * SendRawEmail instead of SendTemplatedEmail; this method corrects that.
   */
  grantSendEmail(grantee: iam.IGrantable): iam.Grant {
    const stack = cdk.Stack.of(this);

    // Extract the domain from the sender address via CFN intrinsics so the ARN
    // is resolved at deploy time (sesFromAddress is an SSM token at synth time).
    const domain = cdk.Fn.select(1, cdk.Fn.split('@', this.emailIdentity.emailIdentityName));

    // Grant on identity + template ARNs in a single statement so the returned
    // Grant object covers all permissions and the IAM policy stays consolidated.
    return iam.Grant.addToPrincipal({
      grantee,
      actions: ['ses:SendEmail', 'ses:SendTemplatedEmail'],
      resourceArns: [
        this.emailIdentityArn,
        stack.formatArn({ service: 'ses', resource: 'identity', resourceName: domain }),
        ...SesConstruct.TEMPLATE_NAMES.map(name =>
          stack.formatArn({ service: 'ses', resource: 'template', resourceName: name }),
        ),
      ],
      scope: this,
    });
  }

  /**
   * CloudFormation output — SES sender identity ARN for debugging.
   * Consumed by downstream stacks that need the ARN without a CDK dependency.
   */
  addArnOutput(): cdk.CfnOutput {
    return new cdk.CfnOutput(cdk.Stack.of(this), 'SesIdentityArn', {
      value: this.emailIdentityArn,
      description: 'SES verified sender identity ARN',
    });
  }
}
