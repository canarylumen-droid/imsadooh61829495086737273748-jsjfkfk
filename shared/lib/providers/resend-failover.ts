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
   * Send an email with automatic fallback from SendGrid to Resend
   */
  static async send(options: SendEmailOptions): Promise<EmailResult> {
    const sendgridApiKey = process.env.TWILIO_SENDGRID_API_KEY;
    const sendgridFromEmail = options.from || process.env.SENDGRID_FROM_EMAIL || process.env.TWILIO_EMAIL_FROM || 'noreply@auth.audnixai.com';
    const sendgridFromName = options.fromName || process.env.SENDGRID_FROM_NAME || 'Audnix AI';

    // 1. Try SendGrid first if API key exists
    if (sendgridApiKey && sendgridApiKey.trim().length > 0) {
      try {
        console.log(`📧 Attempting to send email to ${options.to} via SendGrid...`);
        const response = await fetch('https://api.sendgrid.com/v3/mail/send', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${sendgridApiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            personalizations: [{ to: [{ email: options.to }] }],
            from: { 
              email: sendgridFromEmail, 
              name: sendgridFromName 
            },
            subject: options.subject,
            content: [
              ...(options.text ? [{ type: 'text/plain', value: options.text }] : []),
              { type: 'text/html', value: options.html }
            ]
          })
        });

        if (response.ok || response.status === 202) {
          const messageId = response.headers.get('x-message-id') || 'sendgrid_success';
          console.log(`✅ Email sent successfully via SendGrid to ${options.to}`);
          return { success: true, messageId };
        }

        const errorText = await response.text();
        console.warn(`⚠️ SendGrid API error [${response.status}]: ${errorText}`);
      } catch (sgError: any) {
        console.warn(`⚠️ SendGrid connection failed: ${sgError.message || sgError}`);
      }
    } else {
      console.log('ℹ️ SendGrid is not configured (TWILIO_SENDGRID_API_KEY is missing). Skipping to Resend.');
    }

    // 2. Fall back to Resend if SendGrid is unconfigured or failed
    const resendApiKey = process.env.RESEND_API_KEY;
    if (!resendApiKey || resendApiKey.trim().length === 0) {
      console.error('❌ CRITICAL: Neither SendGrid nor Resend email providers are configured.');
      return { success: false, error: 'No email providers configured. Please set TWILIO_SENDGRID_API_KEY or RESEND_API_KEY.' };
    }

    try {
      console.log(`📧 Falling back: Sending email to ${options.to} via Resend...`);
      
      let fromField = `${sendgridFromName} <${sendgridFromEmail}>`;
      
      let resendResponse = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${resendApiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          from: fromField,
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

      // Check if this error is due to an unverified domain and we should use onboarding@resend.dev instead
      const shouldRetryWithOnboarding = 
        resendResponse.status === 403 || 
        resendResponse.status === 400 || 
        errorText.includes('onboarding@resend.dev') ||
        errorText.toLowerCase().includes('validation') ||
        errorText.toLowerCase().includes('domain');

      if (shouldRetryWithOnboarding) {
        console.log('🔄 Retrying Resend with emergency default sender: onboarding@resend.dev');
        fromField = `${sendgridFromName} <onboarding@resend.dev>`;
        
        resendResponse = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${resendApiKey}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            from: fromField,
            to: [options.to],
            subject: options.subject,
            html: options.html,
            text: options.text || ''
          })
        });

        if (resendResponse.ok) {
          const result = await resendResponse.json() as { id: string };
          console.log(`✅ Email sent successfully via Resend with default sender to ${options.to} (ID: ${result.id})`);
          return { success: true, messageId: result.id };
        }

        const retryError = await resendResponse.text();
        console.error(`❌ Resend fallback sending attempt failed: ${retryError}`);
        return { success: false, error: `Resend error: ${retryError}` };
      }

      return { success: false, error: `Resend error: ${errorText}` };
    } catch (resendError: any) {
      console.error(`❌ Resend failover request failed: ${resendError.message || resendError}`);
      return { success: false, error: resendError.message || String(resendError) };
    }
  }
}
