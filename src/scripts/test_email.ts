import SendEmailPlugin from '../plugins/tools/send_email/index.js';

async function testRealEmail() {
  console.log('Sending real email...');
  const result = await SendEmailPlugin.execute({
    email: 'ntamonchristleandre@gmail.com',
    header: 'Test from HIVE-MIND-RAILWAY 🤖',
    message:
      '<p>Hello Léandre,</p><p>This is a real test email sent by the Agent during the testing phase.</p><p>Best regards,<br/>AntiGravity</p>',
  });

  console.log('Result:', result);
}

testRealEmail().catch(console.error);
