interface SendEmailOptions {
  to: string;
  subject: string;
  html: string;
  text?: string;
  from?: string;
  fromName?: string;
}

interface EmailResult {
  success: boolean;
  messageId?: string;
  error?: string;
}

export class ResendFailover {
  /**
   * Send an email with automatic fallback from Resend (primary) to SendGrid
    * 
    * Resend is tried first with the configured sender domain (e.g. noreply@auth.audnixai.com).
    * If the domain isn't verified in Resend, falls back to onboarding@resend.dev.
    * If Resend fails entirely, falls back to SendGrid.
   */
  static async send(options: SendEmailOptions): Promise<EmailResult> {
    const resendApiKey = process.env.RESEND_API_KEY;
    const fromEmail = options.from || process.env.SENDGRID_FROM_EMAIL || process.env.TWILIO_EMAIL_FROM || 'noreply@auth.audnixai.com';
    const fromName = options.fromName || process.env.SENDGRID_FROM_NAME || 'Audnix AI';

    // 1. Try Resend first with the configured sender domain
    if (resendApiKey && resendApiKey.trim().length > 0) {
      try {
        console.log(`📧 Attempting to send email to ${options.to} via Resend...`);
        const resendResponse = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${resendApiKey}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            from: `${fromName} <${fromEmail}>`,
            to: [options.to],
            subject: options.subject,
            html: options.html,
            text: options.text || ''
          })
        });

        if (resendResponse.ok) {
          const result = await resendResponse.json() as { id: string };
          console.log(`✅ Email sent successfully via Resend to ${options.to} (ID: ${result.id})`);
          return { success: true, messageId: result.id };
        }

        const errorText = await resendResponse.text();
        console.warn(`⚠️ Resend custom domain attempt rejected [${resendResponse.status}]: ${errorText}`);

        // Retry with onboarding@resend.dev as fallback if domain verification issue
        const shouldRetryWithOnboarding = 
          resendResponse.status === 403 || 
          resendResponse.status === 400 || 
          errorText.toLowerCase().includes('onboarding@resend.dev') ||
          errorText.toLowerCase().includes('verify') ||
          errorText.toLowerCase().includes('domain');

        if (shouldRetryWithOnboarding) {
          console.log('🔄 Retrying Resend with emergency default sender: onboarding@resend.dev');
          const retryResponse = await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${resendApiKey}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              from: `${fromName} <onboarding@resend.dev>`,
              to: [options.to],
              subject: options.subject,
              html: options.html,
              text: options.text || ''
            })
          });

          if (retryResponse.ok) {
            const result = await retryResponse.json() as { id: string };
            console.log(`✅ Email sent successfully via Resend (onboarding@resend.dev) to ${options.to} (ID: ${result.id})`);
            return { success: true, messageId: result.id };
          }

          const retryError = await retryResponse.text();
          console.warn(`⚠️ Resend onboarding fallback also failed [${retryResponse.status}]: ${retryError}`);
        }
      } catch (resendError: any) {
        console.warn(`⚠️ Resend request failed: ${resendError.message || resendError}`);
      }
    }

    // 2. Fall back to SendGrid
    const sendgridApiKey = process.env.TWILIO_SENDGRID_API_KEY;
    if (!sendgridApiKey || sendgridApiKey.trim().length === 0) {
      console.error('❌ CRITICAL: Neither Resend nor SendGrid email providers are configured.');
      return { success: false, error: 'No email providers configured. Please set RESEND_API_KEY or TWILIO_SENDGRID_API_KEY.' };
    }

    try {
      console.log(`📧 Falling back: Sending email to ${options.to} via SendGrid...`);
      const sgResponse = await fetch('https://api.sendgrid.com/v3/mail/send', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${sendgridApiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          personalizations: [{ to: [{ email: options.to }] }],
          from: { 
            email: fromEmail, 
            name: fromName 
          },
          subject: options.subject,
          content: [
            ...(options.text ? [{ type: 'text/plain', value: options.text }] : []),
            { type: 'text/html', value: options.html }
          ]
        })
      });

      if (sgResponse.ok || sgResponse.status === 202) {
        const messageId = sgResponse.headers.get('x-message-id') || 'sendgrid_success';
        console.log(`✅ Email sent successfully via SendGrid to ${options.to}`);
        return { success: true, messageId };
      }

      const sgErrorText = await sgResponse.text();
      console.error(`❌ SendGrid API error [${sgResponse.status}]: ${sgErrorText}`);
      return { success: false, error: `SendGrid error: ${sgErrorText}` };
    } catch (sgError: any) {
      console.error(`❌ SendGrid connection failed: ${sgError.message || sgError}`);
      return { success: false, error: sgError.message || String(sgError) };
    }
  }
}
