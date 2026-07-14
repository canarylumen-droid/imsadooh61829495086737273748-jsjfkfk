/**
 * Audnix AI - Reminder & Nurture Email Sequence (V2.9.2)
 * Clean, simple design matching landing page branding
 * Navy headers, electric blue CTAs, professional spacing
 */

interface ReminderEmailOptions {
  userName: string;
  userEmail: string;
  leadsCount?: number;
}

/**
 * +4 Hours: "It's Live" - Immediately push to import
 */
export function generateItsLiveEmail(options: ReminderEmailOptions): { html: string; text: string } {
  const { userName } = options;

  const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<style>
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#ffffff;margin:0;padding:0;color:#1B1F3A}
.container{max-width:600px;margin:0 auto;background:#ffffff}
.header{background:#1B1F3A;padding:48px 24px;text-align:center}
.header h1{color:#ffffff;font-size:28px;font-weight:700;margin:0;letter-spacing:-0.5px}
.header p{color:#B4B8FF;font-size:14px;margin:8px 0 0 0}
.content{padding:48px 24px}
h2{color:#1B1F3A;font-size:20px;font-weight:700;margin:0 0 16px 0;line-height:1.3}
p{margin:0 0 16px 0;font-size:15px;line-height:1.7;color:#4a5a7a}
strong{color:#1B1F3A;font-weight:600}
.highlight{background:#f8f9ff;padding:24px;border-radius:8px;margin:24px 0}
.highlight p{margin:0;font-size:15px;line-height:1.7}
.steps{margin:20px 0;font-size:15px;line-height:1.8}
.steps p{margin:0 0 12px 0}
.cta-button{display:inline-block;background:#4A5BFF;color:white;padding:14px 32px;border-radius:6px;text-decoration:none;font-weight:600;font-size:14px;margin-top:28px;border:none;cursor:pointer}
.cta-button:hover{background:#3a4bee}
.footer{background:#f8f9ff;padding:32px 24px;text-align:center;border-top:none;font-size:12px;color:#7a8fa3}
.footer p{margin:0;line-height:1.6}
</style>
</head>
<body>
<div class="container">
<div class="header">
<h1>🚀 It's Live</h1>
<p>Your AI Sales Closer is Ready</p>
</div>
<div class="content">
<h2>Hi ${userName},</h2>

<p>Your Audnix AI is now live and monitoring your account. Time to put it to work.</p>

<div class="highlight">
<p><strong>Next 3 minutes:</strong></p>
<div class="steps">
<p>1. Go to your dashboard<br>
2. Import 10-20 of your hottest leads<br>
3. Watch your AI start closing deals</p>
</div>
</div>

<p>Your AI will contact them within 2-4 minutes. No setup. No manual follow-ups. Just results.</p>

<table cellpadding="0" cellspacing="0" style="margin-top:28px"><tr><td><a href="https://audnixai.com/dashboard/lead-import" class="cta-button">Import Leads Now →</a></td></tr></table>

<p style="margin-top:32px;font-size:13px;color:#7a8fa3">Your 3-day free trial is active.</p>
</div>
<div class="footer">
<p>© 2025 Audnix AI. Your AI Sales Closer.</p>
</div>
</div>
</body>
</html>`;

  const text = `🚀 It's Live

Your AI Sales Closer is Ready

Hi ${userName},

Your Audnix AI is now live and monitoring your account. Time to put it to work.

Next 3 minutes:
1. Go to your dashboard
2. Import 10-20 of your hottest leads
3. Watch your AI start closing deals

Your AI will contact them within 2-4 minutes. No setup. No manual follow-ups. Just results.

→ Import Leads Now: https://audnixai.com/dashboard/lead-import

Your 3-day free trial is active.

© 2025 Audnix AI. Your AI Sales Closer.`;

  return { html, text };
}

/**
 * +50-69 Hours: Day 2 - Just checking in
 */
export function generateDay2CheckInEmail(options: ReminderEmailOptions): { html: string; text: string } {
  const { userName } = options;

  const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<style>
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#ffffff;margin:0;padding:0;color:#1B1F3A}
.container{max-width:600px;margin:0 auto;background:#ffffff}
.header{background:#1B1F3A;padding:40px 24px;text-align:center}
.header h1{color:#ffffff;font-size:24px;font-weight:700;margin:0}
.content{padding:48px 24px}
h2{color:#1B1F3A;font-size:20px;font-weight:700;margin:0 0 16px 0}
p{margin:0 0 16px 0;font-size:15px;line-height:1.7;color:#4a5a7a}
.proof{background:#f8f9ff;padding:20px;border-radius:8px;margin:24px 0;border-left:4px solid #4A5BFF}
.proof p{margin:0;font-size:15px}
.cta-button{display:inline-block;background:#4A5BFF;color:white;padding:14px 32px;border-radius:6px;text-decoration:none;font-weight:600;font-size:14px;margin-top:28px;border:none;cursor:pointer}
.cta-button:hover{background:#3a4bee}
.footer{background:#f8f9ff;padding:32px 24px;text-align:center;border-top:none;font-size:12px;color:#7a8fa3}
</style>
</head>
<body>
<div class="container">
<div class="header">
<h1>Day 2 Check In</h1>
</div>
<div class="content">
<h2>Your Leads Are Warming Up</h2>

<p>Hi ${userName}, your AI has been working behind the scenes.</p>

<div class="proof">
<p><strong>What's happening right now:</strong> Your leads are receiving personalized messages. Your AI is analyzing responses. Objection handling is in motion.</p>
</div>

<p>Every hour your AI runs, it gets smarter. It learns what works. It adapts to your audience.</p>

<p><strong>Haven't imported leads yet?</strong> Do it now. Your AI performs best with real data.</p>

<table cellpadding="0" cellspacing="0" style="margin-top:28px"><tr><td><a href="https://audnixai.com/dashboard/lead-import" class="cta-button">Import Your Leads →</a></td></tr></table>
</div>
<div class="footer">
<p>© 2025 Audnix AI. Automate Revenue.</p>
</div>
</div>
</body>
</html>`;

  const text = `Day 2 Check In

Your Leads Are Warming Up

Hi ${userName}, your AI has been working behind the scenes.

What's happening right now: Your leads are receiving personalized messages. Your AI is analyzing responses. Objection handling is in motion.

Every hour your AI runs, it gets smarter. It learns what works. It adapts to your audience.

Haven't imported leads yet? Do it now. Your AI performs best with real data.

→ Import Your Leads: https://audnixai.com/dashboard/lead-import

© 2025 Audnix AI. Automate Revenue.`;

  return { html, text };
}

/**
 * +60-72 Hours: Trial ends tomorrow
 */
export function generateTrialEndsThermorrow(options: ReminderEmailOptions): { html: string; text: string } {
  const { userName } = options;

  const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<style>
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#ffffff;margin:0;padding:0;color:#1B1F3A}
.container{max-width:600px;margin:0 auto;background:#ffffff}
.header{background:#1B1F3A;padding:40px 24px;text-align:center}
.header h1{color:#ffffff;font-size:24px;font-weight:700;margin:0}
.content{padding:48px 24px}
h2{color:#1B1F3A;font-size:20px;font-weight:700;margin:0 0 16px 0}
p{margin:0 0 16px 0;font-size:15px;line-height:1.7;color:#4a5a7a}
.alert{background:#fff5f5;padding:20px;border-radius:8px;margin:24px 0;border-left:4px solid #d4462f}
.alert p{color:#7a1f1f;margin:0;font-weight:500}
.cta-button{display:inline-block;background:#4A5BFF;color:white;padding:14px 32px;border-radius:6px;text-decoration:none;font-weight:600;font-size:14px;margin-top:28px;border:none;cursor:pointer}
.cta-button:hover{background:#3a4bee}
.footer{background:#f8f9ff;padding:32px 24px;text-align:center;border-top:none;font-size:12px;color:#7a8fa3}
</style>
</head>
<body>
<div class="container">
<div class="header">
<h1>⏰ Trial Ends Tomorrow</h1>
</div>
<div class="content">
<h2>Your AI Goes Quiet at Midnight</h2>

<p>Less than 24 hours left on your free trial, ${userName}.</p>

<div class="alert">
<p><strong>After midnight:</strong> No more lead contacts. No more closing. No more deals. Your momentum stops.</p>
</div>

<p>Your competitors? Their AI never stops. Neither should yours.</p>

<p><strong>Upgrade today.</strong> First month 50% off with code CLOSING50</p>

<table cellpadding="0" cellspacing="0" style="margin-top:28px"><tr><td><a href="https://audnixai.com/dashboard/pricing" class="cta-button">Upgrade Now →</a></td></tr></table>

<p style="margin-top:28px;font-size:13px;color:#7a8fa3">Tonight you choose: Keep closing or watch leads go cold.</p>
</div>
<div class="footer">
<p>© 2025 Audnix AI. Automate Revenue.</p>
</div>
</div>
</body>
</html>`;

  const text = `⏰ Trial Ends Tomorrow

Your AI Goes Quiet at Midnight

Less than 24 hours left on your free trial, ${userName}.

After midnight: No more lead contacts. No more closing. No more deals. Your momentum stops.

Your competitors? Their AI never stops. Neither should yours.

Upgrade today. First month 50% off with code CLOSING50

→ Upgrade Now: https://audnixai.com/dashboard/pricing

Tonight you choose: Keep closing or watch leads go cold.

© 2025 Audnix AI. Automate Revenue.`;

  return { html, text };
}

/**
 * +72 Hours: Trial ends today - Final
 */
export function generateTrialEndsToday(options: ReminderEmailOptions): { html: string; text: string } {
  const { userName } = options;

  const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<style>
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#ffffff;margin:0;padding:0;color:#1B1F3A}
.container{max-width:600px;margin:0 auto;background:#ffffff}
.header{background:#1B1F3A;padding:40px 24px;text-align:center}
.header h1{color:#ffffff;font-size:24px;font-weight:700;margin:0}
.content{padding:48px 24px}
h2{color:#1B1F3A;font-size:20px;font-weight:700;margin:0 0 16px 0}
p{margin:0 0 16px 0;font-size:15px;line-height:1.7;color:#4a5a7a}
.alert{background:#fff5f5;padding:20px;border-radius:8px;margin:24px 0;border-left:4px solid #d4462f}
.alert p{color:#7a1f1f;margin:0;font-weight:500}
.cta-button{display:inline-block;background:#4A5BFF;color:white;padding:14px 32px;border-radius:6px;text-decoration:none;font-weight:600;font-size:14px;margin-top:28px;border:none;cursor:pointer}
.cta-button:hover{background:#3a4bee}
.footer{background:#f8f9ff;padding:32px 24px;text-align:center;border-top:none;font-size:12px;color:#7a8fa3}
</style>
</head>
<body>
<div class="container">
<div class="header">
<h1>Your Trial Ends Today</h1>
</div>
<div class="content">
<h2>Last Chance, ${userName}</h2>

<p>Your free trial expires tonight at midnight. After that, you've exhausted your free access.</p>

<div class="alert">
<p><strong>What you'll lose:</strong> Your leads. Your momentum. Your early wins. Gone.</p>
</div>

<p>Everything you built over 3 days stops. Leads go cold. Competitors move in.</p>

<p><strong>Upgrade before midnight.</strong> Keep your AI running. First month 50% off with code CLOSING50</p>

<table cellpadding="0" cellspacing="0" style="margin-top:28px"><tr><td><a href="https://audnixai.com/dashboard/pricing" class="cta-button">Upgrade Before Midnight →</a></td></tr></table>

<p style="margin-top:28px;font-size:13px;color:#7a8fa3;font-weight:500">This is it. Your choice. Your future.</p>
</div>
<div class="footer">
<p>© 2025 Audnix AI. Automate Revenue.</p>
</div>
</div>
</body>
</html>`;

  const text = `Your Trial Ends Today

Last Chance, ${userName}

Your free trial expires tonight at midnight. After that, you've exhausted your free access.

What you'll lose: Your leads. Your momentum. Your early wins. Gone.

Everything you built over 3 days stops. Leads go cold. Competitors move in.

Upgrade before midnight. Keep your AI running. First month 50% off with code CLOSING50

→ Upgrade Before Midnight: https://audnixai.com/dashboard/pricing

This is it. Your choice. Your future.

© 2025 Audnix AI. Automate Revenue.`;

  return { html, text };
}

/**
 * No Activity Reminder
 */
export function generateNoActivityReminder(options: ReminderEmailOptions): { html: string; text: string } {
  const { userName } = options;

  const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<style>
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#ffffff;margin:0;padding:0;color:#1B1F3A}
.container{max-width:600px;margin:0 auto;background:#ffffff}
.header{background:#1B1F3A;padding:40px 24px;text-align:center}
.header h1{color:#ffffff;font-size:24px;font-weight:700;margin:0}
.content{padding:48px 24px}
h2{color:#1B1F3A;font-size:20px;font-weight:700;margin:0 0 16px 0}
p{margin:0 0 16px 0;font-size:15px;line-height:1.7;color:#4a5a7a}
.cta-button{display:inline-block;background:#4A5BFF;color:white;padding:14px 32px;border-radius:6px;text-decoration:none;font-weight:600;font-size:14px;margin-top:28px;border:none;cursor:pointer}
.cta-button:hover{background:#3a4bee}
.footer{background:#f8f9ff;padding:32px 24px;text-align:center;border-top:none;font-size:12px;color:#7a8fa3}
</style>
</head>
<body>
<div class="container">
<div class="header">
<h1>We Miss You</h1>
</div>
<div class="content">
<h2>Your Leads Are Waiting</h2>

<p>Hi ${userName}, we noticed you haven't logged in lately.</p>

<p>Your AI is ready to close deals. Your leads are still there. They're waiting for you.</p>

<p><strong>3 steps back to winning:</strong></p>
<p>1. Log in to your dashboard<br>
2. Import your leads<br>
3. Let your AI close</p>

<table cellpadding="0" cellspacing="0" style="margin-top:28px"><tr><td><a href="https://audnixai.com/dashboard" class="cta-button">Get Back to Closing →</a></td></tr></table>

<p style="margin-top:28px;font-size:13px;color:#7a8fa3">Your AI doesn't take breaks. Neither should you.</p>
</div>
<div class="footer">
<p>© 2025 Audnix AI. Automate Revenue.</p>
</div>
</div>
</body>
</html>`;

  const text = `We Miss You

Your Leads Are Waiting

Hi ${userName}, we noticed you haven't logged in lately.

Your AI is ready to close deals. Your leads are still there. They're waiting for you.

3 steps back to winning:
1. Log in to your dashboard
2. Import your leads
3. Let your AI close

→ Get Back to Closing: https://audnixai.com/dashboard

Your AI doesn't take breaks. Neither should you.

© 2025 Audnix AI. Automate Revenue.`;

  return { html, text };
}
