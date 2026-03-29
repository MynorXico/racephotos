import * as cdk from 'aws-cdk-lib';
import * as ses from 'aws-cdk-lib/aws-ses';
import * as iam from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';
import { EnvConfig } from '../config/types';

interface SesConstructProps {
  config: EnvConfig;
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
 *   runner-redownload-resend:  downloadLinks (rendered as HTML list by calling Lambda)
 */
export class SesConstruct extends Construct {
  /** ARN of the verified SES sender identity — used for IAM grant scoping. */
  readonly emailIdentityArn: string;

  private readonly emailIdentity: ses.EmailIdentity;

  constructor(scope: Construct, id: string, props: SesConstructProps) {
    super(scope, id);

    const { sesFromAddress } = props;

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

    // Template 1 — Photographer: new purchase claim (ADR-0001)
    new ses.CfnTemplate(this, 'PhotographerClaimTemplate', {
      template: {
        templateName: 'racephotos-photographer-claim',
        subjectPart: 'New purchase claim — {{eventName}}',
        htmlPart: [
          '<html><body style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px">',
          '<h2>New Purchase Claim</h2>',
          '<p>A runner has submitted a payment claim for one of your photos.</p>',
          '<table style="border-collapse:collapse;width:100%">',
          '  <tr><td style="padding:8px;font-weight:bold">Runner</td>',
          '      <td style="padding:8px">{{runnerEmailMasked}}</td></tr>',
          '  <tr><td style="padding:8px;font-weight:bold">Event</td>',
          '      <td style="padding:8px">{{eventName}}</td></tr>',
          '  <tr><td style="padding:8px;font-weight:bold">Photo reference</td>',
          '      <td style="padding:8px">{{photoReference}}</td></tr>',
          '</table>',
          '<p style="margin-top:24px">',
          '  <a href="{{dashboardUrl}}" style="background:#1a73e8;color:#fff;padding:12px 24px;',
          '     text-decoration:none;border-radius:4px;display:inline-block">',
          '    Review claim in dashboard',
          '  </a>',
          '</p>',
          '<p style="color:#666;font-size:12px;margin-top:32px">',
          '  Approve or reject the claim after verifying the payment on your bank statement.',
          '</p>',
          '</body></html>',
        ].join(''),
        textPart: [
          'New Purchase Claim — {{eventName}}',
          '',
          'A runner has submitted a payment claim.',
          '',
          'Runner:          {{runnerEmailMasked}}',
          'Event:           {{eventName}}',
          'Photo reference: {{photoReference}}',
          '',
          'Review the claim in your dashboard:',
          '{{dashboardUrl}}',
          '',
          'Approve or reject the claim after verifying the payment on your bank statement.',
        ].join('\n'),
      },
    });

    // Template 2 — Runner: claim confirmation (ADR-0002)
    new ses.CfnTemplate(this, 'RunnerClaimConfirmationTemplate', {
      template: {
        templateName: 'racephotos-runner-claim-confirmation',
        subjectPart: 'Payment claim received — {{eventName}}',
        htmlPart: [
          '<html><body style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px">',
          '<h2>Payment Claim Received</h2>',
          '<p>We received your payment claim. The photographer will verify and approve it.</p>',
          '<table style="border-collapse:collapse;width:100%">',
          '  <tr><td style="padding:8px;font-weight:bold">Event</td>',
          '      <td style="padding:8px">{{eventName}}</td></tr>',
          '  <tr><td style="padding:8px;font-weight:bold">Photo reference</td>',
          '      <td style="padding:8px">{{photoReference}}</td></tr>',
          '  <tr><td style="padding:8px;font-weight:bold">Your payment reference</td>',
          '      <td style="padding:8px"><strong>{{paymentReference}}</strong></td></tr>',
          '</table>',
          '<p style="margin-top:16px">',
          '  Keep your payment reference for your records. You will receive another email',
          '  once the photographer approves your claim.',
          '</p>',
          '</body></html>',
        ].join(''),
        textPart: [
          'Payment Claim Received — {{eventName}}',
          '',
          'We received your payment claim. The photographer will verify and approve it.',
          '',
          'Event:                  {{eventName}}',
          'Photo reference:        {{photoReference}}',
          'Your payment reference: {{paymentReference}}',
          '',
          'Keep your payment reference for your records.',
          'You will receive another email once the photographer approves your claim.',
        ].join('\n'),
      },
    });

    // Template 3 — Runner: purchase approved + permanent download link (ADR-0002)
    new ses.CfnTemplate(this, 'RunnerPurchaseApprovedTemplate', {
      template: {
        templateName: 'racephotos-runner-purchase-approved',
        subjectPart: 'Your photo is ready to download — {{eventName}}',
        htmlPart: [
          '<html><body style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px">',
          '<h2>Your Photo is Ready</h2>',
          '<p>Your payment has been approved. You can now download your photo.</p>',
          '<table style="border-collapse:collapse;width:100%;margin-bottom:24px">',
          '  <tr><td style="padding:8px;font-weight:bold">Event</td>',
          '      <td style="padding:8px">{{eventName}}</td></tr>',
          '</table>',
          '<p>',
          '  <a href="{{downloadUrl}}" style="background:#1a73e8;color:#fff;padding:12px 24px;',
          '     text-decoration:none;border-radius:4px;display:inline-block">',
          '    Download photo',
          '  </a>',
          '</p>',
          '<p style="color:#666;font-size:13px;margin-top:16px">',
          '  This link works indefinitely. Bookmark it or keep this email.',
          '  If you lose it, visit the platform and use the re-download option.',
          '</p>',
          '</body></html>',
        ].join(''),
        textPart: [
          'Your Photo is Ready — {{eventName}}',
          '',
          'Your payment has been approved. You can now download your photo.',
          '',
          'Event: {{eventName}}',
          '',
          'Download your photo:',
          '{{downloadUrl}}',
          '',
          'This link works indefinitely. Bookmark it or keep this email.',
          'If you lose it, visit the platform and use the re-download option.',
        ].join('\n'),
      },
    });

    // Template 4 — Runner: re-download resend (ADR-0002 recovery path)
    new ses.CfnTemplate(this, 'RunnerRedownloadResendTemplate', {
      template: {
        templateName: 'racephotos-runner-redownload-resend',
        subjectPart: 'Your RaceShots download links',
        htmlPart: [
          '<html><body style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px">',
          '<h2>Your Download Links</h2>',
          '<p>Here are your active download links for approved purchases:</p>',
          '{{downloadLinks}}',
          '<p style="color:#666;font-size:13px;margin-top:24px">',
          '  Each link works indefinitely. Bookmark them or keep this email.',
          '</p>',
          '</body></html>',
        ].join(''),
        textPart: [
          'Your RaceShots Download Links',
          '',
          'Here are your active download links for approved purchases:',
          '',
          '{{downloadLinks}}',
          '',
          'Each link works indefinitely. Bookmark them or keep this email.',
        ].join('\n'),
      },
    });
  }

  /**
   * Grants ses:SendEmail and ses:SendTemplatedEmail on the verified identity ARN.
   *
   * Note: intentionally does NOT grant ses:SendRawEmail — raw email sending is
   * not used by this service. The CDK built-in grantSendEmail() grants
   * SendRawEmail instead of SendTemplatedEmail; this method corrects that.
   */
  grantSendEmail(grantee: iam.IGrantable): iam.Grant {
    return this.emailIdentity.grant(grantee, 'ses:SendEmail', 'ses:SendTemplatedEmail');
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
