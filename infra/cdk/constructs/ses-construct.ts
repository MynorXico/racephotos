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
}

/**
 * SesConstruct
 *
 * Creates:
 *   - SES email identity for the verified sender (one per environment)
 *   - Ten SES email templates (five types × two locales) used by payment and download Lambda stories:
 *       racephotos-photographer-claim-{en|es-419}         (ADR-0001)
 *       racephotos-runner-claim-confirmation-{en|es-419}  (ADR-0002)
 *       racephotos-runner-purchase-approved-{en|es-419}   (ADR-0002)
 *       racephotos-runner-purchase-rejected-{en|es-419}   (RS-021)
 *       racephotos-runner-redownload-resend-{en|es-419}   (ADR-0002)
 *
 * Template names have NO {envName} suffix — SES templates are account-scoped
 * and each environment is deployed to an isolated AWS account.
 *
 * Downstream Lambda constructs call grantSendEmail(lambdaRole) to receive
 * ses:SendEmail + ses:SendTemplatedEmail on the verified identity ARN.
 *
 * SES template variable conventions (Handlebars {{variableName}}):
 *   photographer-claim-{locale}:        runnerEmailMasked, eventName, photoReference, paymentReference, dashboardUrl
 *   runner-claim-confirmation-{locale}: eventName, photoReference, paymentReference
 *   runner-purchase-approved-{locale}:  eventName, downloadUrl
 *   runner-purchase-rejected-{locale}:  eventName
 *   runner-redownload-resend-{locale}:  downloads (array) — each item: { url, photoReference }
 *                             url = {appBaseUrl}/download/{token}; photoReference = photoId.
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
    PhotographerClaimEn: {
      name: 'racephotos-photographer-claim-en',
      subject: 'New purchase claim — {{eventName}}',
      htmlFile: 'photographer-claim-en.html',
      textFile: 'photographer-claim-en.txt',
    },
    PhotographerClaimEs419: {
      name: 'racephotos-photographer-claim-es-419',
      subject: 'Nueva solicitud de compra — {{eventName}}',
      htmlFile: 'photographer-claim-es-419.html',
      textFile: 'photographer-claim-es-419.txt',
    },
    RunnerClaimConfirmationEn: {
      name: 'racephotos-runner-claim-confirmation-en',
      subject: 'Payment claim received — {{eventName}}',
      htmlFile: 'runner-claim-confirmation-en.html',
      textFile: 'runner-claim-confirmation-en.txt',
    },
    RunnerClaimConfirmationEs419: {
      name: 'racephotos-runner-claim-confirmation-es-419',
      subject: 'Solicitud de pago recibida — {{eventName}}',
      htmlFile: 'runner-claim-confirmation-es-419.html',
      textFile: 'runner-claim-confirmation-es-419.txt',
    },
    RunnerPurchaseApprovedEn: {
      name: 'racephotos-runner-purchase-approved-en',
      subject: 'Your photo is ready to download — {{eventName}}',
      htmlFile: 'runner-purchase-approved-en.html',
      textFile: 'runner-purchase-approved-en.txt',
    },
    RunnerPurchaseApprovedEs419: {
      name: 'racephotos-runner-purchase-approved-es-419',
      subject: 'Tu foto está lista para descargar — {{eventName}}',
      htmlFile: 'runner-purchase-approved-es-419.html',
      textFile: 'runner-purchase-approved-es-419.txt',
    },
    RunnerPurchaseRejectedEn: {
      name: 'racephotos-runner-purchase-rejected-en',
      subject: 'Purchase claim rejected — {{eventName}}',
      htmlFile: 'runner-purchase-rejected-en.html',
      textFile: 'runner-purchase-rejected-en.txt',
    },
    RunnerPurchaseRejectedEs419: {
      name: 'racephotos-runner-purchase-rejected-es-419',
      subject: 'Solicitud de compra rechazada — {{eventName}}',
      htmlFile: 'runner-purchase-rejected-es-419.html',
      textFile: 'runner-purchase-rejected-es-419.txt',
    },
    RunnerRedownloadResendEn: {
      name: 'racephotos-runner-redownload-resend-en',
      subject: 'Your RaceShots download links',
      htmlFile: 'runner-redownload-resend-en.html',
      textFile: 'runner-redownload-resend-en.txt',
    },
    RunnerRedownloadResendEs419: {
      name: 'racephotos-runner-redownload-resend-es-419',
      subject: 'Tus enlaces de descarga de RaceShots',
      htmlFile: 'runner-redownload-resend-es-419.html',
      textFile: 'runner-redownload-resend-es-419.txt',
    },
  } as const;

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
   *   Configuration set ARN (configuration-set/*):
   *     When a default configuration set is associated with the SES sending
   *     identity (common in accounts that have SES configuration sets for
   *     tracking/suppression), SES enforces IAM on the configuration-set resource
   *     too. A wildcard scoped to configuration-set/* in this account/region is
   *     used — the configuration set name is an SES console setting not known at
   *     synth time and not discoverable without manual inspection.
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

    return iam.Grant.addToPrincipal({
      grantee,
      actions: ['ses:SendEmail', 'ses:SendTemplatedEmail'],
      resourceArns: [
        this.emailIdentityArn,
        stack.formatArn({ service: 'ses', resource: 'identity', resourceName: domain }),
        ...Object.values(SesConstruct.TEMPLATES).map(tmpl =>
          stack.formatArn({ service: 'ses', resource: 'template', resourceName: tmpl.name }),
        ),
        stack.formatArn({ service: 'ses', resource: 'configuration-set', resourceName: '*' }),
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
