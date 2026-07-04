// Standalone credential test — run directly: node test-credentials.mjs
// Tests SMTP + IMAP connectivity with zero dependencies on the app.
// No Docker, no DB, no Redis needed.

const EMAIL = 'treasure@outreach.replyflow.pro';
const PASSWORD = 'TrexJetTechnology2008!';
const SMTP_HOST = 'admin.mail.replyflow.pro';
const SMTP_PORT = 587;
const IMAP_HOST = 'admin.mail.replyflow.pro';
const IMAP_PORT = 993;

const TO = ['fortuneuchendu708@gmail.com', 'canarylumen@gmail.com'];

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// ─── SMTP Test ─────────────────────────────────────────────────────────────
async function testSMTP() {
  console.log('\n─── SMTP Test ───');
  console.log(`Host: ${SMTP_HOST}:${SMTP_PORT}`);
  console.log(`User: ${EMAIL}`);

  // Try ports 587, 465, 2525 in order
  const ports = [587, 465, 2525];
  
  for (const port of ports) {
    try {
      const nodemailer = (await import('nodemailer')).default;
      const dns = await import('dns');
      
      const transporter = nodemailer.createTransport({
        host: SMTP_HOST,
        port,
        secure: port === 465,
        auth: { user: EMAIL, pass: PASSWORD },
        family: 4,
        lookup: (hostname, options, callback) => {
          dns.resolve4(hostname, (err, addresses) => {
            if (err || !addresses?.length) return callback(err || new Error('No IPv4'), null, 4);
            callback(null, addresses[0], 4);
          });
        },
        tls: { rejectUnauthorized: false },
        connectionTimeout: 10000,
        greetingTimeout: 10000,
        socketTimeout: 15000,
      });

      await transporter.verify();
      console.log(`✅ SMTP port ${port}: AUTH SUCCESS`);
      
      // Try sending
      for (const to of TO) {
        try {
          const info = await transporter.sendMail({
            from: EMAIL,
            to,
            subject: `Test from Audnix — ${new Date().toISOString().slice(0, 19)}`,
            text: 'This is a dry-run test email from your Audnix deployment.\n\nIf you receive this, SMTP is working end-to-end.',
          });
          console.log(`✅ Sent to ${to}: messageId=${info.messageId || 'ok'}`);
        } catch (sendErr) {
          console.error(`❌ Send to ${to} failed:`, sendErr.message);
        }
      }

      transporter.close();
      return true;
    } catch (err) {
      const isLast = port === ports[ports.length - 1];
      console.log(`❌ SMTP port ${port}: ${err.code || err.message}${isLast ? ' — ALL PORTS FAILED' : ', trying next port...'}`);
    }
  }
  return false;
}

// ─── IMAP Test ──────────────────────────────────────────────────────────────
async function testIMAP() {
  console.log('\n─── IMAP Test ───');
  console.log(`Host: ${IMAP_HOST}:${IMAP_PORT}`);

  try {
    const ImapFlow = (await import('imapflow')).ImapFlow;
    
    const client = new ImapFlow({
      host: IMAP_HOST,
      port: IMAP_PORT,
      secure: true,
      auth: { user: EMAIL, pass: PASSWORD },
      logger: false,
      connectionTimeout: 15000,
      tls: { rejectUnauthorized: false },
    });

    await client.connect();
    console.log('✅ IMAP: Connected + authenticated');

    const mailbox = await client.mailboxOpen('INBOX');
    console.log(`✅ INBOX opened: ${mailbox.exists} messages`);

    await client.logout();
    console.log('✅ IMAP: Clean logout');
    return true;
  } catch (err) {
    console.error('❌ IMAP failed:', err.responseStatus || err.code || err.message);
    return false;
  }
}

// ─── Run All ────────────────────────────────────────────────────────────────
async function main() {
  console.log('═══ Audnix Credential Dry-Run Test ═══');
  console.log(`Email: ${EMAIL}`);
  console.log(`SMTP:  ${SMTP_HOST}:${SMTP_PORT}`);
  console.log(`IMAP:  ${IMAP_HOST}:${IMAP_PORT}`);
  console.log(`To:    ${TO.join(', ')}`);
  console.log('');

  const smtpOk = await testSMTP();
  const imapOk = await testIMAP();

  console.log('\n═══ RESULTS ═══');
  console.log(`SMTP: ${smtpOk ? '✅ PASS' : '❌ FAIL'}`);
  console.log(`IMAP: ${imapOk ? '✅ PASS' : '❌ FAIL'}`);

  if (!smtpOk || !imapOk) {
    console.log('\n🔧 TROUBLESHOOTING:');
    if (!smtpOk) {
      console.log('  • Check if port 587/465 is blocked by your hosting provider');
      console.log('  • Try: telnet admin.mail.replyflow.pro 587');
      console.log('  • Some hosts (Railway, Render) block outbound SMTP entirely');
    }
    if (!imapOk) {
      console.log('  • Verify IMAP is enabled on the mail server');
      console.log('  • Some hosts use different hostnames for IMAP vs SMTP');
    }
    process.exit(1);
  }

  console.log('\n✅ ALL PASSED — Your credentials work end-to-end.');
}

main().catch(err => {
  console.error('\n💥 Test crashed:', err.message);
  process.exit(1);
});
