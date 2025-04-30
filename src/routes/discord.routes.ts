import express from 'express';
import prisma from '../services/db.service';
import axios from 'axios';
import dotenv from 'dotenv';
import {
  checkBotInstallationStatus,
  extractDiscordInfo,
  getNextLevelRequirements,
} from '../utils/discord.utils';

// Load environment variables
dotenv.config();



// Get API key from environment
const API_KEY = process.env.API_KEY || process.env.PORTAL_API_KEY;

// Create router
const router = express.Router();

/**
 * GET /api/discord/:projectId - Get Discord stats with detailed progress information
 *
 * This endpoint retrieves Discord stats and calculates progress metrics for the given project
 * It's designed to support the CoreAgent interface on the client side
 */
router.get('/:projectId', async (req: any, res: any) => {
  try {
    const { projectId } = req.params;

    if (!projectId) {
      return res.status(400).json({
        success: false,
        error: 'Project ID is required',
      });
    }

    // Get the user data to check for Discord setup
    const project = await prisma.project.findUnique({
      where: { id: projectId },
      include: {
        Discord: true,
        NFTs: true,
      },
    });

    if (!project) {
      return res.status(404).json({
        success: false,
        error: 'Project not found',
      });
    }

    // Check if user has a Discord server registered
    if (!project.Discord) {
      return res.status(404).json({
        success: false,
        error: 'Discord server not set up',
        message: 'You have not set up a Discord server yet',
      });
    }

    // Get bot installation status
    const botStatus = await checkBotInstallationStatus(projectId);

    // Get the latest stats from the database
    const discordStats = project.Discord;
    const currentLevel = project.level;

    // Calculate progress based on level requirements
    let progress = {};

    if (currentLevel === 2) {
      // For level 2 - track members to reach 4
      progress = {
        members: {
          current: discordStats.memberCount,
          required: 4,
          percent: Math.min(100, Math.round((discordStats.memberCount / 4) * 100)),
        },
      };
    } else if (currentLevel === 3) {
      // For level 3 - track members, messages, papers
      progress = {
        members: {
          current: discordStats.memberCount,
          required: 5,
          percent: Math.min(100, Math.round((discordStats.memberCount / 5) * 100)),
        },
        messages: {
          current: discordStats.messagesCount,
          required: 50,
          percent: Math.min(100, Math.round((discordStats.messagesCount / 50) * 100)),
        },
        papers: {
          current: discordStats.papersShared,
          required: 5,
          percent: Math.min(100, Math.round((discordStats.papersShared / 5) * 100)),
        },
      };
    }

    // Next level requirements based on current level
    const requirements = getNextLevelRequirements(currentLevel);

    // Prepare response
    const response = {
      success: true,
      discord: {
        serverId: discordStats.serverId,
        serverName: discordStats.serverName || 'Your Discord Server',
        memberCount: discordStats.memberCount,
        messagesCount: discordStats.messagesCount,
        papersShared: discordStats.papersShared,
        botAdded: discordStats.botAdded,
        verified: discordStats.verified,
      },
      level: {
        current: currentLevel,
        requirements,
        progress,
      },
      botStatus: {
        installed: botStatus.installed,
        installationLink: botStatus.installationLink,
      },
    };

    return res.json(response);
  } catch (error) {
    console.error('Error fetching Discord stats for project:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to retrieve Discord stats',
    });
  }
});

/**
 * GET /api/discord/info/:serverId - Get Discord server info
 *
 * This endpoint retrieves information about a specific Discord server
 */
router.get('/info/:serverId', async (req: any, res: any) => {
  try {
    const { serverId } = req.params;

    if (!serverId) {
      return res.status(400).json({
        success: false,
        error: 'Server ID is required',
      });
    }

    // Look up the Discord server in the database
    const discord = await prisma.discord.findFirst({
      where: { serverId },
    });

    if (!discord) {
      return res.status(404).json({
        success: false,
        error: 'Discord server not found',
      });
    }

    // Return the Discord server info
    return res.json({
      success: true,
      discord,
    });
  } catch (error) {
    console.error('Error fetching Discord server info:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to retrieve Discord server info',
    });
  }
});

/**
 * POST /api/discord/setup - Set up Discord server for a project
 *
 * This endpoint processes a Discord invite link and sets up the server for a project
 */
router.post('/setup', async (req: any, res: any) => {
  try {
    const { userId, discordInvite } = req.body;

    if (!userId || !discordInvite) {
      return res.status(400).json({
        success: false,
        message: 'Missing userId or discordInvite',
      });
    }

    // Extract Discord info from the invite link
    const discordInfo = extractDiscordInfo(discordInvite);

    if (!discordInfo.inviteCode) {
      return res.status(400).json({
        success: false,
        message: 'Invalid Discord invite link',
      });
    }

    // Fetch Discord server info
    try {
      const serverInfo = await axios.get(
        `https://discord.com/api/v10/invites/${discordInfo.inviteCode}?with_counts=true`
      );

      // Check if the server exists
      if (!serverInfo.data || !serverInfo.data.guild) {
        return res.status(400).json({
          success: false,
          message: 'Invalid Discord server or invite expired',
        });
      }

      const guild = serverInfo.data.guild;
      const serverId = guild.id;
      const serverName = guild.name;
      const memberCount = serverInfo.data.approximate_member_count || 0;

      // Find the project
      const project = await prisma.project.findUnique({
        where: { id: userId },
      });

      if (!project) {
        return res.status(404).json({
          success: false,
          message: 'Project not found',
        });
      }

      // Check if Discord entry already exists for this project
      const existingDiscord = await prisma.discord.findUnique({
        where: { projectId: userId },
      });

      if (existingDiscord) {
        // Update existing Discord entry
        await prisma.discord.update({
          where: { projectId: userId },
          data: {
            serverId,
            serverName,
            memberCount,
            inviteLink: discordInvite,
          },
        });
      } else {
        // Create new Discord entry
        await prisma.discord.create({
          data: {
            serverId,
            serverName,
            memberCount,
            inviteLink: discordInvite,
            projectId: userId,
            papersShared: 0,
            messagesCount: 0,
            qualityScore: 0,
          },
        });
      }

      return res.status(200).json({
        success: true,
        message: 'Discord server registered successfully',
        data: {
          serverId,
          serverName,
          memberCount,
        },
      });
    } catch (error) {
      console.error('Error fetching Discord server info:', error);
      return res.status(400).json({
        success: false,
        message: 'Failed to verify Discord server. Please check your invite link.',
      });
    }
  } catch (error) {
    console.error('Error in Discord setup:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
});

/**
 * GET /api/projects/:projectId/discord - Get Discord server for a project
 *
 * This endpoint retrieves the Discord server info for a specific project
 */
router.get('/projects/:projectId/discord', async (req: any, res: any) => {
  try {
    const { projectId } = req.params;

    if (!projectId) {
      return res.status(400).json({
        success: false,
        error: 'Project ID is required',
      });
    }

    // Look up the Discord server in the database
    const discord = await prisma.discord.findUnique({
      where: { projectId },
    });

    if (!discord) {
      return res.status(404).json({
        success: false,
        error: 'Discord server not found for this project',
      });
    }

    // Return the Discord server info
    return res.json({
      success: true,
      discord,
    });
  } catch (error) {
    console.error('Error fetching Discord server for project:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to retrieve Discord server',
    });
  }
});

/**
 * GET /api/debug/discord-stats/:serverId - Get detailed Discord stats for debugging
 *
 * This endpoint provides detailed Discord stats for a server, including database and live metrics
 */
router.get('/debug/discord-stats/:serverId', async (req: any, res: any) => {
  try {
    const { serverId } = req.params;
    const { apiKey } = req.query;

    // Verify API key for debugging endpoints
    if (apiKey !== API_KEY) {
      return res.status(401).json({
        success: false,
        error: 'Unauthorized',
      });
    }

    if (!serverId) {
      return res.status(400).json({
        success: false,
        error: 'Server ID is required',
      });
    }

    // Look up the Discord server in the database
    const discord = await prisma.discord.findFirst({
      where: { serverId },
    });

    if (!discord) {
      return res.status(404).json({
        success: false,
        error: 'Discord server not found',
      });
    }

    // Get the associated project
    const project = await prisma.project.findUnique({
      where: { id: discord.projectId },
    });

    // Return detailed Discord stats
    return res.json({
      success: true,
      discord: {
        databaseStats: {
          serverId: discord.serverId,
          serverName: discord.serverName,
          memberCount: discord.memberCount,
          messagesCount: discord.messagesCount,
          papersShared: discord.papersShared,
          qualityScore: discord.qualityScore,
          projectId: discord.projectId,
          botAdded: discord.botAdded,
          verified: discord.verified,
        },
        project: {
          id: project?.id,
          level: project?.level,
        },
      },
    });
  } catch (error) {
    console.error('Error fetching debug Discord stats:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to retrieve Discord stats',
    });
  }
});

// Bot-related endpoints (no /api prefix)

/**
 * POST /discord/bot-installed - Handle Discord bot installation notification
 *
 * This endpoint is called by the Discord bot when it is installed in a server
 */
router.post('/bot-installed', async (req: any, res: any) => {
  try {
    // Verify API key
    const apiKey = req.body.apiKey || req.headers.authorization?.replace('Bearer ', '');
    if (apiKey !== API_KEY) {
      return res.status(401).json({ success: false, error: 'Unauthorized' });
    }

    const { guildId, guildName, memberCount } = req.body;

    if (!guildId) {
      return res.status(400).json({ success: false, error: 'Guild ID is required' });
    }

    console.log(`Bot installed on guild: ${guildName} (${guildId}), Members: ${memberCount}`);

    // Find the Discord record for this server
    const discord = await prisma.discord.findFirst({
      where: { serverId: guildId },
    });

    if (!discord) {
      console.log(`No Discord record found for guild ${guildId}`);
      return res.json({
        success: true,
        message: 'Bot installed, but guild not registered in system',
      });
    }

    // Update the Discord record to mark bot as installed
    await prisma.discord.update({
      where: { id: discord.id },
      data: {
        botAdded: true,
        botAddedAt: new Date(),
        memberCount: memberCount || discord.memberCount,
      },
    });

    // Return success
    return res.json({ success: true, message: 'Bot installation recorded successfully' });
  } catch (error) {
    console.error('[API] Error handling bot installation:', error);
    return res.status(500).json({ success: false, error: 'Server error' });
  }
});

/**
 * POST /discord/stats-update - Handle Discord stats updates
 *
 * This endpoint is called by the Discord bot to update server statistics
 */
router.post('/stats-update', async (req: any, res: any) => {
  try {
    // Verify API key
    const apiKey = req.body.apiKey || req.headers.authorization?.replace('Bearer ', '');
    if (apiKey !== API_KEY) {
      return res.status(401).json({ success: false, error: 'Unauthorized' });
    }

    const { guildId, memberCount, messagesCount, papersShared, qualityScore } = req.body;

    if (!guildId) {
      return res.status(400).json({ success: false, error: 'Guild ID is required' });
    }

    // Find the Discord record for this server
    const discord = await prisma.discord.findFirst({
      where: { serverId: guildId },
    });

    if (!discord) {
      console.log(`No Discord record found for guild ${guildId}`);
      return res.json({
        success: true,
        message: 'Stats received, but guild not registered in system',
      });
    }

    // Update the Discord record with new stats
    await prisma.discord.update({
      where: { id: discord.id },
      data: {
        memberCount: memberCount !== undefined ? memberCount : discord.memberCount,
        messagesCount: messagesCount !== undefined ? messagesCount : discord.messagesCount,
        papersShared: papersShared !== undefined ? papersShared : discord.papersShared,
        qualityScore: qualityScore !== undefined ? qualityScore : discord.qualityScore,
        updatedAt: new Date(),
      },
    });

    // Log stats update
    console.log(
      `[API] Discord stats updated for guild ${guildId}: Members=${memberCount}, Messages=${messagesCount}, Papers=${papersShared}`
    );

    // Return success
    return res.json({ success: true, message: 'Stats updated successfully' });
  } catch (error) {
    console.error('[API] Error updating stats:', error);
    return res.status(500).json({ success: false, error: 'Server error' });
  }
});

/**
 * POST /discord/check-level-requirements - Check if a guild meets level-up requirements
 *
 * This endpoint is called by the Discord bot to check if a guild meets level-up requirements
 */
router.post('/check-level-requirements', async (req: any, res: any) => {
  try {
    // Verify API key
    const apiKey = req.body.apiKey || req.headers.authorization?.replace('Bearer ', '');
    if (apiKey !== API_KEY) {
      return res.status(401).json({ success: false, error: 'Unauthorized' });
    }

    const { guildId, source, event } = req.body;

    if (!guildId) {
      return res.status(400).json({ success: false, error: 'Missing guild ID' });
    }

    console.log(
      `[Level Check] Checking level requirements for guild ${guildId}, triggered by: ${source || 'unknown'}, event: ${event || 'unknown'}`
    );

    // Find the Discord guild record
    const discord = await prisma.discord.findFirst({
      where: { serverId: guildId },
    });

    if (!discord) {
      return res.status(404).json({ success: false, error: 'Discord server not found' });
    }

    // Get the associated project
    const project = await prisma.project.findUnique({
      where: { id: discord.projectId },
      include: {
        Discord: true,
        NFTs: true,
      },
    });

    if (!project) {
      return res.status(404).json({ success: false, error: 'Project not found' });
    }

    // Get the current level before any changes
    const previousLevel = project.level;

    // Check for level-up conditions
    let levelUp = false;
    let newLevel = previousLevel;

    // Level 2 to 3: Check if they have enough members (4+)
    if (previousLevel === 2 && discord.botAdded && discord.memberCount >= 4) {
      levelUp = true;
      newLevel = 3;
    }
    // Level 3 to 4: Check Discord metrics
    else if (
      previousLevel === 3 &&
      discord.memberCount >= 5 &&
      discord.papersShared >= 5 &&
      discord.messagesCount >= 50
    ) {
      levelUp = true;
      newLevel = 4;
    }

    // If we should level up, perform the level-up
    if (levelUp) {
      console.log(
        `[Level Check] Leveling up project ${project.id} from ${previousLevel} to ${newLevel}`
      );

      // Update the project level
      await prisma.project.update({
        where: { id: project.id },
        data: { level: newLevel },
      });

      // If the user has an email, send a level-up email
      if (project.email) {
        try {
          // This would be implemented elsewhere
          // await sendLevelUpEmail(project.email, newLevel);
          console.log(`Level-up email sent to ${project.email} for level ${newLevel}`);
        } catch (emailError) {
          console.error('Error sending level-up email:', emailError);
        }
      }

      // If level 4 (sandbox) is reached, send an email to BioDAO team
      if (newLevel === 4) {
        try {
          // This would be implemented elsewhere
          // await sendSandboxEmail(project);
          console.log(`Sandbox notification email sent for project ${project.id}`);
        } catch (emailError) {
          console.error('Error sending sandbox notification email:', emailError);
        }
      }

      return res.json({
        success: true,
        levelUp: true,
        previousLevel,
        newLevel,
        message: `Successfully leveled up from ${previousLevel} to ${newLevel}`,
      });
    }

    // If no level-up occurred, return current status
    return res.json({
      success: true,
      levelUp: false,
      currentLevel: previousLevel,
      message: 'No level-up requirements met',
      metrics: {
        memberCount: discord.memberCount,
        papersShared: discord.papersShared,
        messagesCount: discord.messagesCount,
      },
    });
  } catch (error) {
    console.error('Error checking level requirements:', error);
    return res.status(500).json({ success: false, error: 'Server error' });
  }
});

/**
 * POST /discord/bot-events - Handle Discord bot events
 *
 * This endpoint is a general purpose handler for Discord bot events
 */
router.post('/bot-events', async (req: any, res: any) => {
  try {
    // Verify API key
    const apiKey = req.body.apiKey || req.headers.authorization?.replace('Bearer ', '');
    if (apiKey !== API_KEY) {
      return res.status(401).json({ success: false, error: 'Unauthorized' });
    }

    const { event, guildId, memberCount, messagesCount, papersShared, qualityScore } = req.body;

    if (!guildId) {
      return res.status(400).json({ success: false, error: 'Guild ID is required' });
    }

    // Log the event
    console.log(`[API] Discord bot event received (${event}): guildId=${guildId}`);

    // Find the Discord record for this server
    const discord = await prisma.discord.findFirst({
      where: { serverId: guildId },
    });

    if (!discord) {
      console.log(`No Discord record found for guild ${guildId}`);
      return res.json({
        success: true,
        message: 'Event received, but guild not registered in system',
      });
    }

    // We don't need to update anything for this endpoint, it's just for event tracking and logging

    // Return success
    return res.json({ success: true, message: 'Event processed successfully' });
  } catch (error) {
    console.error('[API] Error processing bot event:', error);
    return res.status(500).json({ success: false, error: 'Server error' });
  }
});

export default router;
