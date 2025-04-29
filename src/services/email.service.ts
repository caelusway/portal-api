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
    let html = '';
    switch (level) {
      case 2:
        message = `Congratulations on reaching Level 2 of your BioDAO journey!\n\nYou've successfully minted your Science NFTs, establishing the foundation of your research DAO. Now, it's time to build your community.\n\nYour next goals:\n- Create a Discord server\n- Add our verification bot\n- Grow your community to at least 4 members\n\nLog in to continue your progress and receive guidance from our AI assistant.`;
        html = `
          <h2>Congratulations on reaching Level 2 of your BioDAO journey!</h2>
          <p>You've successfully minted your Science NFTs, establishing the foundation of your research DAO. Now, it's time to build your community.</p>
          <strong>Your next goals:</strong>
          <ul>
            <li>Create a <strong>Discord server</strong></li>
            <li>Add our <strong>verification bot</strong></li>
            <li>Grow your community to at least <strong>4 members</strong></li>
          </ul>
          <p><em>Log in to continue your progress and receive guidance from our AI assistant.</em></p>
        `;
        break;
      case 3:
        message = `Impressive work! You've reached Level 3 of your BioDAO journey.\n\nYour Discord community is now established with at least 4 members. This is a significant milestone in building your decentralized research organization.\n\nYour next goals:\n- Grow your Discord to at least 10 members\n- Share at least 25 scientific papers\n- Achieve 100+ quality messages in your server\n\nLog in to continue your progress and receive guidance from our AI assistant.`;
        html = `
          <h2>Impressive work! You've reached Level 3 of your BioDAO journey.</h2>
          <p>Your Discord community is now established with at least <strong>4 members</strong>. This is a significant milestone in building your decentralized research organization.</p>
          <strong>Your next goals:</strong>
          <ul>
            <li>Grow your Discord to at least <strong>10 members</strong></li>
            <li>Share at least <strong>25 scientific papers</strong></li>
            <li>Achieve <strong>100+ quality messages</strong> in your server</li>
          </ul>
          <p><em>Log in to continue your progress and receive guidance from our AI assistant.</em></p>
        `;
        break;
      case 4:
        message = `Outstanding achievement! You've reached Level 4 – the highest level in your BioDAO journey!\n\nYou've built a thriving scientific community with:\n- 10+ active members\n- 25+ scientific papers shared\n- 100+ quality discussions\n\nThe Bio team will contact you shortly to discuss your next steps and sandbox access. In the meantime, continue growing your community and engaging with your members.\n\nThank you for your dedication to decentralized science!`;
        html = `
          <h2>Outstanding achievement! You've reached Level 4 – the highest level in your BioDAO journey!</h2>
          <p>You've built a thriving scientific community with:</p>
          <ul>
            <li><strong>10+ active members</strong></li>
            <li><strong>25+ scientific papers shared</strong></li>
            <li><strong>100+ quality discussions</strong></li>
          </ul>
          <p>The Bio team will contact you shortly to discuss your next steps and sandbox access. In the meantime, continue growing your community and engaging with your members.</p>
          <p><em>Thank you for your dedication to decentralized science!</em></p>
        `;
        break;
      default:
        message = `Congratulations on reaching Level ${level} of your BioDAO journey!\n\nLog in to continue your progress and receive guidance from our AI assistant.`;
        html = `<h2>Congratulations on reaching Level ${level} of your BioDAO journey!</h2><p><em>Log in to continue your progress and receive guidance from our AI assistant.</em></p>`;
    }

    const data = await mg.messages.create(MAILGUN_DOMAIN, {
      from: FROM_EMAIL,
      to: userEmail,
      subject: subject,
      text: message,
      html: html,
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

    // Plain text version
    const message = `New Sandbox User: ${project.projectName || 'Unknown Project'}\n\nA new user has reached the sandbox level (Level 4) in BioDAO!\n\nProject Details:\n- Project Name: ${project.projectName || 'Not specified'}\n- Project Description: ${project.projectDescription || 'Not specified'}\n- Vision: ${project.projectVision || 'Not specified'}\n- Scientific References: ${project.scientificReferences || 'Not specified'}\n- Credential Links: ${project.credentialLinks || 'Not specified'}\n- Team Members: ${project.teamMembers || 'Not specified'}\n- Motivation: ${project.motivation || 'Not specified'}\n- Progress: ${project.progress || 'Not specified'}\n- Full Name: ${project.fullName || 'Not specified'}\n- Email: ${project.email || 'Not specified'}\n- Wallet: ${project.wallet || 'Not specified'}\n- Referral Code: ${project.referralCode || 'Not specified'}\n- Referred By: ${project.referredById || 'Not specified'}\n- Project ID: ${project.id || 'Not specified'}\n\nCommunity Stats:\n- Discord Members: ${project.Discord?.memberCount || 0}\n- Papers Shared: ${project.Discord?.papersShared || 0}\n- Messages Count: ${project.Discord?.messagesCount || 0}\n- Discord Server Name: ${project.Discord?.serverName || 'Not specified'}\n- Discord Server ID: ${project.Discord?.serverId || 'Not specified'}\n- Discord Verified: ${project.Discord?.verified ? 'Yes' : 'No'}\n- Discord Bot Added: ${project.Discord?.botAdded ? 'Yes' : 'No'}\n\nDiscord Invite Link: ${project.Discord?.inviteLink || 'Not provided'}\n\nPlease reach out to this user to discuss next steps and provide sandbox access.`;

    // HTML version
    const html = `
      <h1>🎉 New Sandbox User: ${project.projectName || 'Unknown Project'}</h1>
      <p>A new user has reached the <strong>sandbox level (Level 4)</strong> in BioDAO!</p>
      <h2>🧬 Project Details</h2>
      <ul>
        <li><strong>Project Name:</strong> ${project.projectName || 'Not specified'}</li>
        <li><strong>Project Description:</strong> ${project.projectDescription || 'Not specified'}</li>
        <li><strong>Vision:</strong> ${project.projectVision || 'Not specified'}</li>
        <li><strong>Scientific References:</strong> ${project.scientificReferences || 'Not specified'}</li>
        <li><strong>Credential Links:</strong> ${project.credentialLinks || 'Not specified'}</li>
        <li><strong>Team Members:</strong> ${project.teamMembers || 'Not specified'}</li>
        <li><strong>Motivation:</strong> ${project.motivation || 'Not specified'}</li>
        <li><strong>Progress:</strong> ${project.progress || 'Not specified'}</li>
        <li><strong>Full Name:</strong> ${project.fullName || 'Not specified'}</li>
        <li><strong>Email:</strong> ${project.email || 'Not specified'}</li>
        <li><strong>Wallet:</strong> ${project.wallet || 'Not specified'}</li>
        <li><strong>Referral Code:</strong> ${project.referralCode || 'Not specified'}</li>
        <li><strong>Referred By:</strong> ${project.referredById || 'Not specified'}</li>
        <li><strong>Project ID:</strong> ${project.id || 'Not specified'}</li>
      </ul>
      <h2>🌐 Community Stats</h2>
      <ul>
        <li><strong>Discord Members:</strong> ${project.Discord?.memberCount || 0}</li>
        <li><strong>Papers Shared:</strong> ${project.Discord?.papersShared || 0}</li>
        <li><strong>Messages Count:</strong> ${project.Discord?.messagesCount || 0}</li>
        <li><strong>Discord Server Name:</strong> ${project.Discord?.serverName || 'Not specified'}</li>
        <li><strong>Discord Server ID:</strong> ${project.Discord?.serverId || 'Not specified'}</li>
        <li><strong>Discord Verified:</strong> ${project.Discord?.verified ? 'Yes' : 'No'}</li>
        <li><strong>Discord Bot Added:</strong> ${project.Discord?.botAdded ? 'Yes' : 'No'}</li>
      </ul>
      <h2>🔗 Discord Invite Link</h2>
      <p>${project.Discord?.inviteLink || 'Not provided'}</p>
      <p>Please reach out to this user to discuss next steps and provide sandbox access.</p>
    `;

    const data = await Promise.all(
      SANDBOX_NOTIFICATION_EMAILS.map(email =>
        mg.messages.create(MAILGUN_DOMAIN, {
          from: FROM_EMAIL,
          to: email,
          subject: subject,
          text: message,
          html: html,
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
