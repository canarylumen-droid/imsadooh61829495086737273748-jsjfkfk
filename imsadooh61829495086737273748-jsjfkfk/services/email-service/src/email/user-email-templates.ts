interface WelcomeEmailOptions {
  userName: string;
  companyName: string;
  dashboardUrl?: string;
  brandColor?: string;
}

interface TrialReminderOptions {
  userName: string;
  companyName: string;
  daysRemaining: number;
  upgradeUrl?: string;
  brandColor?: string;
}

export function generateWelcomeEmail(options: WelcomeEmailOptions): { html: string; text: string } {
  const {
    userName,
    companyName,
    dashboardUrl = 'https://audnixai.com/dashboard',
    brandColor = '#00D9FF'
  } = options;

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="background-color: #0F172A; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; margin: 0; padding: 40px 20px;">
  <div style="max-width: 520px; margin: 0 auto;">
    <div style="text-align: center; margin-bottom: 32px;">
      <h1 style="color: #F1F5F9; font-size: 24px; font-weight: 700; margin: 0;">${companyName}</h1>
      <p style="color: ${brandColor}; font-size: 14px; margin: 8px 0 0 0;">Your AI Closer</p>
    </div>
    
    <div style="background-color: #1E293B; border-radius: 12px; padding: 32px; border: 1px solid #334155;">
      <h2 style="color: #F1F5F9; font-size: 22px; font-weight: 600; margin: 0 0 16px 0;">You're In, ${userName}.</h2>
      
      <p style="color: #94A3B8; font-size: 15px; line-height: 1.6; margin: 0 0 16px 0;">
        Most creators lose 80% of warm leads because they can't follow up fast enough.
      </p>
      
      <p style="color: #F1F5F9; font-size: 15px; line-height: 1.6; margin: 0 0 24px 0; font-weight: 500;">
        That ends today. Your AI closer is ready to work 24/7.
      </p>

      <div style="background-color: #0F172A; border-radius: 8px; padding: 20px; margin-bottom: 24px;">
        <h3 style="color: ${brandColor}; font-size: 14px; font-weight: 600; margin: 0 0 12px 0;">HERE'S WHAT HAPPENS NOW:</h3>
        <ul style="color: #CBD5E1; font-size: 14px; line-height: 1.8; margin: 0; padding-left: 20px;">
          <li><strong>Step 1:</strong> Connect your Instagram (takes 30 seconds)</li>
          <li><strong>Step 2:</strong> Import your leads or let AI find them from comments</li>
          <li><strong>Step 3:</strong> Watch AI close deals while you sleep</li>
        </ul>
      </div>

      <p style="color: #94A3B8; font-size: 13px; line-height: 1.5; margin: 0 0 20px 0; padding: 12px; background: linear-gradient(135deg, rgba(16, 185, 129, 0.1), rgba(6, 182, 212, 0.1)); border-radius: 8px; border-left: 3px solid ${brandColor};">
        <strong style="color: #F1F5F9;">Quick tip:</strong> Creators using Audnix see 8-12x more conversions than manual outreach. The AI learns each lead's behavior and only reaches out when they're ready to buy.
      </p>

      <a href="${dashboardUrl}" style="display: block; background: linear-gradient(135deg, #10B981, #06B6D4); color: #0F172A; text-decoration: none; text-align: center; padding: 16px 24px; border-radius: 8px; font-weight: 700; font-size: 16px;">
        Start Closing Leads Now
      </a>
    </div>

    <p style="color: #64748B; font-size: 12px; text-align: center; margin-top: 24px; line-height: 1.5;">
      Questions? Hit reply. We read every message.<br>
      Team ${companyName}
    </p>
  </div>
</body>
</html>
`;

  const text = `You're In, ${userName}.

Most creators lose 80% of warm leads because they can't follow up fast enough.

That ends today. Your AI closer is ready to work 24/7.

HERE'S WHAT HAPPENS NOW:
- Step 1: Connect your Instagram (takes 30 seconds)
- Step 2: Import your leads or let AI find them from comments
- Step 3: Watch AI close deals while you sleep

Quick tip: Creators using Audnix see 8-12x more conversions than manual outreach. The AI learns each lead's behavior and only reaches out when they're ready to buy.

Start now: ${dashboardUrl}

Questions? Hit reply. We read every message.

Team ${companyName}`;

  return { html, text };
}

export function generateTrialReminderEmail(options: TrialReminderOptions): { html: string; text: string } {
  const {
    userName,
    companyName,
    daysRemaining,
    upgradeUrl = 'https://audnixai.com/dashboard/settings?tab=billing',
    brandColor = '#00D9FF'
  } = options;

  const urgencyText = daysRemaining <= 1
    ? 'Final day to lock in your AI closer'
    : `${daysRemaining} days left to keep your AI working`;

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="background-color: #0F172A; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; margin: 0; padding: 40px 20px;">
  <div style="max-width: 520px; margin: 0 auto;">
    <div style="text-align: center; margin-bottom: 32px;">
      <h1 style="color: #F1F5F9; font-size: 24px; font-weight: 700; margin: 0;">${companyName}</h1>
    </div>
    
    <div style="background-color: #1E293B; border-radius: 12px; padding: 32px; border: 1px solid #334155;">
      <div style="background-color: #FEF3C7; color: #92400E; padding: 12px 16px; border-radius: 8px; font-size: 14px; font-weight: 600; margin-bottom: 24px; text-align: center;">
        ${urgencyText}
      </div>

      <h2 style="color: #F1F5F9; font-size: 20px; font-weight: 600; margin: 0 0 16px 0;">${userName}, quick question:</h2>
      
      <p style="color: #F1F5F9; font-size: 16px; line-height: 1.6; margin: 0 0 16px 0; font-weight: 500;">
        How many leads slipped through the cracks before you found Audnix?
      </p>
      
      <p style="color: #94A3B8; font-size: 15px; line-height: 1.6; margin: 0 0 24px 0;">
        Every day without AI follow up is money left on the table. Your leads are getting colder by the hour.
      </p>

      <div style="background-color: #0F172A; border-radius: 8px; padding: 20px; margin-bottom: 24px;">
        <h3 style="color: ${brandColor}; font-size: 14px; font-weight: 600; margin: 0 0 12px 0;">WHAT YOU'RE ABOUT TO LOSE:</h3>
        <ul style="color: #CBD5E1; font-size: 14px; line-height: 1.8; margin: 0; padding-left: 20px;">
          <li>AI that knows when each lead is ready to buy</li>
          <li>24/7 follow up that sounds like you wrote it</li>
          <li>Objection handling that closes deals while you sleep</li>
          <li>All your imported leads and conversation history</li>
        </ul>
      </div>

      <a href="${upgradeUrl}" style="display: block; background: linear-gradient(135deg, #10B981, #06B6D4); color: #0F172A; text-decoration: none; text-align: center; padding: 16px 24px; border-radius: 8px; font-weight: 700; font-size: 16px;">
        Keep My AI Closer Running
      </a>

      <p style="color: #94A3B8; font-size: 13px; text-align: center; margin-top: 16px;">
        "I closed 3 deals in my first week" - actual user
      </p>
    </div>

    <p style="color: #64748B; font-size: 12px; text-align: center; margin-top: 24px;">
      Questions? Just reply. Team ${companyName}
    </p>
  </div>
</body>
</html>
`;

  const text = `${urgencyText}

${userName}, quick question:

How many leads slipped through the cracks before you found Audnix?

Every day without AI follow up is money left on the table. Your leads are getting colder by the hour.

WHAT YOU'RE ABOUT TO LOSE:
- AI that knows when each lead is ready to buy
- 24/7 follow up that sounds like you wrote it
- Objection handling that closes deals while you sleep
- All your imported leads and conversation history

Keep your AI running: ${upgradeUrl}

"I closed 3 deals in my first week" - actual user

Questions? Just reply. Team ${companyName}`;

  return { html, text };
}

export function generateTrialExpiredEmail(options: Omit<TrialReminderOptions, 'daysRemaining'>): { html: string; text: string } {
  const {
    userName,
    companyName,
    upgradeUrl = 'https://audnixai.com/dashboard/settings?tab=billing',
    brandColor = '#00D9FF'
  } = options;

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="background-color: #0F172A; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; margin: 0; padding: 40px 20px;">
  <div style="max-width: 520px; margin: 0 auto;">
    <div style="text-align: center; margin-bottom: 32px;">
      <h1 style="color: #F1F5F9; font-size: 24px; font-weight: 700; margin: 0;">${companyName}</h1>
    </div>
    
    <div style="background-color: #1E293B; border-radius: 12px; padding: 32px; border: 1px solid #334155;">
      <div style="background-color: #FEE2E2; color: #991B1B; padding: 12px 16px; border-radius: 8px; font-size: 14px; font-weight: 600; margin-bottom: 24px; text-align: center;">
        Your AI closer stopped working
      </div>

      <h2 style="color: #F1F5F9; font-size: 20px; font-weight: 600; margin: 0 0 16px 0;">${userName}, your leads are going cold.</h2>
      
      <p style="color: #94A3B8; font-size: 15px; line-height: 1.6; margin: 0 0 16px 0;">
        Right now, your AI closer is paused. That means:
      </p>
      
      <ul style="color: #F87171; font-size: 14px; line-height: 1.8; margin: 0 0 24px 20px; padding: 0;">
        <li>No automatic follow ups happening</li>
        <li>New leads aren't getting responses</li>
        <li>Your competitors are closing deals you should be winning</li>
      </ul>
      
      <p style="color: #10B981; font-size: 15px; line-height: 1.6; margin: 0 0 24px 0; font-weight: 500;">
        Good news: Your data is safe. Reactivate in 60 seconds and pick up right where you left off.
      </p>

      <a href="${upgradeUrl}" style="display: block; background: linear-gradient(135deg, #10B981, #06B6D4); color: #0F172A; text-decoration: none; text-align: center; padding: 16px 24px; border-radius: 8px; font-weight: 700; font-size: 16px;">
        Get My AI Back Online
      </a>

      <p style="color: #94A3B8; font-size: 13px; text-align: center; margin-top: 16px;">
        Starter plan is just $49/month. That's one closed deal.
      </p>
    </div>

    <p style="color: #64748B; font-size: 12px; text-align: center; margin-top: 24px;">
      Need help? Just reply. Team ${companyName}
    </p>
  </div>
</body>
</html>
`;

  const text = `Your AI closer stopped working

${userName}, your leads are going cold.

Right now, your AI closer is paused. That means:
- No automatic follow ups happening
- New leads aren't getting responses
- Your competitors are closing deals you should be winning

Good news: Your data is safe. Reactivate in 60 seconds and pick up right where you left off.

Reactivate now: ${upgradeUrl}

Starter plan is just $49/month. That's one closed deal.

Need help? Just reply. Team ${companyName}`;

  return { html, text };
}

/**
 * Outreach Email with Plain Text Priority
 * Default to plain text unless high-fidelity brand colors are provided.
 */
export function generateOutreachEmail(options: {
  subject: string;
  body: string;
  brandColor?: string;
  companyName?: string;
}): { html: string; text: string } {
  const hasColor = options.brandColor &&
    options.brandColor !== '#000000' &&
    options.brandColor !== '#ffffff';

  const textBody = options.body;

  const htmlBody = `
<!DOCTYPE html>
<html>
<head>
  <style>
    body { font-family: -apple-system, system-ui, sans-serif; line-height: 1.6; color: #1a1a1a; margin: 0; padding: 20px; }
    .container { max-width: 600px; margin: 0 auto; }
    .content { white-space: pre-wrap; font-size: 16px; }
    ${hasColor ? `.brand-accent { border-left: 4px solid ${options.brandColor}; padding-left: 20px; }` : ''}
    .footer { margin-top: 40px; font-size: 12px; color: #999; }
  </style>
</head>
<body>
  <div class="container">
    <div class="content ${hasColor ? 'brand-accent' : ''}">${textBody}</div>
    <div class="footer">Sent via ${options.companyName || 'Audnix AI'}</div>
  </div>
</body>
</html>
`;

  return { html: htmlBody, text: textBody };
}
