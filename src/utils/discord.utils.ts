import axios from 'axios';
import dotenv from 'dotenv';
import prisma from '../services/db.service';

// Initialize environment variables
dotenv.config();


// Discord bot configuration
const DISCORD_BOT_CONFIG = {
  clientId: process.env.DISCORD_CLIENT_ID || '1361285493521907832',
  permissions: '8', // Administrator permissions
  scope: 'bot',
  baseUrl: 'https://discord.com/api/oauth2/authorize',
};

/**
 * Checks Discord-related level progress and performs level-ups if conditions are met
 * @param project - The project to check level progress for
 * @returns True if a level-up occurred, false otherwise
 */
export async function checkDiscordLevelProgress(project: any): Promise<boolean> {
  try {
    if (!project || !project.Discord) {
      console.log(`[Level Check] Project ${project?.id} has no Discord data, skipping check`);
      return false;
    }

    const discord = project.Discord;
    const currentLevel = project.level;
    let leveledUp = false;
    let newLevel = currentLevel;

    // Level 2 to 3: Check if they have Discord server with enough members
    if (currentLevel === 2 && discord.botAdded && discord.memberCount >= 4) {
      console.log(
        `[Level Check] Project ${project.id} meets level 3 requirement: ${discord.memberCount} members`
      );
      leveledUp = true;
      newLevel = 3;
    }
    // Level 3 to 4: Check Discord metrics (members, messages, papers)
    else if (
      currentLevel === 3 &&
      discord.memberCount >= 10 &&
      discord.papersShared >= 25 &&
      discord.messagesCount >= 100
    ) {
      console.log(
        `[Level Check] Project ${project.id} meets level 4 requirements: ` +
          `${discord.memberCount}/10 members, ${discord.papersShared}/25 papers, ${discord.messagesCount}/100 messages`
      );
      leveledUp = true;
      newLevel = 4;
    }

    // If conditions are met, perform the level-up
    if (leveledUp) {
      console.log(
        `[Level Check] Leveling up project ${project.id} from ${currentLevel} to ${newLevel}`
      );

      // Update the project level
      await prisma.project.update({
        where: { id: project.id },
        data: { level: newLevel },
      });

      // If the user has an email, send a level-up email
      if (project.members && project.members.length > 0 && project.members[0].bioUser.email) {
        try {
          // This would typically call an email service
          console.log(`Level-up email would be sent to ${project.members[0].bioUser.email} for level ${newLevel}`);
        } catch (emailError) {
          console.error('Error sending level-up email:', emailError);
        }
      }

      // If level 4 (sandbox) is reached, send an email to BioDAO team
      if (newLevel === 4) {
        try {
          // This would typically call an email service to notify the team
          console.log(`Sandbox notification email would be sent for project ${project.id}`);
        } catch (emailError) {
          console.error('Error sending sandbox notification email:', emailError);
        }
      }

      return true;
    }

    return false;
  } catch (error) {
    console.error('Error checking Discord level progress:', error);
    return false;
  }
}

/**
 * Checks if the bot is installed on a Discord server
 * @param projectId - The project ID to check bot installation status for
 * @returns Object containing installation status and installation link
 */
export async function checkBotInstallationStatus(
  projectId: string
): Promise<{ installed: boolean; installationLink: string | null }> {
  try {
    // Get Discord record for the project
    const discord = await prisma.discord.findUnique({
      where: { projectId },
    });

    // If no Discord record exists or bot is not added
    if (!discord || !discord.botAdded) {
      // Generate installation link
      const installationLink = `${DISCORD_BOT_CONFIG.baseUrl}?client_id=${DISCORD_BOT_CONFIG.clientId}&permissions=${DISCORD_BOT_CONFIG.permissions}&scope=${DISCORD_BOT_CONFIG.scope}`;

      return {
        installed: false,
        installationLink,
      };
    }

    // Bot is installed
    return {
      installed: true,
      installationLink: null,
    };
  } catch (error) {
    console.error('Error checking bot installation status:', error);

    // Return default values in case of error
    return {
      installed: false,
      installationLink: `${DISCORD_BOT_CONFIG.baseUrl}?client_id=${DISCORD_BOT_CONFIG.clientId}&permissions=${DISCORD_BOT_CONFIG.permissions}&scope=${DISCORD_BOT_CONFIG.scope}`,
    };
  }
}

export function getBotInstallationUrl(
  clientId: string,
  permissions: string,
  serverId: string,
  verificationToken: string
): string {
  return `https://discord.com/api/oauth2/authorize?client_id=${clientId}&permissions=${permissions}&scope=bot&guild_id=${serverId}&state=${verificationToken}`;
}

/**
 * Extracts Discord server information from a message or invite link
 * @param message - The Discord invite message or link
 * @returns Extracted Discord information
 */
export function extractDiscordInfo(message: string): {
  serverId: string | null;
  inviteLink: string | null;
  inviteCode: string | null;
} {
  const result = {
    serverId: null as string | null,
    inviteLink: null as string | null,
    inviteCode: null as string | null,
  };

  // Check for direct server IDs (rare but possible)
  const serverIdMatch = message.match(/\b(\d{17,20})\b/);
  if (serverIdMatch) {
    result.serverId = serverIdMatch[1];
  }

  // Check for Discord invite links
  const inviteLinkRegex =
    /(https?:\/\/)?(www\.)?(discord\.(gg|io|me|li)|discordapp\.com\/invite)\/([a-zA-Z0-9-]{2,32})/i;
  const inviteMatch = message.match(inviteLinkRegex);

  if (inviteMatch) {
    const fullInviteLink = inviteMatch[0];
    const inviteCode = inviteMatch[5];

    result.inviteLink = fullInviteLink;
    result.inviteCode = inviteCode;
  }

  return result;
}

/**
 * Get the requirements for advancing to the next level
 * @param currentLevel Current level
 * @returns Array of requirements
 */
export function getNextLevelRequirements(currentLevel: number): string[] {
  switch (currentLevel) {
    case 1:
      return [
        "Mint Idea NFT",
        "Mint Vision/Hypothesis NFT",
      ];
    case 2:
      return [
        "Create and set up Discord server",
        "Install verification bot",
        "Have at least 4 Discord members",
      ];
    case 3:
      return [
        "Have at least 10 Discord members",
        "Share at least 25 scientific papers in Discord",
        "Have at least 100 quality messages in Discord",
      ];
    case 4:
      return [
        "Connect Twitter account",
        "Publish 3 introductory tweets about your DAO",
      ];
    case 5:
      return [
        "Have at least 10 verified scientists in your community",
        "Host a Twitter Space",
      ];
    case 6:
      return [
        "Write and publish a visionary blogpost",
        "Convert blogpost into Twitter thread",
      ];
    case 7:
      return [
        "All requirements completed!",
        "Continue growing your community and scientific impact",
      ];
    default:
      return ["Unknown level"];
  }
}

/**
 * Get papers shared in a Discord server
 * @param projectId - The project ID to get papers for
 * @returns Array of papers shared in the Discord server
 */
export async function getDiscordPapers(projectId: string): Promise<any[]> {
  try {
    const discord = await prisma.discord.findUnique({
      where: { projectId },
      include: {
        papers: {
          orderBy: { sharedAt: 'desc' },
          take: 50 // Limit to last 50 papers
        }
      }
    });

    return discord?.papers || [];
  } catch (error) {
    console.error('Error fetching Discord papers:', error);
    return [];
  }
}

/**
 * Get paper sharing statistics for a Discord server
 * @param projectId - The project ID to get stats for
 * @returns Paper sharing statistics
 */
export async function getDiscordPaperStats(projectId: string): Promise<{
  totalPapers: number;
  uniqueContributors: number;
  platformBreakdown: Record<string, number>;
  recentActivity: number; // Papers shared in last 7 days
}> {
  try {
    const discord = await prisma.discord.findUnique({
      where: { projectId },
      include: {
        papers: true
      }
    });

    if (!discord || !discord.papers) {
      return {
        totalPapers: 0,
        uniqueContributors: 0,
        platformBreakdown: {},
        recentActivity: 0
      };
    }

    const papers = discord.papers;
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    // Calculate statistics
    const totalPapers = papers.length;
    const uniqueContributors = new Set(papers.map(p => p.userId)).size;
    const recentActivity = papers.filter(p => p.sharedAt >= sevenDaysAgo).length;

    // Platform breakdown
    const platformBreakdown: Record<string, number> = {};
    papers.forEach(paper => {
      const platform = paper.platform || 'unknown';
      platformBreakdown[platform] = (platformBreakdown[platform] || 0) + 1;
    });

    return {
      totalPapers,
      uniqueContributors,
      platformBreakdown,
      recentActivity
    };
  } catch (error) {
    console.error('Error calculating Discord paper stats:', error);
    return {
      totalPapers: 0,
      uniqueContributors: 0,
      platformBreakdown: {},
      recentActivity: 0
    };
  }
}

/**
 * Get top paper contributors in a Discord server
 * @param projectId - The project ID to get contributors for
 * @param limit - Number of top contributors to return (default: 10)
 * @returns Array of top contributors with their paper counts
 */
export async function getTopPaperContributors(projectId: string, limit: number = 10): Promise<Array<{
  userId: string;
  username: string;
  paperCount: number;
  lastShared: Date;
}>> {
  try {
    const discord = await prisma.discord.findUnique({
      where: { projectId },
      include: {
        papers: {
          orderBy: { sharedAt: 'desc' }
        }
      }
    });

    if (!discord || !discord.papers) {
      return [];
    }

    // Group papers by user
    const userPapers = discord.papers.reduce((acc, paper) => {
      if (!acc[paper.userId]) {
        acc[paper.userId] = {
          userId: paper.userId,
          username: paper.username,
          papers: [],
          lastShared: paper.sharedAt
        };
      }
      acc[paper.userId].papers.push(paper);
      if (paper.sharedAt > acc[paper.userId].lastShared) {
        acc[paper.userId].lastShared = paper.sharedAt;
      }
      return acc;
    }, {} as Record<string, any>);

    // Convert to array and sort by paper count
    const contributors = Object.values(userPapers)
      .map(user => ({
        userId: user.userId,
        username: user.username,
        paperCount: user.papers.length,
        lastShared: user.lastShared
      }))
      .sort((a, b) => b.paperCount - a.paperCount)
      .slice(0, limit);

    return contributors;
  } catch (error) {
    console.error('Error getting top paper contributors:', error);
    return [];
  }
}
