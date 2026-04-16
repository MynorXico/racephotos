import * as fs from 'fs';
import * as path from 'path';
import * as cdk from 'aws-cdk-lib';
import * as ses from 'aws-cdk-lib/aws-ses';
import * as iam from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';

interface SesConstructProps {
  /**
   * Verified SES sender email address.
   * Loaded via ssm.StringParameter.valueForStringParameter in the parent stack:
   *   /racephotos/env/{envName}/ses-from-address
   *
   * NOT stored in EnvConfig — email addresses must not appear in version
   * control. SSM is the correct layer for this value.
   */
  sesFromAddress: string;
  /**
   * SES configuration set name associated with the verified sender identity.
   * When set (not "none"), grantSendEmail scopes the configuration-set IAM grant
   * to this specific ARN rather than using configuration-set/*.
   * Use "none" if no configuration set is associated with the sending identity.
   * Sourced from EnvConfig.sesConfigurationSetName.
   */
  sesConfigurationSetName: string;
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
  private readonly sesConfigurationSetName: string;

  /**
   * SES template definitions — the single source of truth for all four templates.
   *
   * Each entry drives both resource creation in the constructor (via iteration)
   * and the IAM grant in grantSendEmail, so adding or renaming a template in one
   * place keeps every layer in sync automatically.
   *
   * Keys are PascalCase to produce stable CloudFormation logical IDs
   * (`${key}Template`) that match the original hand-written resource IDs,
   * avoiding unintended resource replacements on deploy.
   *
   * Template names have NO {envName} suffix — SES templates are account-scoped
   * and each environment is deployed to an isolated AWS account.
   */
  static readonly TEMPLATES = {
    PhotographerClaim: {
      name: 'racephotos-photographer-claim',
      subject: 'New purchase claim — {{eventName}}',
      htmlFile: 'photographer-claim.html',
      textFile: 'photographer-claim.txt',
    },
    RunnerClaimConfirmation: {
      name: 'racephotos-runner-claim-confirmation',
      subject: 'Payment claim received — {{eventName}}',
      htmlFile: 'runner-claim-confirmation.html',
      textFile: 'runner-claim-confirmation.txt',
    },
    RunnerPurchaseApproved: {
      name: 'racephotos-runner-purchase-approved',
      subject: 'Your photo is ready to download — {{eventName}}',
      htmlFile: 'runner-purchase-approved.html',
      textFile: 'runner-purchase-approved.txt',
    },
    RunnerRedownloadResend: {
      name: 'racephotos-runner-redownload-resend',
      subject: 'Your RaceShots download links',
      htmlFile: 'runner-redownload-resend.html',
      textFile: 'runner-redownload-resend.txt',
    },
  } as const;

  constructor(scope: Construct, id: string, props: SesConstructProps) {
    super(scope, id);

    const { sesFromAddress, sesConfigurationSetName } = props;
    this.sesConfigurationSetName = sesConfigurationSetName;
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
    // Driven by SesConstruct.TEMPLATES so adding a template in the constant
    // automatically creates the resource and includes it in the IAM grant.
    // Plain text alternatives are required for all templates (RFC 1341).
    //
    // HTML and text sources are in ./ses-templates/ — edit there for syntax
    // highlighting, linting, and preview support.
    for (const [key, tmpl] of Object.entries(SesConstruct.TEMPLATES)) {
      new ses.CfnTemplate(this, `${key}Template`, {
        template: {
          templateName: tmpl.name,
          subjectPart: tmpl.subject,
          htmlPart: fs.readFileSync(path.join(tmplDir, tmpl.htmlFile), 'utf8'),
          textPart: fs.readFileSync(path.join(tmplDir, tmpl.textFile), 'utf8'),
        },
      });
    }
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
   *   Configuration set ARN:
   *     When a default configuration set is associated with the SES sending
   *     identity (common in accounts that have SES configuration sets for
   *     tracking/suppression), SES enforces IAM on the configuration-set resource
   *     too. This grant is added only when a configuration set name is provided
   *     (not "none").
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

    // Build the resource ARN list. The configuration-set ARN is included only
    // when a configuration set name is explicitly provided — omitting it when
    // "none" avoids granting access to configuration sets that don't exist for
    // this environment (principle of least privilege).
    const resourceArns = [
      this.emailIdentityArn,
      stack.formatArn({ service: 'ses', resource: 'identity', resourceName: domain }),
      ...Object.values(SesConstruct.TEMPLATES).map(tmpl =>
        stack.formatArn({ service: 'ses', resource: 'template', resourceName: tmpl.name }),
      ),
    ];

    if (this.sesConfigurationSetName !== 'none') {
      resourceArns.push(
        stack.formatArn({
          service: 'ses',
          resource: 'configuration-set',
          resourceName: this.sesConfigurationSetName,
        }),
      );
    }

    return iam.Grant.addToPrincipal({
      grantee,
      actions: ['ses:SendEmail', 'ses:SendTemplatedEmail'],
      resourceArns,
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
