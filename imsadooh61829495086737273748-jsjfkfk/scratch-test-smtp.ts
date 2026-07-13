import nodemailer from 'nodemailer';

async function testSMTP() {
  console.log('Testing SMTP connection...');
  
  const transporter = nodemailer.createTransport({
    host: 'mail.privateemail.com',
    port: 465,
    secure: true,
    auth: {
      user: 'fortune@replyflow.pro',
      pass: 'So201mt123#'
    },
    logger: true,
    debug: true
  });

  try {
    const info = await transporter.sendMail({
      from: '"Audnix AI Test" <fortune@replyflow.pro>',
      to: 'fortuneuchendu708@gmail.com',
      subject: 'Audnix SMTP Infrastructure Test',
      text: 'Hello! This is a test email from the Audnix Autonomous Engine confirming that your SMTP connection is working correctly over port 465 with SSL.',
      html: '<b>Hello!</b><br>This is a test email from the Audnix Autonomous Engine confirming that your SMTP connection is working correctly over port 465 with SSL.'
    });

    console.log('Message sent successfully! Message ID:', info.messageId);
  } catch (error) {
    console.error('Failed to send email:', error);
  }
}

testSMTP();
