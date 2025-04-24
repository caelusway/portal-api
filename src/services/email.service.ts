import FormData from 'form-data';
import Mailgun from 'mailgun.js';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

// Configure Mailgun
const mailgun = new Mailgun(FormData);
const mg = mailgun.client({
  username: 'api',
  key: process.env.MAILGUN_API_KEY || '',
  url: process.env.MAILGUN_REGION === 'eu' ? 'https://api.eu.mailgun.net' : undefined,
});

const MAILGUN_DOMAIN =
  process.env.MAILGUN_DOMAIN || 'sandboxaebe4f00726647d187dcb0f5e2dc1c4c.mailgun.org';
const FROM_EMAIL = process.env.FROM_EMAIL || `BioDAO <postmaster@${MAILGUN_DOMAIN}>`;
const SANDBOX_NOTIFICATION_EMAILS = (process.env.SANDBOX_NOTIFICATION_EMAIL || 'james@bio.xyz')
  .split(',')
  .map(email => email.trim())
  .filter(Boolean);

/**
 * Send an email to the user when they level up
 * @param userEmail Email address of the user
 * @param level The new level the user has reached
 */
export async function sendLevelUpEmail(userEmail: string, level: number): Promise<void> {
  if (!userEmail) {
    console.warn('Cannot send level up email: No user email provided');
    return;
  }

  try {
    const subject = `🚀 Congratulations! You've reached Level ${level} in your BioDAO`;

    let message = '';
    switch (level) {
      case 2:
        message = `
          Congratulations on reaching Level 2 of your BioDAO journey! 
          
          You've successfully minted your Science NFTs, establishing the foundation of your research DAO. Now, it's time to build your community.
          
          Your next goals:
          - Create a Discord server
          - Add our verification bot
          - Grow your community to at least 4 members
          
          Log in to continue your progress and receive guidance from our AI assistant.
        `;
        break;
      case 3:
        message = `
          Impressive work! You've reached Level 3 of your BioDAO journey.
          
          Your Discord community is now established with at least 4 members. This is a significant milestone in building your decentralized research organization.
          
          Your next goals:
          - Grow your Discord to at least 10 members
          - Share at least 25 scientific papers
          - Achieve 100+ quality messages in your server
          
          Log in to continue your progress and receive guidance from our AI assistant.
        `;
        break;
      case 4:
        message = `
          Outstanding achievement! You've reached Level 4 - the highest level in your BioDAO journey!
          
          You've built a thriving scientific community with:
          - 10+ active members
          - 25+ scientific papers shared
          - 100+ quality discussions
          
          The Bio team will contact you shortly to discuss your next steps and sandbox access. In the meantime, continue growing your community and engaging with your members.
          
          Thank you for your dedication to decentralized science!
        `;
        break;
      default:
        message = `Congratulations on reaching Level ${level} of your BioDAO journey! Log in to continue your progress and receive guidance from our AI assistant.`;
    }

    const data = await mg.messages.create(MAILGUN_DOMAIN, {
      from: FROM_EMAIL,
      to: userEmail,
      subject: subject,
      text: message,
    });

    console.log(`Level up email sent to ${userEmail} for level ${level}. Response:`, data);
  } catch (error) {
    console.error(`Error sending level up email to ${userEmail}:`, error);
  }
}

/**
 * Send an email to the Bio team when a user reaches the sandbox level
 * @param project The project data
 */
export async function sendSandboxEmail(project: any): Promise<void> {
  if (!project) {
    console.warn('Cannot send sandbox email: No project data provided');
    return;
  }

  try {
    const subject = `🎉 New Sandbox User: ${project.projectName || 'Unknown Project'}`;

    const message = `
      A new user has reached the sandbox level (Level 4) in BioDAO!
      
      Project Details:
      - Project Name: ${project.projectName || 'Not specified'}
      - Project Description: ${project.projectDescription || 'Not specified'}
      - Full Name: ${project.fullName || 'Not specified'}
      - Email: ${project.email || 'Not specified'}
      - Wallet: ${project.wallet || 'Not specified'}
      
      Community Stats:
      - Discord Members: ${project.Discord?.memberCount || 0}
      - Papers Shared: ${project.Discord?.papersShared || 0}
      - Messages Count: ${project.Discord?.messagesCount || 0}
      
      Please reach out to this user to discuss next steps and provide sandbox access.
    `;

    const data = await Promise.all(
      SANDBOX_NOTIFICATION_EMAILS.map(email =>
        mg.messages.create(MAILGUN_DOMAIN, {
          from: FROM_EMAIL,
          to: email,
          subject: subject,
          text: message,
        })
      )
    );

    console.log(
      `Sandbox notification email sent to ${SANDBOX_NOTIFICATION_EMAILS.join(', ')}. Response:`,
      data
    );
  } catch (error) {
    console.error('Error sending sandbox notification email:', error);
  }
}

module.exports = {
  sendLevelUpEmail,
  sendSandboxEmail,
};
