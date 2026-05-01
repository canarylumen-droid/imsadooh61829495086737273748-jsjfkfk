/**
 * Premium OTP Email Template with Audnix Branding
 * Dark theme, minimal design, high-trust feel
 * 
 * Branding:
 * - Primary: #1B1F3A (dark navy)
 * - Accent: #4A5BFF (electric blue)
 * - Background: #F7F8FC (off-white)
 * - Text: #0E0E0E (near black)
 */

export interface OTPEmailOptions {
  recipientEmail: string;
  otpCode: string;
  recipientName?: string;
}

export function generateOTPEmail(options: OTPEmailOptions): { html: string; text: string } {
  const { recipientEmail, otpCode, recipientName = 'User' } = options;
  
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Your Audnix Verification Code</title>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
            background-color: #F7F8FC;
            color: #0E0E0E;
            line-height: 1.6;
        }
        
        .container {
            max-width: 600px;
            margin: 0 auto;
            padding: 20px;
            background-color: #F7F8FC;
        }
        
        .email-wrapper {
            background-color: #FFFFFF;
            border-radius: 8px;
            overflow: hidden;
            box-shadow: 0 2px 8px rgba(0, 0, 0, 0.06);
        }
        
        .header {
            background: linear-gradient(135deg, #1B1F3A 0%, #2D3548 100%);
            padding: 30px 24px;
            text-align: center;
        }
        
        .header h1 {
            color: #FFFFFF;
            font-size: 24px;
            font-weight: 700;
            margin: 0;
            letter-spacing: -0.5px;
        }
        
        .header p {
            color: #B4B8FF;
            font-size: 13px;
            margin: 6px 0 0 0;
            font-weight: 500;
        }
        
        .content {
            padding: 40px 24px;
        }
        
        .greeting {
            font-size: 14px;
            color: #0E0E0E;
            margin-bottom: 24px;
            font-weight: 500;
        }
        
        .intro {
            font-size: 13px;
            color: #4A5A7A;
            margin-bottom: 32px;
            line-height: 1.8;
        }
        
        .otp-section {
            background-color: #F7F8FC;
            border-left: 4px solid #4A5BFF;
            padding: 24px;
            border-radius: 4px;
            margin-bottom: 32px;
            text-align: center;
        }
        
        .otp-label {
            font-size: 11px;
            color: #4A5A7A;
            text-transform: uppercase;
            letter-spacing: 1.2px;
            font-weight: 600;
            margin-bottom: 12px;
            display: block;
        }
        
        .otp-code {
            font-size: 36px;
            font-weight: 700;
            color: #1B1F3A;
            letter-spacing: 4px;
            font-family: 'Monaco', 'Courier New', monospace;
            user-select: all;
            word-spacing: 8px;
        }
        
        .expiration {
            font-size: 12px;
            color: #7A8FA3;
            margin-top: 16px;
            padding-top: 16px;
            border-top: 1px solid #E5E7EB;
            font-weight: 500;
        }
        
        .expiration strong {
            color: #1B1F3A;
            font-weight: 600;
        }
        
        .security-note {
            background-color: #F0F4FF;
            padding: 16px 24px;
            border-radius: 4px;
            margin-bottom: 24px;
            border-left: 3px solid #4A5BFF;
        }
        
        .security-note p {
            font-size: 12px;
            color: #4A5A7A;
            margin: 0;
            line-height: 1.6;
        }
        
        .security-icon {
            display: inline-block;
            margin-right: 8px;
        }
        
        .disclaimer {
            font-size: 12px;
            color: #7A8FA3;
            background-color: #FAFBFC;
            padding: 16px;
            border-radius: 4px;
            margin: 24px 0;
            border: 1px solid #E5E7EB;
        }
        
        .disclaimer strong {
            color: #1B1F3A;
        }
        
        .footer {
            background-color: #FAFBFC;
            padding: 24px;
            text-align: center;
            border-top: 1px solid #E5E7EB;
        }
        
        .footer-text {
            font-size: 11px;
            color: #7A8FA3;
            margin: 0;
            line-height: 1.6;
        }
        
        .footer-text a {
            color: #4A5BFF;
            text-decoration: none;
            font-weight: 500;
        }
        
        .footer-text a:hover {
            text-decoration: underline;
        }
        
        .tagline {
            margin-top: 12px;
            font-size: 11px;
            color: #4A5A7A;
            font-weight: 600;
            letter-spacing: 0.5px;
        }
        
        @media (max-width: 600px) {
            .container {
                padding: 12px;
            }
            
            .content {
                padding: 24px 16px;
            }
            
            .otp-code {
                font-size: 32px;
                letter-spacing: 2px;
            }
            
            .header {
                padding: 24px 16px;
            }
            
            .header h1 {
                font-size: 20px;
            }
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="email-wrapper">
            <!-- Header -->
            <div class="header">
                <h1>Audnix AI</h1>
                <p>Your AI Sales Closer</p>
            </div>
            
            <!-- Main Content -->
            <div class="content">
                <p class="greeting">Welcome to Audnix AI, ${recipientName}</p>
                
                <p class="intro">
                    Your secure verification code is ready. This unlocks your AI-powered sales engine that closes deals while you sleep. Enter the code below to get started — valid for <strong>10 minutes</strong>.
                </p>
                
                <!-- OTP Display -->
                <div class="otp-section">
                    <span class="otp-label">Verification Code</span>
                    <div class="otp-code">${otpCode}</div>
                    <p class="expiration">
                        Expires in <strong>10 minutes</strong>
                    </p>
                </div>
                
                <!-- Security Note -->
                <div class="security-note">
                    <p>
                        <span class="security-icon">🔒</span>
                        <strong>Keep this code private.</strong> Our team will never request it. This code is for your account security only.
                    </p>
                </div>
                
                <!-- Disclaimer -->
                <p class="disclaimer">
                    <strong>Didn't sign up for Audnix?</strong> You can safely disregard this email. If you believe this was sent in error, please don't reply — your account remains secure.
                </p>
            </div>
            
            <!-- Footer -->
            <div class="footer">
                <p class="tagline">Your AI Sales Closer — Always On, Always Closing</p>
                <p class="footer-text">
                    <a href="https://audnixai.com">Visit Audnix AI</a> • <a href="https://audnixai.com/support">Support</a> • <a href="https://audnixai.com/privacy">Privacy</a>
                </p>
                <p class="footer-text" style="margin-top: 16px; color: #9CA3AF;">
                    © 2025 Audnix AI. All rights reserved.
                </p>
            </div>
        </div>
    </div>
</body>
</html>`;

  const text = `Welcome to Audnix AI — Your AI Sales Closer

Hi ${recipientName},

Your secure verification code is ready. This unlocks your AI-powered sales engine that closes deals while you sleep. Enter the code below to get started — valid for 10 minutes.

VERIFICATION CODE:
${otpCode}

Expires in: 10 minutes

SECURITY NOTE:
Keep this code private. Our team will never request it. This code is for your account security only.

---

Didn't sign up for Audnix?
You can safely disregard this email. If you believe this was sent in error, please don't reply — your account remains secure.

Need help?
Visit us at https://audnixai.com/support

© 2025 Audnix AI. All rights reserved.
Your AI Sales Closer — Always On, Always Closing`;

  return { html, text };
}

/**
 * Generate brand-personalized follow-up email with user's name
 */
export function generatePersonalizedFollowUp(
  leadName: string,
  businessOwnerName: string,
  message: string,
  ctaText: string = "Let's talk",
  ctaUrl: string = ""
): string {
  return `<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background-color: #f7f8fc; }
        .wrapper { background: #fff; max-width: 600px; margin: 20px auto; border-radius: 8px; }
        .content { padding: 32px 24px; color: #0e0e0e; line-height: 1.6; font-size: 14px; }
        .signature { margin-top: 24px; padding-top: 24px; border-top: 1px solid #e5e7eb; }
        .signature-name { font-weight: 600; color: #1b1f3a; }
        .cta-button { 
            display: inline-block;
            background: #4a5bff;
            color: white;
            padding: 12px 24px;
            border-radius: 4px;
            text-decoration: none;
            margin-top: 16px;
            font-weight: 600;
            font-size: 13px;
        }
        .cta-button:hover { background: #3a4bee; }
    </style>
</head>
<body>
    <div class="wrapper">
        <div class="content">
            <p>Hey ${leadName},</p>
            <p>${message}</p>
            <a href="${ctaUrl}" class="cta-button">${ctaText}</a>
            <div class="signature">
                <p style="margin: 0;">Talk soon,</p>
                <p class="signature-name" style="margin: 8px 0;">${businessOwnerName}</p>
            </div>
        </div>
    </div>
</body>
</html>`;
}
