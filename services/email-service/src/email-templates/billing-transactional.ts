/**
 * Audnix AI - Billing & Transactional Emails
 * Clean design matching landing page branding
 */

interface BillingEmailOptions {
  userName: string;
  userEmail: string;
  planName: string;
  amount: number;
  invoiceId: string;
  renewalDate: string;
}

/**
 * Payment Confirmation Email
 */
export function generatePaymentConfirmationEmail(options: BillingEmailOptions): { html: string; text: string } {
  const { userName, planName, amount, invoiceId, renewalDate } = options;

  const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<style>
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#ffffff;margin:0;padding:0;color:#1B1F3A}
.container{max-width:600px;margin:0 auto;background:#ffffff}
.header{background:#1B1F3A;padding:40px 24px;text-align:center}
.header h1{color:#ffffff;font-size:24px;font-weight:700;margin:0}
.header p{color:#B4B8FF;font-size:13px;margin:8px 0 0 0}
.content{padding:48px 24px}
h2{color:#1B1F3A;font-size:20px;font-weight:700;margin:0 0 16px 0}
p{margin:0 0 16px 0;font-size:15px;line-height:1.7;color:#4a5a7a}
.success-badge{display:inline-block;background:#ecfdf5;color:#065f46;padding:8px 12px;border-radius:4px;font-size:12px;font-weight:600;margin-bottom:24px}
.invoice-box{background:#f8f9ff;padding:24px;border-radius:8px;margin:24px 0}
.invoice-row{display:flex;justify-content:space-between;margin:12px 0;font-size:14px}
.invoice-label{color:#4a5a7a;font-weight:500}
.invoice-value{color:#1B1F3A;font-weight:600}
.invoice-total{border-top:2px solid #e5e7eb;padding-top:12px;margin-top:12px}
.cta-button{display:inline-block;background:#4A5BFF;color:white;padding:14px 32px;border-radius:6px;text-decoration:none;font-weight:600;font-size:14px;margin-top:28px;border:none;cursor:pointer}
.cta-button:hover{background:#3a4bee}
.footer{background:#f8f9ff;padding:32px 24px;text-align:center;border-top:none;font-size:12px;color:#7a8fa3}
.footer a{color:#4A5BFF;text-decoration:none}
</style>
</head>
<body>
<div class="container">
<div class="header">
<h1>Payment Confirmed</h1>
<p>Your AI Sales Closer is Now Active</p>
</div>
<div class="content">
<div class="success-badge">✅ PAYMENT RECEIVED</div>

<h2>Welcome to ${planName}, ${userName}</h2>

<p>Your payment is confirmed. Your ${planName} plan is active and your AI is closing deals right now.</p>

<div class="invoice-box">
<div class="invoice-row">
<span class="invoice-label">Plan</span>
<span class="invoice-value">${planName}</span>
</div>
<div class="invoice-row">
<span class="invoice-label">Amount</span>
<span class="invoice-value">$${amount}</span>
</div>
<div class="invoice-row">
<span class="invoice-label">Invoice</span>
<span class="invoice-value">${invoiceId}</span>
</div>
<div class="invoice-row">
<span class="invoice-label">Next Renewal</span>
<span class="invoice-value">${renewalDate}</span>
</div>
<div class="invoice-row invoice-total">
<span class="invoice-label">Status</span>
<span class="invoice-value" style="color:#10b981">Active ✓</span>
</div>
</div>

<p><strong>You now have:</strong> Unlimited lead imports • 24/7 AI closing • Real-time meeting booking • Advanced analytics • Priority support</p>

<table cellpadding="0" cellspacing="0" style="margin-top:28px"><tr><td><a href="https://audnixai.com/dashboard" class="cta-button">View Your Dashboard →</a></td></tr></table>

<p style="margin-top:28px;font-size:13px;color:#7a8fa3">Questions? Contact support or reply to this email.</p>
</div>
<div class="footer">
<p><a href="https://audnixai.com/support">Support</a> • <a href="https://audnixai.com/privacy">Privacy</a> • <a href="https://audnixai.com/billing">Manage Subscription</a></p>
<p>© 2025 Audnix AI</p>
</div>
</div>
</body>
</html>`;

  const text = `Payment Confirmed
Your AI Sales Closer is Now Active

✅ PAYMENT RECEIVED

Welcome to ${planName}, ${userName}

Your payment is confirmed. Your ${planName} plan is active and your AI is closing deals right now.

INVOICE DETAILS:
Plan: ${planName}
Amount: $${amount}
Invoice: ${invoiceId}
Next Renewal: ${renewalDate}
Status: Active ✓

You now have: Unlimited lead imports • 24/7 AI closing • Real-time meeting booking • Advanced analytics • Priority support

→ View Your Dashboard: https://audnixai.com/dashboard

Questions? Contact support or reply to this email.

Support: https://audnixai.com/support
Privacy: https://audnixai.com/privacy
Manage Subscription: https://audnixai.com/billing

© 2025 Audnix AI`;

  return { html, text };
}

/**
 * Invoice Email - Monthly
 */
export function generateInvoiceEmail(options: BillingEmailOptions): { html: string; text: string } {
  const { userName, planName, amount, invoiceId, renewalDate } = options;

  const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<style>
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#ffffff;margin:0;padding:0;color:#1B1F3A}
.container{max-width:600px;margin:0 auto;background:#ffffff}
.header{background:#1B1F3A;padding:32px 24px;text-align:center}
.header h1{color:#ffffff;font-size:20px;font-weight:700;margin:0}
.content{padding:40px 24px}
h2{color:#1B1F3A;font-size:16px;font-weight:700;margin:0 0 12px 0}
p{margin:0 0 16px 0;font-size:14px;line-height:1.7;color:#4a5a7a}
.invoice-box{background:#f8f9ff;padding:20px;border-radius:8px;margin:20px 0}
.invoice-row{display:flex;justify-content:space-between;font-size:14px;margin:10px 0}
.invoice-label{color:#4a5a7a;font-weight:500}
.invoice-value{color:#1B1F3A;font-weight:600}
.cta-button{display:inline-block;background:#4A5BFF;color:white;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600;font-size:13px;margin-top:20px;border:none;cursor:pointer}
.cta-button:hover{background:#3a4bee}
.footer{background:#f8f9ff;padding:24px;text-align:center;border-top:none;font-size:11px;color:#7a8fa3}
.footer a{color:#4A5BFF;text-decoration:none}
</style>
</head>
<body>
<div class="container">
<div class="header">
<h1>Your Monthly Invoice</h1>
</div>
<div class="content">
<p>Hi ${userName},</p>

<p>Your ${planName} subscription is active and your AI is closing deals 24/7.</p>

<div class="invoice-box">
<div class="invoice-row">
<span class="invoice-label">Plan</span>
<span class="invoice-value">${planName}</span>
</div>
<div class="invoice-row">
<span class="invoice-label">Amount</span>
<span class="invoice-value">$${amount}</span>
</div>
<div class="invoice-row">
<span class="invoice-label">Invoice</span>
<span class="invoice-value">${invoiceId}</span>
</div>
<div class="invoice-row">
<span class="invoice-label">Next Billing</span>
<span class="invoice-value">${renewalDate}</span>
</div>
</div>

<table cellpadding="0" cellspacing="0"><tr><td><a href="https://audnixai.com/dashboard/billing" class="cta-button">View Full Invoice →</a></td></tr></table>

<p style="margin-top:20px;font-size:12px;color:#7a8fa3">Questions? <a href="https://audnixai.com/support" style="color:#4A5BFF;text-decoration:none">Contact support</a></p>
</div>
<div class="footer">
<p><a href="https://audnixai.com/support">Support</a> • <a href="https://audnixai.com/billing">Manage Subscription</a></p>
<p>© 2025 Audnix AI</p>
</div>
</div>
</body>
</html>`;

  const text = `Your Monthly Invoice

Hi ${userName},

Your ${planName} subscription is active and your AI is closing deals 24/7.

INVOICE DETAILS:
Plan: ${planName}
Amount: $${amount}
Invoice: ${invoiceId}
Next Billing: ${renewalDate}

→ View Full Invoice: https://audnixai.com/dashboard/billing

Questions? Contact support: https://audnixai.com/support

© 2025 Audnix AI`;

  return { html, text };
}
