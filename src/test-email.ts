import dotenv from 'dotenv';
dotenv.config();

const EmailService = require('./services/email.service');

async function testEmailService() {
  try {
    console.log('Testing Level Up Email...');
    await EmailService.sendLevelUpEmail('emre@bio.xyz', 3);

    console.log('Testing Sandbox Email...');
    const mockProject = {
      id: 'test-project-id',
      projectName: 'Test BioDAO Project',
      projectDescription: 'A test project for BioDAO',
      fullName: 'Test User',
      email: 'test@example.com',
      wallet: '0x123456789abcdef',
      Discord: {
        memberCount: 15,
        papersShared: 30,
        messagesCount: 120,
      },
    };

    await EmailService.sendSandboxEmail(mockProject);

    console.log('Email tests completed successfully!');
  } catch (error) {
    console.error('Error testing email service:', error);
  }
}

// Run the test
testEmailService();
