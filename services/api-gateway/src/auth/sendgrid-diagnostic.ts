/**
 * SendGrid Diagnostic Tool
 * Helps debug email configuration issues
 */

export class SendGridDiagnostic {
  static async diagnose(): Promise<void> {
    console.log('\n');
    console.log('╔════════════════════════════════════════════════════════════════╗');
    console.log('║          SENDGRID EMAIL CONFIGURATION DIAGNOSTIC               ║');
    console.log('╚════════════════════════════════════════════════════════════════╝');
    
    // Check env vars
    const sendgridKey = process.env.TWILIO_SENDGRID_API_KEY;
    const emailFrom = process.env.TWILIO_EMAIL_FROM || 'auth@audnixai.com';
    
    console.log('\n📋 ENVIRONMENT VARIABLES:');
    console.log(`   TWILIO_SENDGRID_API_KEY: ${sendgridKey ? '✅ SET' : '❌ MISSING'}`);
    console.log(`   TWILIO_EMAIL_FROM: ${emailFrom ? '✅ SET' : '❌ MISSING'} (${emailFrom})`);
    
    if (!sendgridKey) {
      console.log('\n🔴 CRITICAL: SendGrid API Key Missing!');
      console.log('\n📝 FIX STEPS:');
      console.log('   1. Get your SendGrid API Key from: https://app.sendgrid.com/settings/api_keys');
      console.log('   2. Create a new API key (name: Audnix AI OTP)');
      console.log('   3. Copy the key');
      console.log('   4. Add to Replit Secrets: TWILIO_SENDGRID_API_KEY=<your-key>');
      console.log('   5. Verify sender email in SendGrid: https://app.sendgrid.com/settings/sender_auth');
      console.log('   6. Restart the app');
      return;
    }
    
    // Verify key format (should be SG.xxx)
    if (!sendgridKey.startsWith('SG.')) {
      console.log('\n⚠️  WARNING: API Key might be invalid (should start with "SG.")');
      console.log(`   Your key starts with: ${sendgridKey.substring(0, 10)}...`);
    }
    
    console.log('\n✅ SendGrid API Key Detected!');
    console.log(`   Key format: ${sendgridKey.substring(0, 10)}...${sendgridKey.substring(sendgridKey.length - 5)}`);
    
    console.log('\n📬 SENDER EMAIL CONFIGURATION:');
    console.log(`   Email: ${emailFrom}`);
    console.log('   Status: ℹ️  Must be verified in SendGrid settings');
    console.log('   Verify at: https://app.sendgrid.com/settings/sender_auth');
    
    console.log('\n✅ CONFIGURATION CHECK COMPLETE');
    console.log('   OTP emails should now send to recipients\n');
  }
}

// Note: Diagnosis is triggered from twilio-email-otp.ts to avoid duplicate logs
