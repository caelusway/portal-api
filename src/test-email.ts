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
      projectVision: 'To revolutionize science with DAOs',
      scientificReferences: 'https://doi.org/10.1000/testref',
      credentialLinks: 'https://linkedin.com/in/testuser',
      teamMembers: 'Alice, Bob, Carol',
      motivation: 'Advance open science',
      progress: 'Completed onboarding',
      fullName: 'Test User',
      email: 'test@example.com',
      wallet: '0x123456789abcdef',
      referralCode: 'BIO-TEST1234',
      referredById: 'referrer-project-id',
      Discord: {
        memberCount: 15,
        papersShared: 30,
        messagesCount: 120,
        serverName: 'Test Server',
        serverId: '1234567890',
        verified: true,
        botAdded: true,
        inviteLink: 'https://discord.gg/testinvite',
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
