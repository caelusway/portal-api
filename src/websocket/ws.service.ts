import { WebSocketServer, WebSocket } from 'ws';
import http from 'http';
import { processMessage } from '../ai';
import prisma, {
  ChatSessionService,
  ChatMessageService,
  ProjectService,
  DiscordService,
  NFTService,
} from '../services/db.service';
import { extractDiscordInfo } from '../utils/helpers';
import { mintIdeaNft, mintVisionNft } from '../nft-service';
import { generateIdeaNFTImage, generateVisionNFTImage } from '../image-generation-service';
import { fetchDiscordServerInfo } from '../services/discord.service';
import config from '../config';
import { getBotInstallationUrl } from '../utils/discord.utils';

// Map to store active WebSocket connections by user ID
const activeConnections: Record<string, WebSocket> = {};

/**
 * Gets an existing chat session or creates a new one for a user
 * @param userId User ID
 * @returns Chat session ID
 */
async function getOrCreateChatSession(userId: string): Promise<string> {
  try {
    // Always check for any existing session, with no time restriction
    const existingSession = await prisma.chatSession.findFirst({
      where: {
        projectId: userId,
      },
      orderBy: {
        updatedAt: 'desc',
      },
    });

    if (existingSession) {
      // Update the session's updated_at timestamp
      await prisma.chatSession.update({
        where: { id: existingSession.id },
        data: { updatedAt: new Date() },
      });
      console.log(`Using existing chat session ${existingSession.id} for user ${userId}`);
      return existingSession.id;
    }

    // Create a new session only if no previous sessions exist
    const newSession = await prisma.chatSession.create({
      data: {
        projectId: userId,
        updatedAt: new Date(),
      },
    });

    console.log(`Created new chat session ${newSession.id} for user ${userId} (first-time user)`);
    return newSession.id;
  } catch (error) {
    console.error('Error managing chat session:', error);
    throw error;
  }
}

/**
 * Saves a chat message to the database
 * @param sessionId Chat session ID
 * @param content Message content (string or object with content property)
 * @param isFromAgent Whether the message is from the agent
 * @param actionTaken Optional action that was taken
 * @param actionSuccess Optional success status of the action
 */
async function saveChatMessage(
  sessionId: string,
  content: string | { content: string },
  isFromAgent: boolean,
  actionTaken?: string,
  actionSuccess?: boolean
): Promise<void> {
  try {
    const messageContent = typeof content === 'string' ? content : content.content;

    await prisma.chatMessage.create({
      data: {
        sessionId,
        content: messageContent,
        isFromAgent,
        actionTaken,
        actionSuccess,
      },
    });
  } catch (error) {
    console.error('Error saving chat message:', error);
    // Don't throw - we don't want to interrupt the user experience if message saving fails
  }
}

/**
 * Initialize WebSocket server
 * @param server HTTP server instance
 * @returns WebSocket server instance
 */
function initWebSocketServer(server: http.Server): WebSocketServer {
  const wss = new WebSocketServer({ server });

  wss.on('connection', (ws) => {
    console.log('Client connected to WebSocket');

    // Handle client messages
    ws.on('message', async (message) => {
      try {
        const data = JSON.parse(message.toString());
        console.log('Received message type:', data.type);

        switch (data.type) {
          case 'auth': {
            await handleAuthentication(ws, data);

            // After authentication, check for pending bot notifications
            // Extract userId from different possible formats
            const userId = data.userId || (data.project && data.project.id);
            if (userId) {
              console.log(`Checking for pending notifications after auth for user ${userId}`);
              //checkForPendingBotNotifications(ws, userId);
            } else {
              console.log(`Cannot check for pending notifications: No user ID in auth message`);
            }
            break;
          }
          case 'message': {
            // Try to extract userId from the message or active connections
            let userId = data.userId; // First try to get from message payload

            if (!userId) {
              // If not in message, find from active connections
              for (const id in activeConnections) {
                if (activeConnections[id] === ws) {
                  userId = id;
                  console.log(`Retrieved userId ${userId} from active connections`);
                  break;
                }
              }
            }

            // Add userId to data for downstream handlers
            if (userId) {
              data.userId = userId;
            }

            if (data.content) {
              await handleMessage(ws, data);
            } else {
              console.error('Invalid message format: missing content');
              ws.send(JSON.stringify({ type: 'error', message: 'Invalid message format' }));
            }
            break;
          }
          case 'get_nfts': {
            // Fetch NFTs for the user from our database
            await handleGetNFTs(ws, data.userId);
            break;
          }
          case 'fetch_discord': {
            // This will send Discord info back to the client if available
            await handleCheckDiscordStats(ws, data.userId);
            break;
          }
          case 'bot_installed': {
            // Handle notification that a Discord bot was installed
            if (data.userId && data.guildId && data.memberCount) {
              await handleBotInstalled(ws, data.userId, {
                guildId: data.guildId,
                guildName: data.guildName,
                memberCount: data.memberCount,
              });
              const latestProject = await ProjectService.getById(data.userId);
              await checkAndPerformLevelUp(latestProject, ws);
            } else {
              console.error('Invalid bot_installed message format');
              ws.send(
                JSON.stringify({
                  type: 'error',
                  message: 'Invalid bot_installed format. Required: userId, guildId, memberCount',
                })
              );
            }
            break;
          }
          case 'handle_discord_bot_callback': {
            // Handle callback from Discord bot installation
            if (data.serverId && data.token) {
              // ToDo: Implement verification logic
              console.log('Discord bot callback received:', data);

              // For now, just confirm the message was received
              ws.send(
                JSON.stringify({
                  type: 'discord_callback_received',
                  success: true,
                })
              );
            }
            break;
          }
          default:
            console.log('Unknown message type:', data.type);
        }
      } catch (error) {
        console.error('Error handling WebSocket message:', error);
        ws.send(JSON.stringify({ type: 'error', message: 'Invalid message format' }));
      }
    });

    // Handle client disconnect
    ws.on('close', () => {
      console.log('Client disconnected from WebSocket');
      // Remove this connection from activeConnections
      for (const userId in activeConnections) {
        if (activeConnections[userId] === ws) {
          console.log(`Removing connection for user ${userId}`);
          delete activeConnections[userId];
          break;
        }
      }
    });
  });

  return wss;
}

/**
 * Checks if there are any recent bot installations that need to be notified to the user
 * @param ws WebSocket connection
 * @param userId User ID
 */
async function checkForPendingBotNotifications(ws: WebSocket, userId: string): Promise<void> {
  try {
    console.log(`Checking for pending bot notifications for user ${userId}`);

    // Look for Discord records with recent bot installations
    const recentBotInstallations = await prisma.discord.findMany({
      where: {
        projectId: userId,
        botAdded: true,
        botAddedAt: {
          // Check for bot installations in the last 24 hours
          gte: new Date(Date.now() -  60 * 1000),
        },
      },
    });

    if (recentBotInstallations.length > 0) {
      console.log(
        `Found ${recentBotInstallations.length} recent bot installations for user ${userId}`
      );

      // If we have one or more recent bot installations, send a notification
      for (const installation of recentBotInstallations) {
        // Look up the recent message in chat history
        const sessionId = await getOrCreateChatSession(userId);

        const recentMessages = await prisma.chatMessage.findMany({
          where: {
            sessionId,
            actionTaken: 'BOT_ADDED',
            isFromAgent: true,
            timestamp: {
              gte: new Date(Date.now() - 24 * 60 * 60 * 1000),
            },
          },
          orderBy: {
            timestamp: 'desc',
          },
          take: 1,
        });

        if (recentMessages.length > 0) {
          console.log(
            `Found recent bot installation message for user ${userId}, sending notification`
          );

          // Send the stored message to the client
          ws.send(
            JSON.stringify({
              type: 'message',
              content: recentMessages[0].content,
              action: 'BOT_ADDED',
              isFromAgent: true,
              wasDelayed: true, // Flag to indicate this was a delayed notification
            })
          );

          // Also send the Discord stats update
          ws.send(
            JSON.stringify({
              type: 'discord_bot_installed',
              discord: {
                memberCount: installation.memberCount || 0,
                papersShared: installation.papersShared || 0,
                messagesCount: installation.messagesCount || 0,
                qualityScore: installation.qualityScore || 0,
                verified: true,
                serverName: installation.serverName || 'Your Discord Server',
                botAdded: true,
                serverId: installation.serverId,
              },
            })
          );
        } else {
          // If no message was found but we know a bot was added, create a generic message
          const botAddedMessage = {
            content: `## Discord Bot Successfully Added! 🎉

**Great news!** The verification bot has been successfully added to your Discord server "${installation.serverName || 'Your Discord Server'}".

### Current Stats:
- **Members:** ${installation.memberCount || 0} ${installation.memberCount === 1 ? 'member' : 'members'}
- **Messages:** ${installation.messagesCount || 0}
- **Papers shared:** ${installation.papersShared || 0}

Your Discord server is now fully verified and stats are being tracked automatically.`,
          };

          ws.send(
            JSON.stringify({
              type: 'message',
              content: botAddedMessage.content,
              action: 'BOT_ADDED',
              isFromAgent: true,
              wasDelayed: true,
            })
          );

          // Also send the Discord stats update
          ws.send(
            JSON.stringify({
              type: 'discord_bot_installed',
              discord: {
                memberCount: installation.memberCount || 0,
                papersShared: installation.papersShared || 0,
                messagesCount: installation.messagesCount || 0,
                qualityScore: installation.qualityScore || 0,
                verified: true,
                serverName: installation.serverName || 'Your Discord Server',
                botAdded: true,
                serverId: installation.serverId,
              },
            })
          );
        }
      }
    } else {
      console.log(`No recent bot installations found for user ${userId}`);
    }
  } catch (error) {
    console.error(`Error checking for pending bot notifications: ${error}`);
  }
}

/**
 * Handle authentication messages
 * @param ws WebSocket connection
 * @param data Authentication data
 */
async function handleAuthentication(ws: WebSocket, data: any): Promise<void> {
  try {
    const { wallet, privyId } = data;

    if (!wallet && !privyId) {
      ws.send(
        JSON.stringify({
          type: 'error',
          message: 'Wallet address or Privy ID is required',
        })
      );
      return;
    }

    // First try to find user by privyId if provided
    let project = null;
    if (privyId) {
      project = await ProjectService.getByPrivyId(privyId);
    }

    // If not found by privyId, try wallet
    if (!project && wallet) {
      project = await ProjectService.getByWallet(wallet);

      if (project && privyId) {
        // Update existing user with privyId
        project = await ProjectService.update(project.id, { privyId });
      }
    }

    // If still not found, create a new user
    if (!project && (wallet || privyId)) {
      const data: any = {};
      if (wallet) data.wallet = wallet;
      if (privyId) data.privyId = privyId;
      data.level = 1;

      project = await ProjectService.create(data);
    }

    if (!project) {
      ws.send(
        JSON.stringify({
          type: 'error',
          message: 'Failed to authenticate user',
        })
      );
      return;
    }

    // Store active connection
    activeConnections[project.id] = ws;

    // Send success response
    ws.send(
      JSON.stringify({
        type: 'auth_success',
        userId: project.id,
        level: project.level,
      })
    );

    // Check for any bot installations that happened while the user was offline
    //checkForPendingBotNotifications(ws, project.id);

    // Send initial data
    handleInitialConnection(ws, project);
  } catch (error) {
    console.error('Authentication error:', error);
    ws.send(
      JSON.stringify({
        type: 'error',
        message: 'Authentication failed',
      })
    );
  }
}

/**
 * Handle message from user
 * @param ws WebSocket connection
 * @param data Message data
 */
async function handleMessage(ws: WebSocket, data: any): Promise<void> {
  try {
    // Check data validity
    if (!data.content) {
      ws.send(
        JSON.stringify({
          type: 'error',
          message: 'Message content is required',
        })
      );
      return;
    }

    // Find user ID from active connections
    let userId = null;
    for (const id in activeConnections) {
      if (activeConnections[id] === ws) {
        userId = id;
        break;
      }
    }

    if (!userId) {
      ws.send(
        JSON.stringify({
          type: 'error',
          message: 'Not authenticated',
        })
      );
      return;
    }

    // Get user data
    const project = await ProjectService.getById(userId);
    if (!project) {
      ws.send(
        JSON.stringify({
          type: 'error',
          message: 'User not found',
        })
      );
      return;
    }

    // Get or create chat session
    const sessionId = await ChatSessionService.getOrCreateForUser(userId);

    // Save the user message
    await ChatMessageService.saveMessage(sessionId, data.content, false);

    // Check for potential actions (Discord setup, NFT minting, etc.)
    const actionTaken = await handlePotentialActions(ws, userId, project, data.content, '');

    // If no action was taken directly, use the AI to respond
    if (actionTaken.length === 0) {
      await handleAIInteraction(ws, userId, data.content, project.fullName || 'User');
    }
  } catch (error) {
    console.error('Error handling message:', error);
    ws.send(
      JSON.stringify({
        type: 'error',
        message: 'Failed to process message',
      })
    );
  }
}

/**
 * Handle fetching NFTs for a user
 * @param ws WebSocket connection
 * @param userId User ID
 */
async function handleGetNFTs(ws: WebSocket, userId: string): Promise<void> {
  try {
    // Validate the user ID
    if (!userId) {
      // Try to find the user ID from active connections
      for (const id in activeConnections) {
        if (activeConnections[id] === ws) {
          userId = id;
          break;
        }
      }

      if (!userId) {
        ws.send(
          JSON.stringify({
            type: 'error',
            message: 'User ID is required',
          })
        );
        return;
      }
    }

    const nfts = await NFTService.getByProjectId(userId);

    ws.send(
      JSON.stringify({
        type: 'nfts',
        nfts,
      })
    );
  } catch (error) {
    console.error('Error fetching NFTs:', error);
    ws.send(
      JSON.stringify({
        type: 'error',
        message: 'Failed to fetch NFTs',
      })
    );
  }
}

/**
 * Handle checking Discord stats for a user
 * @param ws WebSocket connection
 * @param userId User ID
 */
async function handleCheckDiscordStats(ws: WebSocket, userId: string): Promise<void> {
  try {
    // Validate the user ID
    if (!userId) {
      // Try to find the user ID from active connections
      for (const id in activeConnections) {
        if (activeConnections[id] === ws) {
          userId = id;
          break;
        }
      }

      if (!userId) {
        ws.send(
          JSON.stringify({
            type: 'error',
            message: 'User ID is required',
          })
        );
        return;
      }
    }

    const project = await ProjectService.getById(userId);
    if (!project) {
      ws.send(
        JSON.stringify({
          type: 'error',
          message: 'User not found',
        })
      );
      return;
    }

    // Get Discord info if available
    const discord = project.Discord;
    if (!discord) {
      ws.send(
        JSON.stringify({
          type: 'discord_info',
          discord: null,
          message: 'No Discord server connected',
        })
      );
      return;
    }

    // Get the bot installation status
    const botStatus = await getBotInstallationStatus(userId);

    // Send the Discord info
    ws.send(
      JSON.stringify({
        type: 'discord_info',
        discord: {
          serverId: discord.serverId,
          serverName: discord.serverName || 'Your Discord Server',
          memberCount: discord.memberCount,
          messagesCount: discord.messagesCount,
          papersShared: discord.papersShared,
          botAdded: discord.botAdded,
          verified: discord.verified,
          botInstallationUrl: !discord.botAdded ? botStatus.installationLink : null,
        },
      })
    );
  } catch (error) {
    console.error('Error checking Discord stats:', error);
    ws.send(
      JSON.stringify({
        type: 'error',
        message: 'Failed to check Discord stats',
      })
    );
  }
}

/**
 * Handle initial WebSocket connection
 * @param ws WebSocket connection
 * @param project User project
 */
async function handleInitialConnection(ws: WebSocket, project: any): Promise<void> {
  try {
    console.log(`Processing initial connection for project ${project.id}`);

    // Check if this is a first-time user by looking for existing sessions
    const existingSessions = await ChatSessionService.getSessionsByProjectId(project.id);

    const isFirstTimeUser = existingSessions?.length === 0;
    console.log(
      `User ${project.id} is ${isFirstTimeUser ? 'a first-time user' : 'a returning user'} (${existingSessions} existing sessions)`
    );

    // Get or create the chat session
    const sessionId = await ChatSessionService.getOrCreateForUser(project.id);

    // Only send welcome message and auto-mint for first-time users
    if (isFirstTimeUser) {
      console.log(`Sending welcome message for first-time user ${project.id}`);

      // Get user's name and project name for personalized message
      const userName = project.fullName || 'Researcher';
      const projectName = project.projectName || 'your scientific project';

      // Send personalized welcome message
      const welcomeMessage = `Congratulations, ${userName}!
We've just begun the process of bringing ${projectName} to life.
Your journey will be guided by the Portal & your project will level up as you progress along the BioDAO building path.`;

      await ChatMessageService.saveMessage(sessionId, welcomeMessage, true, 'WELCOME', true);

      // Include Discord info in the welcome message if available
      let discordInfo = null;
      if (project.level >= 2) {
        // Get the Discord info if available
        const discordRecord = await DiscordService.getByProjectId(project.id);

        if (discordRecord) {
          // Add Discord info to send back
          discordInfo = {
            serverId: discordRecord.serverId,
            serverName: discordRecord.serverName,
            memberCount: discordRecord.memberCount,
            messagesCount: discordRecord.messagesCount,
            papersShared: discordRecord.papersShared,
            botAdded: discordRecord.botAdded,
            verified: discordRecord.verified,
          };
        }
      }

      ws.send(
        JSON.stringify({
          type: 'message',
          content: welcomeMessage,
          ...(discordInfo ? { discord: discordInfo } : {}),
        })
      );

      // Check if the user already has NFTs
      const existingNFTs = await NFTService.getByProjectId(project.id);

      const hasIdeaNFT = existingNFTs.some((nft) => nft.type === 'idea');
      const hasVisionNFT = existingNFTs.some((nft) => nft.type === 'vision');

      // Auto-mint both NFTs if not already minted
      if (!hasIdeaNFT) {
        // Wait a moment for better UX (message appears, then minting starts)
        await new Promise((resolve) => setTimeout(resolve, 1500));

        // Prepare minting message
        const mintingMessage = "I'll mint your Idea NFT now based on your project description.";

        await ChatMessageService.saveMessage(
          sessionId,
          mintingMessage,
          true,
          'MINT_IDEA_INTENT',
          true
        );

        ws.send(
          JSON.stringify({
            type: 'message',
            content: mintingMessage,
          })
        );

        // Perform the actual minting
        await handleNftMinting(ws, project.id, 'idea');
      }

      if (!hasVisionNFT) {
        // Wait a moment between minting operations
        await new Promise((resolve) => setTimeout(resolve, 2000));

        // Prepare minting message
        const mintingMessage =
          "Now I'll mint your Vision NFT based on your project vision statement.";

        await ChatMessageService.saveMessage(
          sessionId,
          mintingMessage,
          true,
          'MINT_VISION_INTENT',
          true
        );

        ws.send(
          JSON.stringify({
            type: 'message',
            content: mintingMessage,
          })
        );

        // Perform the actual minting
        await handleNftMinting(ws, project.id, 'vision');
      }
    } else {
      // For returning users, send session ID, chat history, NFTs, level and Discord info

      // Send current level
      ws.send(
        JSON.stringify({
          type: 'level',
          level: project.level,
        })
      );

      // Send NFTs
      const nfts = await NFTService.getByProjectId(project.id);
      ws.send(
        JSON.stringify({
          type: 'nfts',
          nfts,
        })
      );

      // Send chat history
      const messages = await ChatMessageService.getMessagesBySessionId(sessionId);
      ws.send(
        JSON.stringify({
          type: 'chat_history',
          sessionId,
          messages,
        })
      );

      // Send Discord info for returning users if available
      let discordInfo = null;
      if (project.level >= 2) {
        const discordRecord = await DiscordService.getByProjectId(project.id);

        if (discordRecord) {
          // Get the bot installation status
          const botStatus = await getBotInstallationStatus(project.id);

          discordInfo = {
            serverId: discordRecord.serverId,
            serverName: discordRecord.serverName || 'Your Discord Server',
            memberCount: discordRecord.memberCount,
            messagesCount: discordRecord.messagesCount,
            papersShared: discordRecord.papersShared,
            botAdded: discordRecord.botAdded,
            verified: discordRecord.verified,
            botInstallationUrl: !discordRecord.botAdded ? botStatus.installationLink : null,
          };

          ws.send(
            JSON.stringify({
              type: 'discord_info',
              discord: discordInfo,
            })
          );
        }
      }
    }

    // For all users, check level-up conditions
    const projectWithNFTs = await ProjectService.getById(project.id);

    if (projectWithNFTs) {
      await checkAndPerformLevelUp(projectWithNFTs, ws);
    }

    // Send guidance message based on current state for all users
    await sendCoreAgentGuidance(ws, project.id);
  } catch (error) {
    console.error('Error in initial connection handling:', error);

    // Send a fallback message if something went wrong
    ws.send(
      JSON.stringify({
        type: 'error',
        message:
          "Welcome to BioDAO! I'm experiencing some technical difficulties at the moment. Please type a message to continue.",
      })
    );
  }
}

/**
 * Send guidance to the user with level-specific information
 */
async function sendCoreAgentGuidance(
  ws: WebSocket,
  userId: string,
  source: string = 'unknown'
): Promise<void> {
  try {
    // Get the project with relations
    const project = await prisma.project.findUnique({
      where: { id: userId },
      include: {
        NFTs: true,
        Discord: true,
      },
    });

    if (!project) {
      console.error(`Cannot send guidance - project ${userId} not found`);
      return;
    }

    // Get or create chat session
    const sessionId = await ChatSessionService.getOrCreateForUser(userId);

    // Prepare Discord stats if available
    let discordStats = null;
    if (project.Discord) {
      discordStats = {
        serverName: project.Discord.serverName,
        memberCount: project.Discord.memberCount,
        papersShared: project.Discord.papersShared,
        messagesCount: project.Discord.messagesCount,
        qualityScore: project.Discord.qualityScore,
        botAdded: project.Discord.botAdded,
        verified: project.Discord.verified,
      };
    }

    // Get bot installation status and URL if needed for level 2 users without bot
    let botInstallationUrl = null;
    if (project.level === 2 && project.Discord && !project.Discord.botAdded) {
      const botStatus = await getBotInstallationStatus(userId);
      botInstallationUrl = botStatus.installationLink;
    }

    // Calculate user progress
    const progressData = await calculateUserProgress(project);

    // Generate guidance message based on level and progress
    const guidanceMessage = generateNextLevelRequirementsMessage(project.level, project);

    // Send guidance message with Discord info including bot installation URL if available
    ws.send(
      JSON.stringify({
        type: 'message',
        content: guidanceMessage,
        action: 'GUIDANCE',
        level: project.level,
        discord: discordStats
          ? {
              ...discordStats,
              // Include bot installation URL if available and at level 2
              ...(botInstallationUrl ? { botInstallationUrl } : {}),
            }
          : null,
      })
    );

    // Save the guidance message to the chat history
    await ChatMessageService.saveMessage(sessionId, guidanceMessage, true, 'GUIDANCE', true);
  } catch (error) {
    console.error('Error sending CoreAgent guidance:', error);
  }
}

/**
 * Calculate user progress metrics
 */
async function calculateUserProgress(project: any): Promise<any> {
  // Default progress object
  const progress: any = {
    ideaNFT: false,
    visionNFT: false,
    discordCreated: false,
    botAdded: false,
    memberCount: 0,
    papersShared: 0,
    messagesCount: 0,
    qualityScore: 0,
  };

  // Check NFTs status
  if (project.NFTs && project.NFTs.length > 0) {
    for (const nft of project.NFTs) {
      if (nft.type === 'idea') progress.ideaNFT = true;
      if (nft.type === 'vision') progress.visionNFT = true;
    }
  }

  // Check Discord status
  if (project.Discord) {
    progress.discordCreated = true;
    progress.botAdded = project.Discord.botAdded || false;
    progress.memberCount = project.Discord.memberCount || 0;
    progress.papersShared = project.Discord.papersShared || 0;
    progress.messagesCount = project.Discord.messagesCount || 0;
    progress.qualityScore = project.Discord.qualityScore || 0;
  }

  return progress;
}

/**
 * Generate level-specific guidance message
 */
function generateNextLevelRequirementsMessage(currentLevel: number, project: any): string {
  switch (currentLevel) {
    case 1:
      return [
        `**I'm excited to help you set up your research community!** \nLet me guide you through the process:\n`,
        `**1. Creating a Discord Server:**\n`,
        `- Go to Discord and click the **+** button on the left sidebar`,
        `- Choose **"Create a Server"** and follow the setup wizard`,
        `- You can use this BIO template: https://discord.new/wbyrDkxwyhNp`,
        `- Create channels for research discussions, paper sharing, and community updates\n`,
        `**2. Connecting Your Server:**\n`,
        `- Once your server is set up, share your Discord invite link with me`,
        `- Just paste your Discord invite link here (it will look like discord.gg/123abc)`,
        `- I'll verify the server and then guide you through the next step\n`,
        `**3. Growing Your Community:**\n`,
        `- After verification, you'll need to invite at least **4 members** to reach Level 3`,
        `- Reach out to colleagues, collaborators, and interested researchers\n`,
        `Would you like help creating your Discord server?`,
      ].join('\n');

    case 2:
      const currentMembers = project.Discord?.memberCount || 0;
      const membersNeeded = 4 - currentMembers;
      const botInstalled = project.Discord?.botAdded || false;
      
      // SCENARIO 1: No Discord entry at all - focus on step 1 only (creating server and sharing invite)
      if (!project.Discord) {
        return [
          `**Let's set up your community on Discord!** \n`,
          `**First Step: Create and Connect Your Discord Server**\n`,
          `- Go to Discord and click the **+** button on the left sidebar`,
          `- Choose **"Create a Server"** and follow the setup wizard`,
          `- You can use this BIO template: https://discord.new/wbyrDkxwyhNp`,
          `- Once created, share your Discord invite link with me here`,
          `- Just paste your Discord invite link (it will look like discord.gg/123abc)\n`,
          `**Important:** Share your Discord invite link first, then we'll proceed to the next step.`,
        ].join('\n');
      }
      // SCENARIO 2: Discord connected but bot not installed - focus on step 2
      else if (!botInstalled) {
        return [
          `**Great progress on setting up your community!** \n`,
          `**Current Status:**\n`,
          `- Discord server connected ✅`,
          `- Verification bot installed ❌`,
          `- Current members: ${currentMembers} (need ${membersNeeded > 0 ? `${membersNeeded} more` : 'no more'} to reach 4)\n`,
          `**Next Step: Install Verification Bot**\n`,
          `- I've sent you a link to install our verification bot in a separate message`,
          `- This bot is required to track your community metrics automatically`,
          `- Without the bot, we can't verify your progress toward level-ups\n`,
          `After installing the bot, focus on inviting members to your server to reach at least 4 members.`,
          `Would you like suggestions for growing your community?`,
        ].join('\n');
      } 
      // SCENARIO 3: Bot installed - focus on growing community
      else {
        return [
          `**Great progress on setting up your community!** \n`,
          `**Current Status:**\n`,
          `- Discord server connected ✅`, 
          `- Verification bot installed ✅`,
          `- Current members: ${currentMembers} (need ${membersNeeded > 0 ? `${membersNeeded} more` : 'no more'} to reach 4)\n`,
          `**Focus on Growing Your Community:**\n`,
          `- Invite researchers and collaborators to join your server`,
          `- Share interesting scientific content to attract members`,
          `- Host virtual events or discussions`,
          `- Reach the milestone of 4 members to advance to Level 3\n`,
          `Would you like suggestions for growing your community or tracking your progress?`,
        ].join('\n');
      }

    case 3:
      const members = project.Discord?.memberCount || 0;
      const papers = project.Discord?.papersShared || 0;
      const messages = project.Discord?.messagesCount || 0;
      return [
        `**You're doing great! Let's get you to Level 4:**\n`,
        `**1. Grow to 5+ Members** *(you need ${Math.max(0, 5 - members)} more)*:\n`,
        `- Share your invite with researchers`,
        `- Host community events`,
        `- Invite participants from aligned communities\n`,
        `**2. Share 5+ Scientific Papers** *(you need ${Math.max(0, 5 - papers)} more)*:\n`,
        `- Share PDFs or links from PubMed, bioRxiv, etc.`,
        `- The bot detects papers shared in your server\n`,
        `**3. Reach 50+ Quality Messages** *(you need ${Math.max(0, 50 - messages)} more)*:\n`,
        `- Encourage rich discussion on research topics`,
        `- Ask thoughtful, open-ended questions`,
        `- The bot tracks and filters quality messages\n`,
        `Would you like help with outreach or boosting engagement?`,
      ].join('\n');

    case 4:
      return [
        `🎉 **Congratulations on reaching Level 4!**  \nThis is a huge milestone for your BioDAO.\n`,
        `The Bio team will reach out soon to discuss:\n`,
        `- Your research goals and vision`,
        `- Funding opportunities`,
        `- Advanced resources and support`,
        `- Strategic guidance for growth\n`,
        `**Prepare for your call by:**`,
        `1. Refining your research roadmap`,
        `2. Identifying key challenges`,
        `3. Listing questions for the Bio team\n`,
        `Meanwhile, enjoy full access to all platform features. Anything you'd like to focus on now?`,
      ].join('\n');

    default:
      return '';
  }
}

/**
 * Check if bot is installed and generate installation link if needed
 * @param projectId Project ID
 * @returns Object with installation status and link
 */
async function getBotInstallationStatus(
  projectId: string
): Promise<{ installed: boolean; installationLink: string | null }> {
  try {
    // Get the Discord server information for this user
    const discordServer = await prisma.discord.findUnique({
      where: { projectId },
    });

    // If no Discord server or bot already added, return appropriate result
    if (!discordServer) {
      return { installed: false, installationLink: null };
    }

    if (discordServer.botAdded) {
      return { installed: true, installationLink: null };
    }

    // Bot not added, generate installation link
    const clientId =
      config.discord.clientId || process.env.DISCORD_CLIENT_ID || '1361285493521907832';
    const permissions = config.discord.permissions || '8';
    const verificationToken =
      discordServer.verificationToken ||
      generateVerificationToken(projectId, discordServer.serverId);

    // Create the installation URL with verification token
    const installationLink = `https://discord.com/api/oauth2/authorize?client_id=${clientId}&permissions=${permissions}&scope=bot&guild_id=${discordServer.serverId}&state=${verificationToken}`;

    // If the server didn't have a verification token, update it now
    if (!discordServer.verificationToken) {
      await prisma.discord.update({
        where: { id: discordServer.id },
        data: { verificationToken },
      });
    }

    return { installed: false, installationLink };
  } catch (error) {
    console.error('Error checking bot installation status:', error);
    return { installed: false, installationLink: null };
  }
}

/**
 * Generate a verification token for Discord
 * @param userId User ID
 * @param serverId Server ID
 * @returns Verification token
 */
function generateVerificationToken(userId: string, serverId: string): string {
  const combinedString = `${userId}:${serverId}:${Date.now()}`;
  return Buffer.from(combinedString).toString('base64');
}

/**
 * Handle AI interaction with the user
 * @param ws WebSocket connection
 * @param userId User ID
 * @param userMessage User message
 * @param userName User name
 */
async function handleAIInteraction(
  ws: WebSocket,
  userId: string,
  userMessage: string,
  userName: string
): Promise<void> {
  try {
    // Get user with Discord info using Prisma directly
    const project = await prisma.project.findUnique({
      where: {
        id: userId,
      },
      include: {
        Discord: true,
        NFTs: true,
      },
    });

    if (!project) {
      ws.send(
        JSON.stringify({
          type: 'error',
          message: 'Project not found',
        })
      );
      return;
    }

    // Ensure we have the latest Discord stats if they exist
    let discordStats = project.Discord;
    if (project.level >= 2 && project.Discord) {
      // Refresh Discord stats from API if possible
      try {
        const { inviteCode } = extractDiscordInfo(project.Discord.inviteLink);
        if (inviteCode) {
          const serverInfo = await fetchDiscordServerInfo(inviteCode);
          if (serverInfo.approximateMemberCount) {
            // Update member count in database
            await prisma.discord.update({
              where: { id: project.Discord.id },
              data: {
                memberCount: serverInfo.approximateMemberCount,
                updatedAt: new Date(),
              },
            });

            // Update local copy for this request
            discordStats = {
              ...project.Discord,
              memberCount: serverInfo.approximateMemberCount,
            };

            console.log(
              `Updated Discord stats for user ${userId}: ${discordStats.memberCount} members`
            );
          }
        }
      } catch (error) {
        console.error('Error refreshing Discord stats:', error);
        // Continue with existing data if refresh fails
      }
    }

    // Check if user is at level 2 but has no Discord set up yet
    if (project.level === 2 && !discordStats) {
      console.log(`User ${userId} is at level 2 but has no Discord server set up yet`);
    }

    // Get or create a chat session
    const sessionId = await getOrCreateChatSession(userId);

    // Save the user's message (this is already done in handleMessage, but adding here for completeness)
    await saveChatMessage(sessionId, userMessage, false);

    // Check bot installation status if applicable
    const botStatus = await getBotInstallationStatus(userId);

    // Add bot installation info to message if needed
    let aiContext = userMessage;
    if (
      botStatus.installationLink &&
      (aiContext.toLowerCase().includes('bot') ||
        aiContext.toLowerCase().includes('discord') ||
        aiContext.toLowerCase().includes('verify') ||
        aiContext.toLowerCase().includes('verification'))
    ) {
      // Append installation link info to the AI context
      aiContext += `\n\nNote: When referring to the bot installation link, use the placeholder [BOT_INSTALLATION_LINK] which will be automatically replaced with the actual link.`;
    }

    // Send typing indicator
    ws.send(
      JSON.stringify({
        type: 'agent_typing',
        isTyping: true,
      })
    );

    // Process message with AI to get the response, providing the most up-to-date real Discord stats
    const aiResponse = await processMessage(
      userId,
      aiContext, // Use the context with potential bot info
      project.level,
      discordStats,
      botStatus.installationLink || undefined // Convert null to undefined for type safety
    );

    // We don't need to replace placeholders or add the link separately anymore
    // since we're passing it directly to the AI model
    let enhancedResponse = aiResponse;

    // Save the AI's enhanced response
    await saveChatMessage(sessionId, enhancedResponse, true);

    // Send AI response to the client
    ws.send(
      JSON.stringify({
        type: 'message',
        content: enhancedResponse,
        isFromAgent: true,
      })
    );

    // Turn off typing indicator
    ws.send(
      JSON.stringify({
        type: 'agent_typing',
        isTyping: false,
      })
    );

    // Process potential actions based on the conversation
    const actionsDetected = await handlePotentialActions(
      ws,
      userId,
      { ...project, Discord: discordStats },
      userMessage,
      enhancedResponse
    );

    // If actions were taken, update the AI message to record them
    if (actionsDetected.length > 0) {
      console.log(`Actions detected and handled for user ${userId}:`, actionsDetected);

      // Save each action as a system message in the chat history
      for (const action of actionsDetected) {
        await saveChatMessage(
          sessionId,
          `System action: ${action.action}`,
          true,
          action.action,
          action.success
        );
      }
    }

    // Check for level-up conditions after AI has responded
    await checkLevelUpConditions(userId, project.level, discordStats, ws);
  } catch (error) {
    console.error('Error handling AI interaction:', error);
    ws.send(
      JSON.stringify({
        type: 'error',
        message: 'Failed to get AI response',
      })
    );

    // Turn off typing indicator
    ws.send(
      JSON.stringify({
        type: 'agent_typing',
        isTyping: false,
      })
    );
  }
}

/**
 * Handle potential actions based on user message and AI response
 * @param ws WebSocket connection
 * @param userId User ID
 * @param project Project data
 * @param userMessage User message
 * @param aiResponse AI response
 * @returns Array of actions taken
 */
async function handlePotentialActions(
  ws: WebSocket,
  userId: string,
  project: any,
  userMessage: string,
  aiResponse: string
): Promise<Array<{ action: string; success: boolean }>> {
  const actions: Array<{ action: string; success: boolean }> = [];

  try {
    // Check for Discord invite links if user is at level 2 or higher
    if (project.level >= 2) {
      const { inviteLink } = extractDiscordInfo(userMessage);

      if (inviteLink) {
        console.log(`Found Discord invite link in message: ${inviteLink}`);

        // Process the Discord setup
        const success = await handleDiscordSetup(ws, userId, { content: userMessage });

        if (success) {
          actions.push({ action: 'discord_setup', success: true });
          console.log(`Discord setup processed successfully for user ${userId}`);
        } else {
          console.log(`Discord setup failed for user ${userId}`);
        }
      }
    }

    // Check for NFT minting request in user message
    const isIdeaNFTRequest =
      userMessage.toLowerCase().includes('idea nft') ||
      userMessage.toLowerCase().includes('mint idea');

    const isVisionNFTRequest =
      userMessage.toLowerCase().includes('vision nft') ||
      userMessage.toLowerCase().includes('mint vision') ||
      userMessage.toLowerCase().includes('mint hypothesis');

    if (isIdeaNFTRequest && project.level === 1) {
      const success = await handleNftMinting(ws, userId, 'idea');
      actions.push({ action: 'mint_idea_nft', success });
    }

    if (isVisionNFTRequest && project.level === 1) {
      const success = await handleNftMinting(ws, userId, 'vision');
      actions.push({ action: 'mint_vision_nft', success });
    }

    // More potential actions can be added here in the future

    return actions;
  } catch (error) {
    console.error('Error processing potential actions:', error);
    return actions;
  }
}

/**
 * Handle Discord setup
 * @param ws WebSocket connection
 * @param userId User ID
 * @param data Message data
 * @returns Success status
 */
async function handleDiscordSetup(
  ws: WebSocket,
  userId: string,
  data: { content: string }
): Promise<boolean> {
  try {
    if (!userId) {
      ws.send(
        JSON.stringify({
          type: 'error',
          message: 'User ID is required',
        })
      );
      return false;
    }

    const { content } = data;
    const discordInfo = extractDiscordInfo(content);
    const { inviteLink, inviteCode } = discordInfo;

    if (!inviteLink && !inviteCode) {
      ws.send(
        JSON.stringify({
          type: 'error',
          message: 'No Discord invite link found. Please provide a valid Discord invite link.',
        })
      );
      return false;
    }

    console.log(
      `Processing Discord setup for user ${userId} with invite: ${inviteLink || inviteCode}`
    );

    // Process the invite to get server info
    let serverInfo;
    if (inviteCode) {
      serverInfo = await fetchDiscordServerInfo(inviteCode);
    }

    if (!serverInfo || !serverInfo.serverId) {
      const errorMsg =
        serverInfo?.error ||
        'Failed to retrieve Discord server information. The invite link may be invalid or expired.';
      ws.send(
        JSON.stringify({
          type: 'error',
          message: errorMsg,
        })
      );
      return false;
    }

    const finalServerId = serverInfo.serverId;
    const fullInviteLink = inviteLink || `https://discord.gg/${inviteCode}`;
    const serverName = serverInfo.name;
    const serverIcon = serverInfo.icon;
    const memberCount = serverInfo.approximateMemberCount || 0;

    // Generate verification token for this server
    const verificationToken = generateVerificationToken(userId, finalServerId);

    console.log(
      `Discord server info retrieved - ID: ${finalServerId}, Name: ${serverName}, Members: ${memberCount}`
    );

    // Check if this Discord server is already associated with this user
    const existingDiscord = await prisma.discord.findFirst({
      where: {
        serverId: finalServerId,
        projectId: userId,
      },
    });

    if (existingDiscord) {
      console.log(`Updating existing Discord record for user ${userId}:`, existingDiscord);

      // Update the record
      await prisma.discord.update({
        where: { id: existingDiscord.id },
        data: {
          memberCount,
          inviteLink: fullInviteLink,
          serverName,
          serverIcon,
          // Don't override botAdded status
          verificationToken,
          updatedAt: new Date(),
        },
      });
    } else {
      // Create a new record
      const updatedDiscord = await prisma.discord.create({
        data: {
          serverId: finalServerId,
          inviteLink: fullInviteLink,
          projectId: userId,
          memberCount,
          papersShared: 0,
          messagesCount: 0,
          qualityScore: 0,
          serverName,
          serverIcon,
          verificationToken,
          botAdded: false,
        },
      });
      console.log(`Created Discord record for user ${userId}:`, updatedDiscord);
    }

    // Generate bot installation URL with verification token
    // This token will be passed back when the bot is added, confirming the proper server
    const botInstallationUrl = `https://discord.com/api/oauth2/authorize?client_id=1361285493521907832&permissions=8&scope=bot&guild_id=${finalServerId}&state=${verificationToken}`;

    // Format server display info
    const serverDisplayName = serverName || `Server ID: ${finalServerId.substring(0, 10)}...`;

    // Get or create chat session
    const chatSession = await getOrCreateChatSession(userId);

    // Save chat message about Discord setup
    await saveChatMessage(
      chatSession,
      `Discord server "${serverDisplayName}" verified successfully with ${memberCount} members`,
      false,
      'discord_setup_initiated',
      true
    );

    // STEP 1: Send confirmation message about successful server connection
    const serverConnectedMessage = {
      content: `## Discord Server Connected: "${serverDisplayName}" 🎉

**Current Members:** ${memberCount} ${memberCount === 1 ? 'member' : 'members'}

Great job! I've successfully connected to your Discord server. Now we need to complete one more important step.`
    };

    await saveChatMessage(chatSession, serverConnectedMessage, true, 'discord_server_connected', true);

    // Send success message with Discord info
    ws.send(
      JSON.stringify({
        type: 'discord_setup_success',
        message: 'Discord server verified and registered successfully.',
        discord: {
          serverId: finalServerId,
          inviteLink: fullInviteLink,
          memberCount,
          serverName: serverDisplayName,
          serverIcon,
          papersShared: 0,
          messagesCount: 0,
          qualityScore: 0,
          botAdded: false,
          verified: false,
          botInstallationUrl: botInstallationUrl,
        },
        pendingVerification: true,
      })
    );

    // Also send agent message as a regular chat message to ensure it shows up in the chat
    ws.send(
      JSON.stringify({
        type: 'message',
        content: serverConnectedMessage.content,
        isFromAgent: true,
        action: 'discord_server_connected',
      })
    );

    // STEP 2: Send a separate message about the bot installation
    setTimeout(async () => {
      const botInstallMessage = {
        content: `## Next Step: Install Verification Bot

To track your community's progress, please install our verification bot.

**[Click here to install the BioDAO verification bot](${botInstallationUrl})**

This verification bot helps:
- Track member count automatically
- Count messages and scientific papers shared
- Verify your progress toward level advancement

Once installed, your Discord stats will be automatically tracked for level progression.`
      };

      await saveChatMessage(chatSession, botInstallMessage, true, 'bot_install_prompt', true);

      ws.send(
        JSON.stringify({
          type: 'message',
          content: botInstallMessage.content,
          isFromAgent: true,
          action: 'bot_install_prompt',
        })
      );
    }, 2000); // Send the bot installation prompt 2 seconds after the server connection confirmation

    // Trigger an AI interaction to provide contextual guidance
    try {
      const project = await ProjectService.getById(userId);
      if (project) {
        // Send typing indicator
        ws.send(
          JSON.stringify({
            type: 'agent_typing',
            isTyping: true,
          })
        );

        // Get AI response specific to Discord setup
        const setupPrompt = `The user has just connected their Discord server "${serverDisplayName}" with ${memberCount} members. I've already sent them the verification bot installation instructions in a separate message. Focus on the next steps after they install the bot - growing their community to at least 4 members.`;

        // Process the message with AI
        const aiResponse = await processMessage(
          userId,
          setupPrompt,
          project.level,
          {
            serverId: finalServerId,
            serverName: serverDisplayName,
            memberCount,
            botAdded: false,
            verified: false,
            botInstallationUrl: botInstallationUrl,
            papersShared: 0,
            messagesCount: 0,
          },
          botInstallationUrl || undefined
        );

        // Turn off typing indicator
        ws.send(
          JSON.stringify({
            type: 'agent_typing',
            isTyping: false,
          })
        );
      }
    } catch (error) {
      console.error('Error getting AI guidance after Discord setup:', error);
    }
    const latestProject = await ProjectService.getById(userId);
    // Check and perform level up
    await checkAndPerformLevelUp(latestProject, ws);

    return true;
  } catch (error) {
    console.error('Error setting up Discord:', error);
    ws.send(
      JSON.stringify({
        type: 'error',
        message:
          'Failed to register Discord server. Please try again with a valid Discord invite link.',
      })
    );
    return false;
  }
}

/**
 * Handle NFT minting
 * @param ws WebSocket connection
 * @param userId User ID
 * @param nftType NFT type ('idea' or 'vision')
 * @returns Success status
 */
async function handleNftMinting(ws: WebSocket, userId: string, nftType: string): Promise<boolean> {
  try {
    // Check if user already has this NFT type
    const existingNFTs = await NFTService.getByProjectId(userId);
    const hasNFT = existingNFTs.some((nft: any) => nft.type === nftType);

    if (hasNFT) {
      ws.send(
        JSON.stringify({
          type: 'error',
          message: `You already have a ${nftType} NFT`,
        })
      );
      return false;
    }

    // Get the project
    const project = await ProjectService.getById(userId);

    if (!project) {
      ws.send(
        JSON.stringify({
          type: 'error',
          message: 'Project not found',
        })
      );
      return false;
    }

    // Send minting in progress notification
    ws.send(
      JSON.stringify({
        type: 'nft_minting',
        nftType,
        status: 'started',
      })
    );

    // Mint the NFT
    let transactionHash;
    try {
      if (nftType === 'idea') {
        transactionHash = await mintIdeaNft(project.wallet as any);
      } else if (nftType === 'vision' || nftType === 'hypothesis') {
        transactionHash = await mintVisionNft(project.wallet as any);
      } else {
        ws.send(
          JSON.stringify({
            type: 'error',
            message: `Invalid NFT type: ${nftType}`,
          })
        );
        return false;
      }
    } catch (error) {
      console.error('Error minting NFT:', error);
      ws.send(
        JSON.stringify({
          type: 'nft_minting',
          nftType,
          status: 'failed',
          error: 'Failed to mint NFT',
        })
      );
      return false;
    }

    // Create NFT record
    const nft = await NFTService.create({
      type: nftType,
      projectId: userId,
      transactionHash,
    });

    // Send minting success notification
    ws.send(
      JSON.stringify({
        type: 'nft_minting',
        nftType,
        status: 'success',
        nftId: nft.id,
      })
    );

    // Generate NFT image in background
    generateNftImageInBackground(userId, nft.id, nftType, project, ws);

    // Check if user has both NFTs and should level up
    await checkLevelUpConditions(userId, project.level, null, ws);

    // In handleNftMinting, after NFT image generation and before calling checkAndPerformLevelUp
    const latestProject = await ProjectService.getById(userId);
    if (latestProject) {
      await checkAndPerformLevelUp(latestProject, ws);
    }

    return true;
  } catch (error) {
    console.error('Error handling NFT minting:', error);
    ws.send(
      JSON.stringify({
        type: 'error',
        message: 'Failed to mint NFT',
      })
    );
    return false;
  }
}

/**
 * Generate NFT image in background
 * @param userId User ID
 * @param nftId NFT ID
 * @param nftType NFT type
 * @param project Project data
 * @param ws WebSocket connection
 */
async function generateNftImageInBackground(
  userId: string,
  nftId: string,
  nftType: string,
  project: any,
  ws: WebSocket
): Promise<void> {
  try {
    ws.send(
      JSON.stringify({
        type: 'nft_image_generation',
        nftId,
        status: 'started',
      })
    );

    let imageUrl;
    if (nftType === 'idea') {
      imageUrl = await generateIdeaNFTImage(userId, project.projectDescription || '');
    } else {
      imageUrl = await generateVisionNFTImage(userId, project.projectVision || '');
    }

    // Update NFT with image URL
    await NFTService.update(nftId, { imageUrl });

    // Send the updated NFT info
    ws.send(
      JSON.stringify({
        type: 'nft_image_generation',
        nftId,
        status: 'success',
        imageUrl,
      })
    );

    // Send updated NFTs list
    const nfts = await NFTService.getByProjectId(userId);
    ws.send(
      JSON.stringify({
        type: 'nfts',
        nfts,
      })
    );
  } catch (error) {
    console.error('Error generating NFT image:', error);
    ws.send(
      JSON.stringify({
        type: 'nft_image_generation',
        nftId,
        status: 'failed',
        error: 'Failed to generate NFT image',
      })
    );
  }
}

/**
 * Check level-up conditions
 * @param userId User ID
 * @param currentLevel Current level
 * @param discordStats Discord stats
 * @param ws WebSocket connection
 */
async function checkLevelUpConditions(
  userId: string,
  currentLevel: number,
  discordStats: any,
  ws: WebSocket
): Promise<void> {
  try {
    // Get complete project data for level-up checks
    const project = await prisma.project.findUnique({
      where: { id: userId },
      include: {
        Discord: true,
        NFTs: true,
      },
    });

    if (!project) {
      console.error(`Project not found for user ID: ${userId}`);
      return;
    }

    // Skip if user is already at max level
    if (project.level >= 4) return;
    

    // Level 2 to Level 3: Need 4+ Discord members and verified status
    if (currentLevel === 2 && discordStats.verified && discordStats.memberCount >= 4) {
      // Define the new level
      const newLevel = 3;

      // Update to level 3
      await prisma.project.update({
        where: { id: userId },
        data: { level: newLevel },
      });

      console.log(`User ${userId} automatically progressed to Level ${newLevel}`);

      // Get session for chat history
      const sessionId = await getOrCreateChatSession(userId);

      // Create level-up message
      const levelUpMessage = `## Level ${newLevel} Unlocked! 🎉

**Congratulations!** Your BioDAO community now has **${discordStats.memberCount} members**, which means you've advanced to **Level ${newLevel}!**

To advance to Level 4, you'll need to:
1. **Grow your community to 10+ members**
2. **Share 25+ scientific papers** in your Discord
3. **Reach 100+ quality messages**

I'll help you track these metrics and provide strategies to achieve them.`;

      // Save level-up message to chat
      await saveChatMessage(sessionId, levelUpMessage, true, 'LEVEL_UP', true);

      // Send level-up message to WebSocket
      ws.send(
        JSON.stringify({
          type: 'level_up',
          previousLevel: currentLevel,
          newLevel: newLevel,
          message: levelUpMessage,
          nextLevelRequirements: [
            'Grow your community to 10+ Discord members',
            'Share at least 25 scientific papers in your server',
            'Reach 100+ quality messages in your community',
          ],
        })
      );

      // Also send as a regular message for clients that don't handle level_up events
      ws.send(
        JSON.stringify({
          type: 'message',
          content: levelUpMessage,
          isFromAgent: true,
          action: 'LEVEL_UP',
        })
      );

      // Send email notification
      if (project.email) {
        try {
          await sendLevelUpEmail(project.email, newLevel);
        } catch (error) {
          console.error(`Error sending level up email to ${project.email}:`, error);
        }
      }
    }
    // Level 3 to Level 4: Need 10+ members, 25+ papers, 100+ messages, 70+ quality score
    else if (
      currentLevel === 3 &&
      discordStats.verified &&
      discordStats.memberCount >= 5 &&
      discordStats.papersShared >= 5 &&
      discordStats.messagesCount >= 50
    ) {
      // Define the new level
      const newLevel = 4;

      // Update to level 4
      await prisma.project.update({
        where: { id: userId },
        data: { level: newLevel },
      });

      console.log(`User ${userId} automatically progressed to Level ${newLevel}`);

      // Get session for chat history
      const sessionId = await getOrCreateChatSession(userId);

      // Create level-up message
      const levelUpMessage = `## Level ${newLevel} Unlocked! 🎉

**Congratulations!** Your BioDAO community has reached critical mass with:
- **${discordStats.memberCount} members**
- **${discordStats.papersShared} scientific papers shared**
- **${discordStats.messagesCount} messages** in your server

You've advanced to **Level ${newLevel}** and now have access to the BioDAO sandbox!

The Bio team will contact you via email shortly to schedule a call to discuss your next steps.`;

      // Save level-up message to chat
      await saveChatMessage(sessionId, levelUpMessage, true, 'LEVEL_UP', true);

      // Send level-up message to WebSocket
      ws.send(
        JSON.stringify({
          type: 'level_up',
          previousLevel: currentLevel,
          newLevel: newLevel,
          message: levelUpMessage,
          nextLevelRequirements: [
            'All requirements completed - congratulations!',
            'The Bio team will contact you to schedule a call',
            'You now have access to the full BioDAO sandbox',
          ],
        })
      );

      // Also send as a regular message for clients that don't handle level_up events
      ws.send(
        JSON.stringify({
          type: 'message',
          content: levelUpMessage,
          isFromAgent: true,
          action: 'LEVEL_UP',
        })
      );

      // Send email notifications
      if (project.email) {
        try {
          // Send level up email
          await sendLevelUpEmail(project.email, newLevel);

          // Send sandbox email for final level
          await sendSandboxEmail(project);

          console.log(`Sent level ${newLevel} and sandbox emails to ${project.email}`);
        } catch (error) {
          console.error(`Error sending emails to ${project.email}:`, error);
        }
      }
    }
  } catch (error) {
    console.error('Error checking level-up conditions:', error);
  }
}

/**
 * Check if the project meets criteria for level up and perform level up if needed
 * @param project The project data with NFTs included
 * @param ws WebSocket connection to notify the client
 */
async function checkAndPerformLevelUp(project: any, ws: WebSocket): Promise<void> {
  try {
    if (!project || typeof project.level === 'undefined') {
      console.warn('checkAndPerformLevelUp: project is undefined or missing level property:', project);
      return;
    }
    // Get current level
    const currentLevel = project.level || 1;
    let newLevel = currentLevel;
    let shouldLevelUp = false;
    let levelUpMessage = '';

    // Get required services

    console.log(
      `Checking level up criteria for project ${project.id}, current level: ${currentLevel}`
    );

    switch (currentLevel) {
      case 1:
        // Check level 1 to 2 conditions (NFTs minted)
        const hasIdeaNFT = project.NFTs?.some((nft: any) => nft.type === 'idea');
        const hasVisionNFT = project.NFTs?.some((nft: any) => nft.type === 'vision');

        if (hasIdeaNFT && hasVisionNFT) {
          newLevel = 2;
          shouldLevelUp = true;
          levelUpMessage = `🎉 Congratulations! You've progressed to Level 2: Discord Setup.\n\nYour next steps are:\n- Create a Discord server for your community\n- Share the invite link with me\n- Add our verification bot\n- Grow to at least 4 members`;
        } else {
          console.log(
            `Project ${project.id} doesn't meet level 2 requirements: Idea NFT: ${hasIdeaNFT}, Vision NFT: ${hasVisionNFT}`
          );
        }
        break;

      case 2:
        // Check level 2 to 3 conditions (Discord created with members)
        const discordInfo = await DiscordService.getByProjectId(project.id);
        if (discordInfo && discordInfo.verified && discordInfo.memberCount >= 4) {
          newLevel = 3;
          shouldLevelUp = true;
          levelUpMessage = `🎉 Congratulations! You've progressed to Level 3: Community Growth.\n\nYour next goals are:\n- Reach 10+ Discord members\n- Share 25+ scientific papers\n- Have 100+ messages in your Discord`;
        } else {
          const missingReqs = [];
          if (!discordInfo) missingReqs.push('Discord server not connected');
          else {
            if (!discordInfo.verified) missingReqs.push('Discord verification incomplete');
            if (discordInfo.memberCount < 4)
              missingReqs.push(`Need more members (${discordInfo.memberCount}/4)`);
          }
          console.log(
            `Project ${project.id} doesn't meet level 3 requirements: ${missingReqs.join(', ')}`
          );
        }
        break;

      case 3:
        // Check level 3 to 4 conditions (Community growth metrics)
        const discordStats = await DiscordService.getByProjectId(project.id);
        if (
          discordStats &&
          discordStats.memberCount >= 5 &&
          discordStats.papersShared >= 5 &&
          discordStats.messagesCount >= 50
        ) {
          newLevel = 4;
          shouldLevelUp = true;
          levelUpMessage = `🎉 Congratulations! You've reached Level 4: Scientific Proof.\n\nThis is the final milestone in your BioDAO onboarding journey. The Bio team will reach out to you via email soon to schedule a call to discuss your next steps.`;

          // Send sandbox email when reaching level 4 (final level)
          try {
            // Get user email for notification
            if (project.email) {
              await sendSandboxEmail(project);
              console.log(`Sandbox email sent to ${project.email} for project ${project.id}`);
            } else {
              console.warn(`No email found for project ${project.id}, sandbox email not sent`);
            }
          } catch (emailError) {
            console.error(`Error sending sandbox email for project ${project.id}:`, emailError);
          }
        } else {
          const missingReqs = [];
          if (!discordStats) {
            missingReqs.push('Discord stats not available');
          } else {
            if (discordStats.memberCount < 5)
              missingReqs.push(`Need more members (${discordStats.memberCount}/5)`);
            if (discordStats.papersShared < 5)
              missingReqs.push(`Need more papers shared (${discordStats.papersShared}/5)`);
            if (discordStats.messagesCount < 50)
              missingReqs.push(`Need more messages (${discordStats.messagesCount}/50)`);
          }
          console.log(
            `Project ${project.id} doesn't meet level 4 requirements: ${missingReqs.join(', ')}`
          );
        }
        break;

      default:
        console.log(`Project ${project.id} is already at max level (${currentLevel})`);
        break;
    }

    // Perform the level up if conditions are met
    if (shouldLevelUp && newLevel > currentLevel) {
      // Update the level in the database
      const updatedProject = await prisma.project.update({
        where: { id: project.id },
        data: { level: newLevel },
      });

      console.log(`Project ${project.id} leveled up from ${currentLevel} to ${newLevel}`);

      // Send level up notification to the client
      ws.send(
        JSON.stringify({
          type: 'level_up',
          previousLevel: currentLevel,
          newLevel: newLevel,
        })
      );

      // Get or create chat session for this user
      const sessionId = await ChatSessionService.getOrCreateForUser(project.id);
      
      // Save the level up message to chat history
      await ChatMessageService.saveMessage(sessionId, levelUpMessage, true, 'LEVEL_UP', true);

      // Also send a message about leveling up
      ws.send(
        JSON.stringify({
          type: 'message',
          content: levelUpMessage,
          isFromAgent: true,
          action: 'level_up',
        })
      );

      // Send level up email notification
      try {
        if (project.email) {
          await sendLevelUpEmail(project.email, newLevel);
          console.log(`Level up email sent to ${project.email} for level ${newLevel}`);
        }
      } catch (emailError) {
        console.error(`Error sending level up email for project ${project.id}:`, emailError);
      }
    }
  } catch (error) {
    console.error('Error checking and performing level up:', error);
    throw error;
  }
}

/**
 * Send a level up congratulatory email to the user
 */
async function sendLevelUpEmail(userEmail: string, level: number) {
  const EmailService = require('../services/email.service');
  try {
    await EmailService.sendLevelUpEmail(userEmail, level);
    console.log(`Level up email sent to ${userEmail} for level ${level}`);
  } catch (error) {
    console.error(`Error sending level up email to ${userEmail}:`, error);
    throw error;
  }
}

/**
 * Send a notification email to the Bio team when a user reaches the sandbox level
 */
async function sendSandboxEmail(project: any) {
  const EmailService = require('../services/email.service');
  try {
    await EmailService.sendSandboxEmail(project);
    console.log(`Sandbox email sent for project ${project.id}`);
  } catch (error) {
    console.error(`Error sending sandbox email for project ${project.id}:`, error);
    throw error;
  }
}

/**
 * Handle notification when a bot is successfully added to a Discord server
 * @param ws WebSocket connection
 * @param userId User ID
 * @param serverDetails Discord server details
 */
async function handleBotInstalled(
  ws: WebSocket,
  userId: string,
  serverDetails: {
    guildId: string;
    guildName?: string;
    memberCount: number;
  }
): Promise<void> {
  try {
    // Get or create chat session first to avoid reference before declaration
    const sessionId = await getOrCreateChatSession(userId);

    // Get the project to check for level-up conditions
    const project = await prisma.project.findUnique({
      where: { id: userId },
      include: {
        Discord: true,
        NFTs: true,
      },
    });

    // Get the Discord record
    const discordRecord = await prisma.discord.findFirst({
      where: {
        serverId: serverDetails.guildId,
        projectId: userId,
      },
    });

    if (!discordRecord) {
      console.error(
        `No Discord record found for server ID: ${serverDetails.guildId} and project ID: ${userId}`
      );
      return;
    }

    // Update the record to mark the bot as added
    await prisma.discord.update({
      where: { id: discordRecord.id },
      data: {
        botAdded: true,
        botAddedAt: new Date(),
        verified: true,
        memberCount: serverDetails.memberCount || discordRecord.memberCount,
      },
    });

    // Create the bot added message
    const botAddedMessage = {
      content: `## Discord Bot Successfully Added! 🎉

**Great news!** The verification bot has been successfully added to your Discord server "${serverDetails.guildName || discordRecord.serverName || 'Your Discord Server'}".

### Current Stats:
- **Members:** ${serverDetails.memberCount} ${serverDetails.memberCount === 1 ? 'member' : 'members'}
- **Messages:** 0 (tracking starts now)
- **Papers shared:** 0 (tracking starts now)

### What This Means:
- ✅ Your Discord server is now **fully verified**
- ✅ Member counts and activity are being **automatically tracked**
- ✅ Scientific papers shared in the server will be **detected and counted**
- ✅ All metrics will update in **real-time** towards your level progression

${serverDetails.memberCount >= 4 ? '**Congratulations!** You have enough members to qualify for Level 3!' : `### Next Steps:\nYou need **${4 - serverDetails.memberCount} more ${4 - serverDetails.memberCount === 1 ? 'member' : 'members'}** to reach Level 3.\n\nKeep growing your community by inviting researchers and collaborators to join your server!`}`,
    };

    // Save the message to the chat history
    await saveChatMessage(sessionId, botAddedMessage, true, 'BOT_ADDED', true);

    // Send the notification over WebSocket
    ws.send(
      JSON.stringify({
        type: 'message',
        content: botAddedMessage.content,
        action: 'BOT_ADDED',
      })
    );

    // Also send a dedicated message type for bot installation
    ws.send(
      JSON.stringify({
        type: 'discord_bot_installed',
        discord: {
          memberCount: serverDetails.memberCount,
          papersShared: 0,
          messagesCount: 0,
          qualityScore: 0,
          verified: true,
          serverName: serverDetails.guildName || discordRecord.serverName || 'Your Discord Server',
          botAdded: true,
        },
      })
    );

    // Check for level up if applicable
    if (project && project.level === 2 && serverDetails.memberCount >= 4) {
      const newLevel = 3; // Define variable instead of hardcoding
      await prisma.project.update({
        where: { id: userId },
        data: { level: newLevel },
      });

      const levelUpMessage = {
        content: `## Level ${newLevel} Unlocked! 🚀

**Congratulations!** Your BioDAO community now has **${serverDetails.memberCount} members**. You've advanced to **Level ${newLevel}!**

### New Level Requirements:
- Increase to **10 community members** (currently: ${serverDetails.memberCount})
- Share **25 scientific papers** in your Discord
- Reach **100 quality messages** in your server

Continue growing your community and sharing valuable scientific content to progress to Level 4!`,
      };

      await saveChatMessage(sessionId, levelUpMessage, true, 'LEVEL_UP', true);

      ws.send(
        JSON.stringify({
          type: 'level_up',
          level: newLevel,
          message: levelUpMessage.content,
          nextLevelRequirements: [
            'Grow your community to 10+ Discord members',
            'Share at least 25 scientific papers in your server',
            'Reach 100+ quality messages in your community',
          ],
        })
      );

      // Send level up email notification
      if (project.email) {
        try {
          await sendLevelUpEmail(project.email, newLevel);
          console.log(
            `Level up email sent to ${project.email} for level ${newLevel} (triggered by bot installation)`
          );
        } catch (emailError) {
          console.error(`Error sending level up email for project ${userId}:`, emailError);
        }
      }
    }

    // Check and perform level up
    await checkAndPerformLevelUp(project, ws);

    console.log(
      `Discord bot installation processed for user ${userId}, server: ${serverDetails.guildName || serverDetails.guildId}`
    );
    return;
  } catch (error) {
    console.error('Error handling bot installation:', error);
    ws.send(
      JSON.stringify({
        type: 'error',
        message: 'Failed to process Discord bot installation',
      })
    );
    return;
  }
}

/**
 * Handles when a Discord bot is added to a new server
 * This function is called from the Discord bot's guildCreate event
 *
 * @param guildId The ID of the guild that was created
 * @param guildName The name of the guild
 * @param memberCount The current member count of the guild
 */
async function handleGuildCreate(
  guildId: string,
  guildName: string,
  memberCount: number
): Promise<void> {
  try {
    console.log(`Bot added to a new server: ${guildName} (ID: ${guildId})`);

    // Find the Discord record internally
    const discordRecord = await prisma.discord.findFirst({
      where: { serverId: guildId },
    });

    if (discordRecord) {
      // Update the record directly
      await prisma.discord.update({
        where: { id: discordRecord.id },
        data: {
          botAdded: true,
          botAddedAt: new Date(),
          memberCount: memberCount,
          verified: true,
        },
      });

      // Get user and send notification
      const project = await prisma.project.findUnique({
        where: { id: discordRecord.projectId },
      });

      if (project) {
        const sessionId = await getOrCreateChatSession(project.id);
        // Find the user's WebSocket connection
        const ws = activeConnections[project.id];

        const botAddedMessage = {
          content: `## Discord Bot Successfully Added! 🎉

**Great news!** The verification bot has been successfully added to your Discord server "${guildName || 'Your Discord Server'}".

### Current Stats:
- **Members:** ${memberCount} ${memberCount === 1 ? 'member' : 'members'}
- **Messages:** 0 (tracking starts now)
- **Papers shared:** 0 (tracking starts now)

### What This Means:
- ✅ Your Discord server is now **fully verified**
- ✅ Member counts and activity are being **automatically tracked**
- ✅ Scientific papers shared in the server will be **detected and counted**
- ✅ All metrics will update in **real-time** towards your level progression

${memberCount >= 4 ? '**Congratulations!** You have enough members to qualify for Level 3!' : `### Next Steps:\nYou need **${4 - memberCount} more ${4 - memberCount === 1 ? 'member' : 'members'}** to reach Level 3.\n\nKeep growing your community by inviting researchers and collaborators to join your server!`}`,
        };

        await saveChatMessage(sessionId, botAddedMessage, true, 'BOT_ADDED', true);

        // If the user has an active WebSocket connection, send them notifications
        if (ws && ws.readyState === WebSocket.OPEN) {
          console.log(`Sending bot installation notification to user ${project.id}`);

          // Send the text message
          ws.send(
            JSON.stringify({
              type: 'message',
              content: botAddedMessage.content,
              action: 'BOT_ADDED',
              isFromAgent: true,
            })
          );

          // Also send the dedicated message type for Discord stats update
          ws.send(
            JSON.stringify({
              type: 'discord_bot_installed',
              discord: {
                memberCount: memberCount,
                papersShared: 0,
                messagesCount: 0,
                qualityScore: 0,
                verified: true,
                serverName: guildName || 'Your Discord Server',
                botAdded: true,
                serverId: guildId,
              },
            })
          );
        } else {
          console.log(
            `User ${project.id} does not have an active WebSocket connection. Message saved to chat history only.`
          );
        }

        // Check and perform level up
        await checkAndPerformLevelUp(project, ws);
      }

      console.log(
        `[Webhook] Successfully registered bot for Discord server ID: ${discordRecord.serverId}`
      );
      console.log(`Successfully registered bot for Discord server: ${guildName || 'Unknown'}`);
    } else {
      console.log(`Could not find Discord record for server ID: ${guildId}`);
    }
  } catch (error) {
    console.error('Failed to process guildCreate event:', error);
  }
}

// Function to check and update user level based on Discord stats
async function checkAndUpdateUserLevel(project: any) {
  // Skip if user is already at the maximum level
  if (project.level >= 4) return;

  // Level 3 requires Discord creation and 4 members
  if (
    project.level === 2 &&
    project.Discord &&
    project.Discord.botAdded &&
    project.Discord.memberCount >= 4
  ) {
    await prisma.project.update({
      where: { id: project.id },
      data: { level: 3 },
    });

    // Notify user about level up
    const sessionId = await getOrCreateChatSession(project.id);
    const levelUpMessage =
      "Congratulations! Your BioDAO community now has 4 members. You've advanced to Level 3!";

    await saveChatMessage(sessionId, levelUpMessage, true, 'LEVEL_UP', true);

    // Send notification if user is connected
    const userConnection = activeConnections[project.id];
    if (userConnection) {
      userConnection.send(
        JSON.stringify({
          type: 'message',
          content: levelUpMessage,
          action: 'LEVEL_UP',
          isFromAgent: true,
        })
      );
      userConnection.send(
        JSON.stringify({
          type: 'level_up',
          previousLevel: 2,
          newLevel: 3,
          message: levelUpMessage,
          nextLevelRequirements: [
            'Grow your community to 10+ Discord members',
            'Share at least 25 scientific papers in your server',
            'Reach 100+ quality messages in your community',
          ],
        })
      );
    }

    // Send level up email
    await sendLevelUpEmail(project.email, 3);
  }

  // Level 4 requires 10 Discord members, 25 papers, 100 messages
  if (
    project.level === 3 &&
    project.Discord &&
    project.Discord.memberCount >= 5 &&
    project.Discord.papersShared >= 5 &&
    project.Discord.messagesCount >= 50
  ) {
    await prisma.project.update({
      where: { id: project.id },
      data: { level: 4 },
    });

    // Notify user about level up
    const sessionId = await getOrCreateChatSession(project.id);
    const levelUpMessage =
      "Congratulations! Your BioDAO community has reached critical mass with 10+ members, 25+ papers shared, and 100+ messages. You've advanced to Level 4! You now have access to the BioDAO sandbox. The Bio team will reach out to you via email shortly to schedule a call to discuss next steps.";

    await saveChatMessage(sessionId, levelUpMessage, true, 'LEVEL_UP', true);

    // Send notification if user is connected
    const userConnection = activeConnections[project.id];
    if (userConnection) {
      userConnection.send(
        JSON.stringify({
          type: 'message',
          content: levelUpMessage,
          action: 'LEVEL_UP',
          isFromAgent: true,
        })
      );
      userConnection.send(
        JSON.stringify({
          type: 'level_up',
          previousLevel: 3,
          newLevel: 4,
          message: levelUpMessage,
          nextLevelRequirements: [
            'All requirements completed - congratulations!',
            'The Bio team will contact you to schedule a call',
            'You now have access to the full BioDAO sandbox',
          ],
        })
      );
    }

    // Send sandbox notification email to James
    await sendSandboxEmail(project);
  }
}

// Utility: Normalize markdown for clean rendering (same as in AI)
function normalizeMarkdown(content: string): string {
  if (!content) return '';
  let normalized = content.trim();
  normalized = normalized.replace(/\n{3,}/g, '\n\n');
  normalized = normalized.replace(/(\d+\.)(?:\n\s*){2,}(?=\d+\.)/g, '$1\n');
  normalized = normalized.replace(/(\* .+)(\n)(?!\n|\* )/g, '$1\n');
  normalized = normalized.replace(/^(\s*\n)+|((\n\s*)+)$/g, '');
  return normalized;
}

export {
  initWebSocketServer,
  activeConnections,
  handleBotInstalled,
  handleGuildCreate,
  checkAndPerformLevelUp,
  checkAndUpdateUserLevel,
};
