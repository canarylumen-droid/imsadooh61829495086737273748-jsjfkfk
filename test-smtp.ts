import nodemailer from 'nodemailer';
import dns from 'dns';

async function testSMTP() {
  const smtpHost = 'mail.privateemail.com';
  const email = 'fortune@replyflow.pro';
  const password = 'So201mt123#';
  const recipientEmail = 'fortuneuchendu708@gmail.com';

  const portsToTry = [465, 587];
  let successfulPort = null;
  let transporter: any;

  for (const port of portsToTry) {
    console.log(`\n[Email Test] Testing SMTP connection to ${smtpHost}:${port}...`);
    try {
      transporter = nodemailer.createTransport({
        host: smtpHost,
        port: port,
        secure: port === 465,
        auth: {
          user: email,
          pass: password,
        },
        family: 4,
        lookup: (hostname: string, options: any, callback: any) => {
          return dns.lookup(hostname, { family: 4 }, callback);
        },
        tls: {
          rejectUnauthorized: false,
          servername: smtpHost,
        },
        connectionTimeout: 15000,
        greetingTimeout: 15000,
        socketTimeout: 15000,
      } as any);

      await transporter.verify();
      successfulPort = port;
      console.log(`[Email Test] Verification successful on port ${port}!`);
      break; 
    } catch (err: any) {
      console.warn(`[Email Test] Port ${port} failed:`, err.message || err);
    }
  }

  if (!successfulPort) {
    console.error('\n[Email Test] ALL PORTS FAILED TO AUTHENTICATE. Please double-check the password.');
    return;
  }

  // Send the test email
  try {
    const info = await transporter.sendMail({
      from: `"Audnix AI Test" <${email}>`,
      to: recipientEmail,
      subject: 'Audnix AI - SMTP Connection Test 2',
      text: 'This is a test email sent from the Audnix AI infrastructure.',
    });

    console.log(`[Email Test] Test email sent successfully! Message ID: ${info.messageId}`);
  } catch (sendErr: any) {
    console.error(`[Email Test] Failed to send email:`, sendErr.message || sendErr);
  }
}

testSMTP().catch(console.error);
