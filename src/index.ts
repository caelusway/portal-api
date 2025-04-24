import express from 'express';
import http from 'http';
import { WebSocketServer, WebSocket as WS } from 'ws';
import dotenv from 'dotenv';
import cors from 'cors';
import { PrismaClient, Project } from '@prisma/client';
import { processMessage } from './ai';
import axios from 'axios';
import bodyParser from 'body-parser';
import { Client, GatewayIntentBits } from 'discord.js';
import { detectPaper, analyzeScientificPdf } from './paper-detection';
import { mintIdeaNft, mintVisionNft, isTransactionConfirmed } from './nft-service';
import { Hex } from 'viem';
import path from 'path';
import { generateIdeaNFTImage, generateVisionNFTImage } from './image-generation-service';
import { createMetricsUpdateMessage } from './ai';
import { v4 as uuidv4 } from 'uuid';
import * as crypto from 'crypto';
import fs from 'fs';
import { checkDiscordLevelProgress } from './utils/discord.utils';

dotenv.config();
const prisma = new PrismaClient();
const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

// Map to store active WebSocket connections by user ID
const activeConnections: Record<string, WS> = {};

/**
 * Get an existing chat session or create a new one
 * @param userId User ID to get or create a session for
 * @returns Session ID string
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

// Save a chat message to the database
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

// Function to check if bot is installed and generate installation link if needed
async function checkBotInstallationStatus(
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
    const clientId = process.env.DISCORD_CLIENT_ID || '1361285493521907832'; // Use env variable or fallback
    const permissions = '8'; // Permissions needed (Administrator)
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
 * Marks the Discord bot as installed for a user's server
 * @param userId The user ID associated with the Discord server
 * @returns Boolean indicating success or failure
 */
async function markBotAsInstalled(userId: string): Promise<boolean> {
  try {
    const result = await prisma.discord.updateMany({
      where: { projectId: userId },
      data: {
        botAdded: true,
        botAddedAt: new Date(),
      },
    });

    return result.count > 0;
  } catch (error) {
    console.error('Error marking bot as installed:', error);
    return false;
  }
}

// Handle the message from user to AI or AI to user
async function handleAIInteraction(
  ws: any,
  userId: string,
  userMessage: string,
  userName: string
): Promise<void> {
  try {
    // Get user with Discord info
    const project = await prisma.project.findUnique({
      where: {
        id: userId,
      },
      include: {
        Discord: true,
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

    // Save the user's message
    await saveChatMessage(sessionId, userMessage, false);

    // Check bot installation status if applicable
    const botStatus = await checkBotInstallationStatus(userId);

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

    // Send AI response to the client WITHOUT including the bot link separately
    ws.send(
      JSON.stringify({
        type: 'message',
        content: enhancedResponse,
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

    // Remove the automatic guidance message - no longer send additional guidance after each user message
    // await sendCoreAgentGuidance(ws, userId);

    // If we want to re-enable this in the future, use the source parameter
    // await sendCoreAgentGuidance(ws, userId, 'user_message');
  } catch (error) {
    console.error('Error handling AI interaction:', error);
    ws.send(
      JSON.stringify({
        type: 'error',
        message: 'Error processing your message',
      })
    );
  }
}

// Check for level up conditions based on real data
async function checkLevelUpConditions(
  userId: string,
  currentLevel: number,
  discordStats: any,
  ws: any
): Promise<void> {
  try {
    // Level 2 to Level 3: Need 4+ Discord members and verified status
    if (currentLevel === 2 && discordStats.verified && discordStats.memberCount >= 4) {
      await prisma.project.update({
        where: { id: userId },
        data: { level: 3 },
      });

      console.log(`User ${userId} automatically progressed to Level 3`);
    }
    // Level 3 to Level 4: Need 10+ members, 25+ papers, 100+ messages, 70+ quality score
    else if (
      currentLevel === 3 &&
      discordStats.verified &&
      discordStats.memberCount >= 10 &&
      discordStats.papersShared >= 25 &&
      discordStats.messagesCount >= 100 &&
      discordStats.qualityScore >= 70
    ) {
      await prisma.project.update({
        where: { id: userId },
        data: { level: 4 },
      });

      console.log(`User ${userId} automatically progressed to Level 4`);
    }
  } catch (error) {
    console.error('Error checking level up conditions:', error);
  }
}

// Middleware
app.use(cors());
app.use(express.json());
app.use(bodyParser.json());

// Serve static files from the public directory
app.use(express.static(path.join(__dirname, '../public')));

// WebSocket connection handling
wss.on('connection', (ws) => {
  console.log('Client connected');
  let userId: string | null = null;

  ws.on('message', async (message) => {
    try {
      const data = JSON.parse(message.toString());
      console.log('Received message:', data);

      // Handle different message types
      switch (data.type) {
        case 'auth':
          // Handle WebSocket authentication
          try {
            const { wallet, privyId } = data;

            if (!wallet || !privyId) {
              ws.send(
                JSON.stringify({
                  type: 'error',
                  message: 'Wallet address and Privy ID are required',
                })
              );
              break;
            }

            // First try to find project by privyId
            let project = await prisma.project.findUnique({
              where: { privyId },
            });

            // If not found by privyId, try wallet
            if (!project) {
              project = await prisma.project.findUnique({
                where: { wallet },
              });

              if (project) {
                // Update existing project with privyId
                project = await prisma.project.update({
                  where: { id: project.id },
                  data: { privyId },
                });
              } else {
                // Create new project
                project = await prisma.project.create({
                  data: {
                    wallet,
                    privyId,
                    level: 1,
                  },
                });
              }
            } else if (project.wallet !== wallet) {
              // Update wallet if it changed
              project = await prisma.project.update({
                where: { id: project.id },
                data: { wallet },
              });
            }

            // Set the userId for this WebSocket connection
            userId = project.id;

            // Store the active connection for notifications
            activeConnections[userId] = ws;

            // Send success response
            ws.send(
              JSON.stringify({
                type: 'auth_success',
                userId: project.id,
                privyId: project.privyId,
                level: project.level,
              })
            );

            console.log(`User authenticated via WebSocket: ${userId}`);

            // Send welcome message and auto-mint NFTs
            await handleInitialConnection(ws, project);
          } catch (error) {
            console.error('WebSocket authentication error:', error);
            ws.send(
              JSON.stringify({
                type: 'error',
                message: 'Authentication failed',
              })
            );
          }
          break;

        case 'message':
          // Validate authentication
          if (!userId) {
            ws.send(
              JSON.stringify({
                type: 'error',
                message: 'You must be authenticated to send messages',
              })
            );
            break;
          }

          // Get user data for AI context
          const project = await prisma.project.findUnique({
            where: { id: userId },
          });

          if (!project) {
            ws.send(
              JSON.stringify({
                type: 'error',
                message: 'User not found',
              })
            );
            break;
          }

          // Get user's name or use wallet as fallback
          const userName = project.fullName || project.wallet.substring(0, 8);

          // Process the message with CoreAgent
          await handleAIInteraction(ws, userId, data.content, userName);
          break;

        case 'get_nfts':
          // Validate authentication
          if (!userId) {
            ws.send(
              JSON.stringify({
                type: 'error',
                message: 'You must be authenticated to fetch NFTs',
              })
            );
            break;
          }

          handleGetNFTs(ws, userId);
          break;

        case 'discord_setup':
          // Validate authentication
          if (!userId) {
            ws.send(
              JSON.stringify({
                type: 'error',
                message: 'You must be authenticated to set up Discord',
              })
            );
            break;
          }

          // Process Discord setup with the provided invite link
          if (!data.content) {
            ws.send(
              JSON.stringify({
                type: 'error',
                message: 'Discord invite link is required',
              })
            );
            break;
          }

          await handleDiscordSetup(ws, userId, { content: data.content });
          break;

        case 'get_level_status':
          console.log('[WS] Received level status request from client');

          try {
            const project = await prisma.project.findUnique({
              where: { id: userId || '' },
              include: {
                Discord: true,
                NFTs: true,
              },
            });

            if (!project) {
              console.warn(`[WS] Project ${userId} not found for level status request`);
              return;
            }

            // Calculate current progress
            const progress = await calculateUserProgress(project);

            // Get requirements for next level
            const requirements = getNextLevelRequirements(project.level);

            // Format progress data based on current level
            let formattedProgress: Record<
              string,
              { current: number; required: number; percent: number }
            > = {};

            if (project.level === 1) {
              // Level 1 - NFT minting progress
              formattedProgress.ideaNFT = {
                current: progress.ideaNFT ? 1 : 0,
                required: 1,
                percent: progress.ideaNFT ? 100 : 0,
              };
              formattedProgress.visionNFT = {
                current: progress.visionNFT ? 1 : 0,
                required: 1,
                percent: progress.visionNFT ? 100 : 0,
              };
            } else if (project.level === 2 && project.Discord) {
              // Level 2 - Discord setup progress
              formattedProgress.botAdded = {
                current: progress.botAdded ? 1 : 0,
                required: 1,
                percent: progress.botAdded ? 100 : 0,
              };
              formattedProgress.members = {
                current: progress.memberCount,
                required: 4,
                percent: Math.min(100, Math.round((progress.memberCount / 4) * 100)),
              };
            } else if (project.level === 3 && project.Discord) {
              // Level 3 - Community growth progress
              formattedProgress.members = {
                current: progress.memberCount,
                required: 10,
                percent: Math.min(100, Math.round((progress.memberCount / 10) * 100)),
              };
              formattedProgress.papers = {
                current: progress.papersShared,
                required: 25,
                percent: Math.min(100, Math.round((progress.papersShared / 25) * 100)),
              };
              formattedProgress.messages = {
                current: progress.messagesCount,
                required: 100,
                percent: Math.min(100, Math.round((progress.messagesCount / 100) * 100)),
              };
            }

            // Send the current level status back to the client
            ws.send(
              JSON.stringify({
                type: 'level_status',
                level: project.level,
                requirements,
                progress: formattedProgress,
                timestamp: Date.now(),
              })
            );

            console.log(`[WS] Sent level status for project ${userId} (level ${project.level})`);
          } catch (error) {
            console.error('[WS] Error handling level status request:', error);
          }
          break;

        // ... other cases ...
      }
    } catch (error) {
      console.error('Error handling message:', error);
      ws.send(
        JSON.stringify({
          type: 'error',
          message: 'Error processing your request',
        })
      );
    }
  });

  ws.on('close', () => {
    console.log('Client disconnected');
  });
});

// Function to handle NFT fetching
async function handleGetNFTs(ws: any, userId: string): Promise<void> {
  try {
    // Fetch user's NFTs
    const nfts = await prisma.nFT.findMany({
      where: {
        projectId: userId,
      },
      orderBy: {
        mintedAt: 'desc',
      },
    });

    // Send the NFTs to the client
    ws.send(
      JSON.stringify({
        type: 'nfts_data',
        nfts: nfts.map((nft) => ({
          id: nft.id,
          type: nft.type,
          mintedAt: nft.mintedAt,
          imageUrl: 'imageUrl' in nft ? nft.imageUrl : null,
          transactionHash: 'transactionHash' in nft ? nft.transactionHash : null,
        })),
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

// Handle NFT minting process
async function handleNftMinting(ws: any, userId: string, nftType: string): Promise<boolean> {
  try {
    console.log(`Processing ${nftType} NFT for user ${userId}`);

    // Check if user already has this NFT type
    const existingNFT = await prisma.nFT.findFirst({
      where: {
        projectId: userId,
        type: nftType,
      },
    });

    if (existingNFT) {
      console.log(`User already has ${nftType} NFT (id: ${existingNFT.id})`);

      // Send success message to the client with existing NFT data
      ws.send(
        JSON.stringify({
          type: 'nft_minted',
          nftType,
          alreadyMinted: true,
          imageUrl: 'imageUrl' in existingNFT ? existingNFT.imageUrl : null,
          message: `You've already minted a ${nftType === 'idea' ? 'Idea' : 'Vision'} NFT.`,
        })
      );

      // Inform CoreAgent about the existing NFT
      await saveChatMessage(
        await getOrCreateChatSession(userId),
        `You've already minted a ${nftType === 'idea' ? 'Idea' : 'Vision'} NFT. If you'd like to see it, check your wallet or the NFTs tab.`,
        true,
        `check_existing_${nftType}_nft`,
        true
      );

      return true;
    }

    // Get the user's wallet address and project details
    const project = await prisma.project.findUnique({
      where: { id: userId },
      select: { wallet: true, projectDescription: true, projectVision: true },
    });

    if (!project) {
      throw new Error('User not found');
    }

    const walletAddress = project.wallet as Hex;

    // Import mint functions
    const { mintIdeaNft, mintVisionNft } = await import('./nft-service');

    // Mint the NFT on-chain immediately
    console.log(`Minting ${nftType} NFT...`);
    let txHash: Hex;

    if (nftType === 'idea') {
      txHash = await mintIdeaNft(walletAddress);
    } else if (nftType === 'vision') {
      txHash = await mintVisionNft(walletAddress);
    } else {
      throw new Error(`Unsupported NFT type: ${nftType}`);
    }

    // Store the NFT in the database without waiting for image
    const nft = await prisma.nFT.create({
      data: {
        type: nftType,
        projectId: userId,
        ...(txHash ? { transactionHash: txHash.toString() } : {}),
      },
    });

    // Send success message to the client immediately
    const nftTypeDisplay = getNftDisplayName(nftType);
    ws.send(
      JSON.stringify({
        type: 'nft_minted',
        nftType,
        transactionHash: txHash,
        imageUrl: null, // Image will be updated later
        message: `Your ${nftTypeDisplay} NFT has been minted successfully!`,
      })
    );

    // Save the chat message about successful minting
    await saveChatMessage(
      await getOrCreateChatSession(userId),
      `I've minted your ${nftTypeDisplay} NFT successfully. The transaction has been recorded on the blockchain with hash: ${txHash.toString().substring(0, 10)}... I'll generate a unique image for it in the background.`,
      true,
      `mint_${nftType}_nft`,
      true
    );

    // Check if we should level up the user
    await checkAndUpdateUserLevel(project);

    // Generate image asynchronously in the background
    // This doesn't block the minting process
    generateNftImageInBackground(userId, nft.id, nftType, project, ws);

    return true;
  } catch (error) {
    console.error(`Error minting NFT:`, error);

    // Send error message to the client
    ws.send(
      JSON.stringify({
        type: 'error',
        message: `Failed to mint NFT: ${error instanceof Error ? error.message : String(error)}`,
      })
    );

    // Inform CoreAgent about the failure
    const nftTypeDisplay = getNftDisplayName(nftType);
    await saveChatMessage(
      await getOrCreateChatSession(userId),
      `I encountered an error while trying to mint your ${nftTypeDisplay} NFT: ${error instanceof Error ? error.message : String(error)}. Please try again later.`,
      true,
      `mint_${nftType}_nft_error`,
      false
    );

    return false;
  }
}

/**
 * Generate NFT image in background without blocking the minting process
 */
async function generateNftImageInBackground(
  userId: string,
  nftId: string,
  nftType: string,
  project: any,
  ws: any
): Promise<void> {
  try {
    console.log(`Generating image for ${nftType} NFT in background`);
    let imageUrl: string | null = null;

    // Generate image based on NFT type
    if (nftType === 'idea' && project.projectDescription) {
      const { generateIdeaNFTImage } = await import('./image-generation-service');
      imageUrl = await generateIdeaNFTImage(userId, project.projectDescription);
      console.log(`Successfully generated Idea NFT image: ${imageUrl}`);
    } else if (nftType === 'vision' && project.projectVision) {
      const { generateVisionNFTImage } = await import('./image-generation-service');
      imageUrl = await generateVisionNFTImage(userId, project.projectVision);
      console.log(`Successfully generated Vision NFT image: ${imageUrl}`);
    } else {
      console.warn(
        `Missing ${nftType === 'idea' ? 'project description' : 'project vision'} for image generation or unsupported NFT type`
      );
      return;
    }

    // Update NFT record with image URL
    if (imageUrl) {
      await prisma.nFT.update({
        where: { id: nftId },
        data: { imageUrl },
      });

      // Notify the client that image is ready
      ws.send(
        JSON.stringify({
          type: 'nft_image_ready',
          nftId,
          nftType,
          imageUrl,
        })
      );

      console.log(`Updated NFT ${nftId} with image URL: ${imageUrl}`);
    }
  } catch (imageError) {
    console.error('Error generating NFT image in background:', imageError);
    // Failure to generate image doesn't affect the minting process
    // The NFT is still valid without an image
  }
}

/**
 * Helper function to get the display name for an NFT type
 */
function getNftDisplayName(nftType: string): string {
  switch (nftType) {
    case 'idea':
      return 'Idea';
    case 'vision':
      return 'Vision';
    default:
      return nftType.charAt(0).toUpperCase() + nftType.slice(1);
  }
}

// Handle Discord server setup with real-time data
async function handleDiscordSetup(
  ws: any,
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
    const { inviteLink, inviteCode } = extractDiscordInfo(content);

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

    // Create webhook URL for bot verification
    const webhookBaseUrl = process.env.API_URL || 'http://localhost:3001';
    const webhookUrl = `${webhookBaseUrl}/api/discord/verify?token=${verificationToken}&userId=${userId}&serverId=${finalServerId}`;

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

    // Add a separate message for the agent to explain next steps
    const agentMessage = {
      content: `## Discord Server Connected: "${serverDisplayName}" 🎉

**Current Members:** ${memberCount} ${memberCount === 1 ? 'member' : 'members'}

### Next Steps:
1. **Add our DAO bot to your server** using this link: ${botInstallationUrl}
2. This verification step ensures:
   - You own the server
   - We can track your Discord metrics accurately
   - Your progress counts toward level advancement

Once the bot is added, your Discord stats will be automatically tracked and will count towards your BioDAO level progress. The bot helps us monitor member count, messages, and scientific papers shared.`,
    };

    await saveChatMessage(chatSession, agentMessage, true, 'discord_setup_completed', true);

    // Send success message with Discord info (but without the botInstallationUrl)
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
        },
        pendingVerification: true,
      })
    );

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
 * Generate a unique verification token for Discord bot installation
 */
function generateVerificationToken(userId: string, serverId: string): string {
  return `verify_${userId.substring(0, 8)}_${serverId.substring(0, 8)}_${Date.now().toString(36)}`;
}

// Simple string hash function for generating consistent IDs
function hashCode(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash |= 0; // Convert to 32bit integer
  }
  return hash;
}

// Handle call scheduling
async function handleCallScheduling(
  ws: any,
  userId: string,
  userMessage: string
): Promise<boolean> {
  try {
    // Get the user's level
    const project = await prisma.project.findUnique({
      where: { id: userId },
    });

    if (!project) {
      ws.send(
        JSON.stringify({
          type: 'error',
          message: 'User not found',
        })
      );
      return false;
    }

    // For Level 4 users, inform them that the Bio team will contact them
    if (project.level === 4) {
      const message =
        "The Bio team will reach out to you via email shortly to schedule a call. There's no need to request a call - they will contact you directly to discuss your BioDAO's next steps.";

      ws.send(
        JSON.stringify({
          type: 'message',
          content: message,
        })
      );

      // Log this in chat history
      const sessionId = await getOrCreateChatSession(userId);
      await saveChatMessage(sessionId, message, true, 'call_scheduling_info', true);

      return true;
    }

    // For other levels, inform them they're not ready for a team call yet
    else {
      const message =
        'Team calls are available for Level 4 users. Complete the requirements to reach Level 4, and the Bio team will contact you directly to schedule a call.';

      ws.send(
        JSON.stringify({
          type: 'message',
          content: message,
        })
      );

      // Log this in chat history
      const sessionId = await getOrCreateChatSession(userId);
      await saveChatMessage(sessionId, message, true, 'call_scheduling_info', true);

      return true;
    }
  } catch (error) {
    console.error('Error handling call scheduling info:', error);
    ws.send(
      JSON.stringify({
        type: 'error',
        message: 'Failed to provide call scheduling information',
      })
    );
    return false;
  }
}

// Simple REST endpoints
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

// Privy authentication endpoint
app.post('/api/auth/privy', async (req: any, res: any) => {
  try {
    const { wallet, privyId } = req.body;

    if (!wallet || !privyId) {
      return res.status(400).json({
        error: 'Wallet address and Privy ID are required',
      });
    }

    // First try to find user by privyId
    let project = await prisma.project.findUnique({
      where: { privyId },
    });

    // If not found by privyId, try wallet
    if (!project) {
      project = await prisma.project.findUnique({
        where: { wallet },
      });

      if (project) {
        // Update existing user with privyId
        project = await prisma.project.update({
          where: { id: project.id },
          data: { privyId },
        });
      } else {
        // Create new user
        project = await prisma.project.create({
          data: {
            wallet,
            privyId,
            level: 1,
          },
        });
      }
    } else if (project.wallet !== wallet) {
      // Update wallet if it changed
      project = await prisma.project.update({
        where: { id: project.id },
        data: { wallet },
      });
    }

    return res.json({
      userId: project.id,
      privyId: project.privyId,
      level: project.level,
    });
  } catch (error) {
    console.error('Authentication error:', error);
    return res.status(500).json({
      error: 'Authentication failed',
    });
  }
});

// Get user by Privy ID
app.get('/api/users/privy/:privyId', async (req: any, res: any) => {
  try {
    const { privyId } = req.params;

    const project = await prisma.project.findUnique({
      where: { privyId },
      include: {
        NFTs: true,
        Discord: true,
      },
    });

    if (!project) {
      return res.status(404).json({
        error: 'Project not found',
      });
    }

    return res.json(project);
  } catch (error) {
    console.error('Error fetching project:', error);
    return res.status(500).json({
      error: 'Failed to fetch project',
    });
  }
});

// Get chat sessions by project ID

// Get all chat sessions
app.get('/api/chat/sessions', async (req: any, res: any) => {
  try {
    // Optional query parameters for pagination
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;

    // Get total count for pagination
    const totalCount = await prisma.chatSession.count();

    // Get chat sessions with pagination
    const chatSessions = await prisma.chatSession.findMany({
      include: {
        messages: {
          orderBy: {
            timestamp: 'asc',
          },
        },
        project: {
          select: {
            id: true,
            wallet: true,
            level: true,
            projectName: true,
          },
        },
      },
      orderBy: {
        updatedAt: 'desc',
      },
      skip,
      take: limit,
    });

    return res.json({
      data: chatSessions,
      pagination: {
        total: totalCount,
        page,
        limit,
        pages: Math.ceil(totalCount / limit),
      },
    });
  } catch (error) {
    console.error('Error fetching all chat sessions:', error);
    return res.status(500).json({
      error: 'Failed to fetch chat sessions',
    });
  }
});

// Get chat messages by session ID

// Function to send a level up email
async function sendLevelUpEmail(userEmail: string, level: number) {
  try {
    // Implement email sending logic here
    console.log(`Sending level ${level} congratulations email to ${userEmail}`);
    // This would call your email service
  } catch (error) {
    console.error('Failed to send level up email:', error);
  }
}

// Function to send sandbox notification email to James
async function sendSandboxEmail(project: any) {
  try {
    // Implement email sending logic here
    console.log(`Sending sandbox notification email about user ${project.id} to James`);
    // This would call your email service with James' email and user details
  } catch (error) {
    console.error('Failed to send sandbox notification email:', error);
  }
}

// Enhance the Discord API integration with better error handling and real data
async function fetchDiscordServerInfo(inviteCode: string): Promise<{
  serverId: string | null;
  error?: string;
  memberCount?: number;
  approximateMemberCount?: number;
  name?: string;
  icon?: string;
}> {
  try {
    // Add more detailed logging
    console.log(`Attempting to fetch Discord server info for invite: "${inviteCode}"`);

    // Remove any prefixes from the invite code
    const cleanInviteCode = inviteCode.replace(
      /^(https?:\/\/)?(discord\.gg\/|discord\.com\/invite\/)/i,
      ''
    );

    // Also remove any trailing characters that might not be part of the invite
    const finalInviteCode = cleanInviteCode.split(/[^a-zA-Z0-9-]/)[0];

    console.log(`Cleaned invite code: "${finalInviteCode}"`);

    // Check if invite code seems valid
    if (!finalInviteCode || finalInviteCode.length < 2) {
      console.warn(`Invalid invite code format: "${inviteCode}" -> "${finalInviteCode}"`);
      return {
        serverId: null,
        error: 'Invalid invite code format',
      };
    }

    console.log(`Fetching Discord server info for cleaned invite: ${finalInviteCode}`);

    // Discord API endpoint for invite info
    const response = await axios.get(
      `https://discord.com/api/v10/invites/${finalInviteCode}?with_counts=true`,
      {
        timeout: 5000, // 5 second timeout
        headers: {
          'User-Agent': 'BioDAO Portal/1.0',
        },
      }
    );

    // Log the response data for debugging
    console.log(
      `Discord API responded with status ${response.status}:`,
      response.data ? JSON.stringify(response.data, null, 2) : 'No data'
    );

    if (response.data && response.data.guild) {
      // Extract all relevant server information
      const serverInfo = {
        serverId: response.data.guild.id,
        name: response.data.guild.name,
        icon: response.data.guild.icon
          ? `https://cdn.discordapp.com/icons/${response.data.guild.id}/${response.data.guild.icon}.png`
          : undefined,
        // Approximate member count from the invite data
        approximateMemberCount: response.data.approximate_member_count || 0,
        // Online member count if available
        memberCount: response.data.approximate_presence_count || 0,
      };

      console.log(
        `Successfully fetched server info for ${serverInfo.name} (${serverInfo.serverId}) with ${serverInfo.approximateMemberCount} members`
      );
      return serverInfo;
    }

    console.warn(`Could not extract guild data from Discord API response:`, response.data);
    return { serverId: null, error: 'Could not retrieve server information from invite' };
  } catch (error: any) {
    console.error('Error fetching Discord server info:', error.message);

    // Enhanced logging for better debugging
    if (error.response) {
      console.error(
        `Discord API error with status ${error.response.status}:`,
        error.response.data ? JSON.stringify(error.response.data, null, 2) : 'No error data'
      );
    } else if (error.request) {
      console.error('Discord API timeout - no response received');
    }

    // Provide more detailed error information
    if (error.response) {
      // The request was made and the server responded with a status code
      // that falls out of the range of 2xx
      if (error.response.status === 404) {
        return { serverId: null, error: 'Invalid Discord invite - not found' };
      } else if (error.response.status === 429) {
        return { serverId: null, error: 'Rate limited by Discord API' };
      } else {
        return { serverId: null, error: `Discord API error: ${error.response.status}` };
      }
    } else if (error.request) {
      // The request was made but no response was received
      return { serverId: null, error: 'Discord API timeout - no response' };
    } else {
      // Something happened in setting up the request that triggered an Error
      return { serverId: null, error: `Failed to verify Discord invite: ${error.message}` };
    }
  }
}

// Start the server
const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`Server started on port ${PORT}`);

  // Initialize Discord bot if token is available
  if (process.env.DISCORD_BOT_TOKEN) {
    //initDiscordBot();
  } else {
    console.log('Discord bot not started: DISCORD_BOT_TOKEN environment variable not set');
  }

  // Start periodic level check
  //startPeriodicLevelCheck();
});

/**
 * Initialize and start the Discord bot
 */
function initDiscordBot() {
  // Initialize Discord client
  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMembers,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
    ],
  });

  // Track papers shared by looking for links/attachments
  const papersSharedByGuild: Record<string, number> = {};

  // Track message count by guild
  const messageCountByGuild: Record<string, number> = {};

  // Simple quality score calculation
  const qualityScoreByGuild: Record<string, number> = {};

  // Connect to Discord
  client.on('ready', () => {
    console.log(`Discord bot is ready! Logged in as ${client.user?.tag}`);

    // Initialize all guilds with data from database
    initializeAllGuilds();
  });

  // Initialize all guilds from database values
  async function initializeAllGuilds() {
    try {
      console.log(`[Bot] Initializing all guilds with database values...`);

      // Get all Discord records from database
      const discordRecords = await prisma.discord.findMany();
      console.log(`[Bot] Found ${discordRecords.length} Discord records in database`);

      // For each guild the bot is in
      client.guilds.cache.forEach(async (guild) => {
        console.log(`[Bot] Initializing tracking for guild: ${guild.name} (${guild.id})`);

        // Find matching record in database
        const discordRecord = discordRecords.find(
          (record: { serverId: string }) => record.serverId === guild.id
        );

        if (discordRecord) {
          // Initialize tracking with database values
          messageCountByGuild[guild.id] = discordRecord.messagesCount;
          papersSharedByGuild[guild.id] = discordRecord.papersShared;
          qualityScoreByGuild[guild.id] = discordRecord.qualityScore;

          console.log(
            `[Bot] Initialized guild ${guild.name} with database values: ${discordRecord.messagesCount} messages, ${discordRecord.papersShared} papers`
          );
        } else {
          // Initialize with default values
          messageCountByGuild[guild.id] = 0;
          papersSharedByGuild[guild.id] = 0;
          qualityScoreByGuild[guild.id] = 50;

          console.log(
            `[Bot] No database record found for guild ${guild.name}, initialized with default values`
          );
        }
      });

      console.log(`[Bot] Guild initialization complete`);
    } catch (error) {
      console.error(`[Bot] Error initializing guilds:`, error);
    }
  }

  // Listen for when the bot joins a new server
  client.on('guildCreate', async (guild) => {
    console.log(`Bot added to a new server: ${guild.name} (ID: ${guild.id})`);

    try {
      // Initialize counters for this guild
      papersSharedByGuild[guild.id] = 0;
      messageCountByGuild[guild.id] = 0;
      qualityScoreByGuild[guild.id] = 50; // Default quality score

      // Find the Discord record internally
      const discordRecord = await prisma.discord.findFirst({
        where: { serverId: guild.id },
      });

      if (discordRecord) {
        // Update the record directly
        await prisma.discord.update({
          where: { id: discordRecord.id },
          data: {
            botAdded: true,
            botAddedAt: new Date(),
            memberCount: guild.memberCount,
            verified: true,
          },
        });

        // Get user and send notification
        const project = await prisma.project.findUnique({
          where: { id: discordRecord.projectId },
        });

        if (project) {
          const sessionId = await getOrCreateChatSession(project.id);

          const botAddedMessage = {
            content: `## Discord Bot Successfully Added! 🎉

**Great news!** The verification bot has been successfully added to your Discord server "${guild.name || 'Your Discord Server'}".

### Current Stats:
- **Members:** ${discordRecord.memberCount} ${discordRecord.memberCount === 1 ? 'member' : 'members'}
- **Messages:** 0 (tracking starts now)
- **Papers shared:** 0 (tracking starts now)

### What This Means:
- ✅ Your Discord server is now **fully verified**
- ✅ Member counts and activity are being **automatically tracked**
- ✅ Scientific papers shared in the server will be **detected and counted**
- ✅ All metrics will update in **real-time** towards your level progression

${discordRecord.memberCount >= 4 ? '**Congratulations!** You have enough members to qualify for Level 3!' : `### Next Steps:\nYou need **${4 - discordRecord.memberCount} more ${4 - discordRecord.memberCount === 1 ? 'member' : 'members'}** to reach Level 3.\n\nKeep growing your community by inviting researchers and collaborators to join your server!`}`,
          };

          await saveChatMessage(sessionId, botAddedMessage, true, 'BOT_ADDED', true);

          // If the user has an active WebSocket connection, send them a notification
          const userConnection = activeConnections[project.id];
          if (userConnection) {
            userConnection.send(
              JSON.stringify({
                type: 'message',
                content: botAddedMessage.content,
                action: 'BOT_ADDED',
              })
            );
          }

          // Check if this should trigger a level up
          if (project.level === 2 && discordRecord.memberCount >= 4) {
            await prisma.project.update({
              where: { id: project.id },
              data: { level: 3 },
            });

            const levelUpMessage = {
              content: `## Level 3 Unlocked! 🚀

**Congratulations!** Your BioDAO community now has **${discordRecord.memberCount} members**. You've advanced to **Level 3!**

### New Level Requirements:
- Increase to **10 community members** (currently: ${discordRecord.memberCount})
- Share **25 scientific papers** in your Discord
- Reach **100 quality messages** in your server

Continue growing your community and sharing valuable scientific content to progress to Level 4!`,
            };

            await saveChatMessage(sessionId, levelUpMessage, true, 'LEVEL_UP', true);

            if (userConnection) {
              userConnection.send(
                JSON.stringify({
                  type: 'level_up',
                  level: 3,
                  message: levelUpMessage.content,
                })
              );
            }
          }
        }

        console.log(
          `[Webhook] Successfully registered bot for Discord server ID: ${discordRecord.serverId}`
        );
        console.log(
          `Successfully registered bot for Discord server: ${discordRecord.serverName || 'Unknown'}`
        );
      } else {
        console.log(`Could not find Discord record for server ID: ${guild.id}`);
      }
    } catch (error) {
      console.error('Failed to process guildCreate event:', error);
    }
  });

  // Listen for messages to track activity
  client.on('messageCreate', async (message) => {
    // Ignore messages from bots
    if (message.author.bot) return;

    // Check if this is in a guild (not a DM)
    if (!message.guild) return;

    const guildId = message.guild.id;

    // Check if this is a low-value message that shouldn't count toward stats
    const isSpam = isLowValueMessage(message.content);

    // Use the stricter paper detection logic from paper-detection.ts
    // This prevents regular messages from being falsely counted as papers
    const hasAttachment = message.attachments.size > 0;
    let isPaper = false;
    let pdfAttachment = null;

    // Check for PDF attachments first
    if (hasAttachment) {
      for (const [, attachment] of message.attachments) {
        const filename = attachment.name?.toLowerCase() || '';
        if (filename.endsWith('.pdf')) {
          pdfAttachment = attachment;

          // Use the analyzeScientificPdf function to determine if this is a scientific paper
          const paperAnalysis = analyzeScientificPdf(attachment.name || '', attachment.size);

          console.log(
            `PDF Analysis for "${attachment.name}": confidence=${paperAnalysis.confidence}, isScientificPaper=${paperAnalysis.isScientificPaper}`
          );
          console.log(`Reason: ${paperAnalysis.reason}`);

          // Check for the specific case of arXiv papers with format NNNN.NNNNN.pdf
          const isArxivPattern = attachment.name?.match(/^\d{4}\.\d{4,5}\.pdf$/i);
          if (isArxivPattern) {
            console.log(`[Special Case] arXiv-style paper ID detected: ${attachment.name}`);
            isPaper = true;
          } else if (paperAnalysis.isScientificPaper) {
            isPaper = true;
          }

          if (isPaper) {
            // Notify the user that their PDF was detected as a scientific paper
            try {
              await message.react('📚');
              console.log(`[Paper Detection] Successfully reacted to paper message with 📚`);
            } catch (error) {
              console.error('Failed to react to paper message:', error);
            }
            break;
          }
        }
      }
    }

    // If no PDF was found to be a scientific paper, fall back to text-based detection
    if (!isPaper) {
      isPaper = detectPaper(message.content, hasAttachment);
    }

    if (isPaper) {
      // Don't rely on in-memory counter - get data directly from database
      try {
        const discordRecord = await prisma.discord.findFirst({
          where: { serverId: guildId },
        });

        if (discordRecord) {
          // Update the papers shared count directly in database
          // No need to use the in-memory counter
          const updatedRecord = await prisma.discord.update({
            where: { id: discordRecord.id },
            data: {
              // Only ever increment by 1 paper at a time
              papersShared: discordRecord.papersShared + 1,
              updatedAt: new Date(),
            },
          });

          console.log(
            `[Paper Detection] Updated papers count to ${updatedRecord.papersShared} for guild ${guildId}`
          );

          // Update the in-memory counter to match the database
          // This ensures consistency for any other code that might use it
          papersSharedByGuild[guildId] = updatedRecord.papersShared;

          // Get the project to check for level-up
          const project = await prisma.project.findUnique({
            where: { id: discordRecord.projectId },
            include: {
              Discord: true,
              NFTs: true,
            },
          });

          // Notify the user that their message was detected as a scientific paper
          try {
            await message.react('📚');
            console.log(`[Paper Detection] Successfully reacted to paper message with 📚`);
          } catch (error) {
            console.error('Failed to react to paper message:', error);
          }

          if (project) {
            // Check if this paper triggers a level-up
            // This is especially important for level 3 to 4 transitions where papers are a key metric
            console.log(
              `[Paper Detection] Checking level-up after paper detection for project ${project.id}`
            );
            if (
              project.level === 3 &&
              updatedRecord.memberCount >= 10 &&
              updatedRecord.papersShared >= 25 &&
              updatedRecord.messagesCount >= 100
            ) {
              console.log(
                `[Paper Detection] Project ${project.id} meets level 4 requirements after paper detection!`
              );

              // Check if the user is connected via WebSocket
              if (activeConnections[project.id]) {
                await checkAndPerformLevelUp(project, activeConnections[project.id]);
              } else {
                // Even if not connected, update their level and send email
                await prisma.project.update({
                  where: { id: project.id },
                  data: { level: 4 },
                });

                if (project.email) {
                  await sendLevelUpEmail(project.email, 4);
                  await sendSandboxEmail(project);
                }
              }
            }
          }
        }
      } catch (error) {
        console.error(`[Paper Detection] Error updating papers count or checking level-up:`, error);
      }
    }

    // Update quality score based on message length, mentions, etc.
    // This is just a simple example calculation
    const messageQuality = isSpam ? 0 : Math.min(100, Math.floor(message.content.length / 5));
    const currentQuality = qualityScoreByGuild[guildId] || 50;

    // Weighted average to prevent wild fluctuations
    qualityScoreByGuild[guildId] = Math.round(currentQuality * 0.9 + messageQuality * 0.1);

    // Log message processing
    if (message.guild) {
      console.log(
        `Processing message in ${message.guild.name}${isSpam ? ' (filtered as low-value)' : ''}`
      );
    } else {
      console.log(
        `Processing message in guild ID ${guildId}${isSpam ? ' (filtered as low-value)' : ''}`
      );
    }

    try {
      // Get the current record from the database
      const discordRecord = await prisma.discord.findFirst({
        where: { serverId: guildId },
      });

      if (discordRecord) {
        // Only update database if not a spam/low-value message
        if (!isSpam) {
          // Update directly in database, incrementing by 1 for valid messages
          const updatedRecord = await prisma.discord.update({
            where: { id: discordRecord.id },
            data: {
              // Always increment by exactly 1 for non-spam messages
              messagesCount: discordRecord.messagesCount + 1,
              // For papers, don't update the count here since it was already updated in the paper detection section
              papersShared: discordRecord.papersShared,
              qualityScore: qualityScoreByGuild[guildId],
              updatedAt: new Date(),
            },
          });

          // Log update
          console.log(
            `[Discord] Real-time update: message #${updatedRecord.messagesCount} recorded for ${message.guild.name}`
          );

          // Update memory storage to match database
          messageCountByGuild[guildId] = updatedRecord.messagesCount;
          papersSharedByGuild[guildId] = updatedRecord.papersShared;

          // Log special cases
          if (isPaper) {
            console.log(
              `[Discord] Paper detected and counted. Paper count is now: ${updatedRecord.papersShared}`
            );
          }

          // Check if this update triggered level progress
          const project = await prisma.project.findUnique({
            where: { id: discordRecord.projectId },
            include: {
              Discord: true,
              NFTs: true,
            },
          });

          if (project) {
            // Check for level-up if we've reached important message count thresholds
            if (
              updatedRecord.messagesCount === 50 ||
              updatedRecord.messagesCount === 75 ||
              updatedRecord.messagesCount === 100 ||
              updatedRecord.messagesCount === 125 ||
              updatedRecord.messagesCount === 150 ||
              (updatedRecord.messagesCount >= 100 && updatedRecord.messagesCount % 25 === 0)
            ) {
              console.log(
                `[Discord] Message count milestone reached: ${updatedRecord.messagesCount} - checking for level-up`
              );

              // Level 3 to 4 transition depends heavily on message count
              if (
                project.level === 3 &&
                updatedRecord.memberCount >= 10 &&
                updatedRecord.papersShared >= 25 &&
                updatedRecord.messagesCount >= 100
              ) {
                console.log(
                  `[Discord] Project ${project.id} meets level 4 requirements after message milestone!`
                );

                // Check if user is connected to WebSocket
                if (activeConnections[project.id]) {
                  await checkAndPerformLevelUp(project, activeConnections[project.id]);
                } else {
                  // Even if not connected, update level and send emails
                  await prisma.project.update({
                    where: { id: project.id },
                    data: { level: 4 },
                  });

                  if (project.email) {
                    await sendLevelUpEmail(project.email, 4);
                    await sendSandboxEmail(project);
                  }
                }
              }
            }

            // Always check user level on message updates
            await checkAndUpdateUserLevel(project);
          }
        } else {
          // Log spam messages that we're ignoring
          console.log(
            `[Discord] Low-value message detected and ignored from ${message.guild.name}: "${message.content.substring(0, 30)}${message.content.length > 30 ? '...' : ''}"`
          );
        }
      } else {
        console.log(
          `[Discord] Warning: No Discord record found for server ${guildId}, can't update message count`
        );
      }
    } catch (error) {
      console.error(`[Discord] Error updating message count in real-time: ${error}`);

      // Still keep periodic batch updates as a fallback if real-time fails
      if (messageCountByGuild[guildId] % 10 === 0) {
        try {
          if (message.guild) {
            console.log(
              `Batch updating database after ${messageCountByGuild[guildId]} messages for server ${message.guild.name}`
            );
          } else {
            console.log(
              `Batch updating database after ${messageCountByGuild[guildId]} messages for server ID ${guildId}`
            );
          }
          await updateDiscordStats(guildId);
        } catch (error) {
          console.error('Failed to update stats:', error);
          // Retry once after a short delay
          setTimeout(async () => {
            try {
              await updateDiscordStats(guildId);
              console.log(`Successfully updated stats on retry for guild ID ${guildId}`);
            } catch (retryError) {
              console.error('Failed to update stats on retry:', retryError);
            }
          }, 5000);
        }
      }
    }
  });

  // Function to update server stats directly in the database
  async function updateDiscordStats(guildId: string) {
    const guild = client.guilds.cache.get(guildId);
    if (!guild) {
      console.warn(`Cannot update stats: Guild ${guildId} not found in cache`);
      return;
    }

    console.log(`[Discord Stats] Updating stats for ${guild.name} (ID: ${guild.id})`);

    try {
      // Get local stats - for message counts only
      const currentMessages = messageCountByGuild[guildId] || 0;
      const currentQuality = qualityScoreByGuild[guildId] || 50;

      // Find the Discord record
      const discordRecord = await prisma.discord.findFirst({
        where: { serverId: guildId },
      });

      if (!discordRecord) {
        console.warn(
          `[Discord Stats] Could not find Discord record for server ID: ${guildId}. Stats will not be saved.`
        );
        return;
      }

      console.log(
        `[Discord Stats] Found Discord record for ${guild.name}, current DB values: ${discordRecord.messagesCount} messages, ${discordRecord.papersShared} papers`
      );

      // Make sure we don't decrease counts in the database
      const updatedMessageCount = Math.max(discordRecord.messagesCount, currentMessages);

      // For paper count, always trust the database value - don't use in-memory counter
      // This ensures paper count consistency across server restarts
      const updatedPapersShared = discordRecord.papersShared;

      // For quality score, we use the current calculated value
      const updatedQualityScore = currentQuality;

      // Update stats directly
      const updatedRecord = await prisma.discord.update({
        where: { id: discordRecord.id },
        data: {
          memberCount: guild.memberCount,
          papersShared: updatedPapersShared, // Keep the database value
          messagesCount: updatedMessageCount,
          qualityScore: updatedQualityScore,
          updatedAt: new Date(),
        },
      });

      console.log(
        `[Discord Stats] Successfully updated database record for ${guild.name}. Values remain: ${updatedRecord.messagesCount} messages, ${updatedRecord.papersShared} papers, quality: ${updatedRecord.qualityScore}`
      );

      // Update in-memory counters to match database for future consistency
      messageCountByGuild[guildId] = updatedRecord.messagesCount;
      papersSharedByGuild[guildId] = updatedRecord.papersShared;
      qualityScoreByGuild[guildId] = updatedRecord.qualityScore;

      // Get user and check for level up
      const project = await prisma.project.findUnique({
        where: { id: discordRecord.projectId },
      });

      if (project) {
        await checkAndUpdateUserLevel(project);
      }
    } catch (error) {
      console.error(`[Discord Stats] Failed to update stats in database for ${guild.name}:`, error);
      throw error; // Rethrow for the retry mechanism
    }
  }

  // Set up periodic stats updates for all servers (every 15 minutes instead of hourly)
  setInterval(
    () => {
      console.log('[Periodic Update] Running scheduled stats update for all guilds...');
      client.guilds.cache.forEach((guild) => {
        console.log(`[Periodic Update] Updating stats for ${guild.name}`);
        updateDiscordStats(guild.id).catch((error) => {
          console.error(`[Periodic Update] Error updating stats for ${guild.name}:`, error);
        });
      });
      console.log('[Periodic Update] Completed scheduled update');
    },
    15 * 60 * 1000
  ); // Every 15 minutes

  // Log in to Discord
  client
    .login(process.env.DISCORD_BOT_TOKEN)
    .then(() => console.log('Discord bot logged in successfully'))
    .catch((error) => console.error('Failed to log in Discord bot:', error));

  // Add a debugging endpoint to check the current message counts and stats
  app.get('/api/debug/discord-stats/:serverId', async (req: any, res: any) => {
    try {
      const { serverId } = req.params;
      const apiKey = req.query.apiKey || req.headers.authorization?.replace('Bearer ', '');

      // Verify API key
      if (apiKey !== API_KEY) {
        return res.status(401).json({ success: false, error: 'Unauthorized' });
      }

      // Get the Discord record from database
      const discordRecord = await prisma.discord.findFirst({
        where: { serverId },
      });

      if (!discordRecord) {
        return res.status(404).json({
          success: false,
          error: 'Discord server not found',
        });
      }

      // Get in-memory stats
      const memoryMessageCount = messageCountByGuild[serverId] || 0;
      const memoryPapersShared = papersSharedByGuild[serverId] || 0;
      const memoryQualityScore = qualityScoreByGuild[serverId] || 0;

      // Find the guild in Discord
      const guild = client.guilds.cache.get(serverId);
      const guildInfo = guild
        ? {
            name: guild.name,
            memberCount: guild.memberCount,
            botInGuild: true,
          }
        : {
            name: 'Unknown',
            memberCount: 0,
            botInGuild: false,
          };

      // Auto-update if needed
      let updatedRecord = discordRecord;
      const shouldUpdate =
        memoryMessageCount > discordRecord.messagesCount ||
        memoryPapersShared > discordRecord.papersShared;

      if (shouldUpdate && req.query.update === 'true') {
        // Update the database with the latest counts
        updatedRecord = await prisma.discord.update({
          where: { id: discordRecord.id },
          data: {
            messagesCount: Math.max(discordRecord.messagesCount, memoryMessageCount),
            papersShared: Math.max(discordRecord.papersShared, memoryPapersShared),
            qualityScore: memoryQualityScore > 0 ? memoryQualityScore : discordRecord.qualityScore,
            memberCount: guildInfo.memberCount || discordRecord.memberCount,
            updatedAt: new Date(),
          },
        });

        console.log(`[Debug] Updated Discord stats for ${serverId} manually:`, updatedRecord);

        // Force message counts to match database after update
        messageCountByGuild[serverId] = updatedRecord.messagesCount;
        papersSharedByGuild[serverId] = updatedRecord.papersShared;
        qualityScoreByGuild[serverId] = updatedRecord.qualityScore;
      }

      // Return current status
      return res.json({
        success: true,
        discord: {
          id: discordRecord.id,
          serverId: discordRecord.serverId,
          databaseStats: {
            memberCount: updatedRecord.memberCount,
            messagesCount: updatedRecord.messagesCount,
            papersShared: updatedRecord.papersShared,
            qualityScore: updatedRecord.qualityScore,
            botAdded: updatedRecord.botAdded,
            lastUpdated: updatedRecord.updatedAt,
          },
          memoryStats: {
            messagesCount: memoryMessageCount,
            papersShared: memoryPapersShared,
            qualityScore: memoryQualityScore,
          },
          guild: guildInfo,
        },
        actions: {
          shouldUpdate,
          updated: req.query.update === 'true' && shouldUpdate,
        },
        help: 'Append ?update=true to URL to update database with memory values if needed',
      });
    } catch (error) {
      console.error('[Debug] Error fetching Discord stats:', error);
      return res.status(500).json({
        success: false,
        error: 'Server error',
      });
    }
  });
}

/**
 * Start periodic checking of user progress toward next level
 * This sends proactive guidance about current progress and next requirements
 */
function startPeriodicLevelCheck() {
  console.log('Starting periodic level check service...');

  // Standard interval (every 30 minutes)
  setInterval(
    async () => {
      console.log('Running periodic level check...');
      try {
        // Get all projects that have Discord setup
        const projects = await prisma.project.findMany({
          where: {
            Discord: {
              isNot: null,
            },
          },
          include: {
            Discord: true,
            NFTs: true,
          },
        });

        // Check each project for level-up eligibility
        for (const project of projects) {
          await checkDiscordLevelProgress(project);
        }
      } catch (error) {
        console.error('Error in periodic level check:', error);
      }
    },
    30 * 60 * 1000
  ); // 30 minutes
}

/**
 * Check a specific user's progress and send guidance via the CoreAgent
 */
async function checkUserProgressAndSendGuidance(project: any) {
  try {
    const sessionId = await getOrCreateChatSession(project.id);

    // Check if there's been any message in the last 12 hours
    const recentMessages = await prisma.chatMessage.findMany({
      where: {
        sessionId,
        timestamp: {
          gte: new Date(Date.now() - 12 * 60 * 60 * 1000), // 12 hours ago
        },
      },
      orderBy: {
        timestamp: 'desc',
      },
      take: 1,
    });

    // Only send progress updates if user hasn't been active recently
    if (recentMessages.length === 0) {
      // Get progress based on current level
      const progress = await calculateUserProgress(project);

      // Get next level requirements
      const nextLevelRequirements = getNextLevelRequirements(project.level);

      // Format guidance message
      let guidanceMessage = `Hello! Here's an update on your BioDAO progress:\n\nYou are currently at Level ${project.level}.\n\n`;

      // Add progress information
      guidanceMessage += `Your current progress:\n`;

      if (project.level === 1) {
        // Level 1: NFT Minting Progress
        guidanceMessage += `- Idea NFT: ${progress.ideaNFT ? '✅ Minted' : '❌ Not minted yet'}\n`;
        guidanceMessage += `- Vision NFT: ${progress.visionNFT ? '✅ Minted' : '❌ Not minted yet'}\n\n`;
      } else if (project.level === 2) {
        // Level 2: Discord Creation Progress
        guidanceMessage += `- Discord Server: ${progress.discordCreated ? '✅ Created' : '❌ Not created yet'}\n`;
        guidanceMessage += `- Bot added: ${progress.botAdded ? '✅ Added' : '❌ Not added yet'}\n`;
        guidanceMessage += `- Members: ${progress.memberCount || 0}/4 members\n\n`;
      } else if (project.level === 3) {
        // Level 3: Community Growth Progress
        guidanceMessage += `- Members: ${progress.memberCount || 0}/10 members\n`;
        guidanceMessage += `- Papers shared: ${progress.papersShared || 0}/25 papers\n`;
        guidanceMessage += `- Messages sent: ${progress.messagesCount || 0}/100 messages\n\n`;
      }

      // Add next level requirements
      guidanceMessage += `To reach Level ${project.level + 1}, you need to:\n`;
      for (const req of nextLevelRequirements) {
        guidanceMessage += `- ${req}\n`;
      }

      // Add call to action
      if (project.level === 1) {
        guidanceMessage += `\nDo you need help minting your ${!progress.ideaNFT ? 'Idea' : 'Vision'} NFT?`;
      } else if (project.level === 2) {
        guidanceMessage += `\nCan I help you set up your Discord server or invite more members?`;
      } else if (project.level === 3) {
        guidanceMessage += `\nDo you need any strategies to grow your community or increase engagement?`;
      }

      // Save message as from agent
      await saveChatMessage(sessionId, guidanceMessage, true, 'PROGRESS_UPDATE', true);

      // Send WS notification if user is connected
      if (project.id && activeConnections[project.id]) {
        activeConnections[project.id].send(
          JSON.stringify({
            type: 'message',
            content: guidanceMessage,
            action: 'PROGRESS_UPDATE',
          })
        );
        console.log(`Sent progress guidance to user ${project.id}`);
      } else {
        console.log(
          `Project ${project.id || 'unknown'} not connected, progress message saved to chat history`
        );
      }
    }
  } catch (error) {
    console.error(`Error checking progress for user ${project.id}: ${error}`);
  }
}

/**
 * Calculate a user's progress based on their current level
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
 * Get requirements for the next level based on current level
 */
function getNextLevelRequirements(currentLevel: number): string[] {
  switch (currentLevel) {
    case 1:
      return ['Mint your Idea NFT', 'Mint your Vision NFT'];
    case 2:
      return [
        'Create a Discord server',
        'Add our bot to your server',
        'Get at least 4 members in your Discord',
      ];
    case 3:
      return [
        'Grow your Discord to at least 10 members',
        'Share at least 25 research papers',
        'Reach 100 messages in your server',
      ];
    case 4:
      return ["You've reached the highest level! Sandbox access is available now."];
    default:
      return ['Connect your wallet to start your BioDAO journey'];
  }
}

// Add these API routes after the websocket server setup
// Discord Bot API endpoints
app.use(cors());
app.use(express.json());

// API key for bot authentication (should be in environment variable)
const API_KEY = process.env.PORTAL_API_KEY || 'test-api-key';

// Endpoint for bot installation notification
app.post('/discord/bot-installed', async (req: any, res: any) => {
  try {
    const { guildId, guildName, memberCount, apiKey } = req.body;

    // Verify API key
    if (apiKey !== API_KEY) {
      return res.status(401).json({ success: false, error: 'Unauthorized' });
    }

    // Find Discord record with this server ID
    const discord = await prisma.discord.findFirst({
      where: { serverId: guildId },
      include: { project: true },
    });

    if (discord) {
      // Update existing record
      const updatedDiscord = await prisma.discord.update({
        where: { id: discord.id },
        data: {
          botAdded: true,
          botAddedAt: new Date(),
          verified: true,
          memberCount: memberCount || 0,
        },
      });

      // Notify the user if they have an active WebSocket connection
      if (discord.project) {
        const projectId = discord.project.id;
        const userConnection = activeConnections[projectId];

        if (userConnection) {
          // Create a chat session for the notification
          const sessionId = await getOrCreateChatSession(projectId);

          // Create the bot added message
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

          // Save the message to the chat history
          await saveChatMessage(sessionId, botAddedMessage, true, 'BOT_ADDED', true);

          // Send the notification over WebSocket
          userConnection.send(
            JSON.stringify({
              type: 'message',
              content: botAddedMessage.content,
              action: 'BOT_ADDED',
            })
          );

          // Also send a dedicated message type for bot installation
          userConnection.send(
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
              },
            })
          );

          // Check for level up if applicable
          if (discord.project.level === 2 && memberCount >= 4) {
            await prisma.project.update({
              where: { id: projectId },
              data: { level: 3 },
            });

            const levelUpMessage = {
              content: `## Level 3 Unlocked! 🚀

**Congratulations!** Your BioDAO community now has **${memberCount} members**, which means you've advanced to **Level 3!**

### New Level Requirements:
- Increase to **10 community members** (currently: ${memberCount})
- Share **25 scientific papers** in your Discord
- Reach **100 quality messages** in your server

Continue growing your community and sharing valuable scientific content to progress to Level 4!`,
            };

            await saveChatMessage(sessionId, levelUpMessage, true, 'LEVEL_UP', true);

            userConnection.send(
              JSON.stringify({
                type: 'level_up',
                level: 3,
                message: levelUpMessage.content,
              })
            );
          }
        }
      }

      console.log(`Bot installation recorded for server: ${guildId}`);
      return res.json({ success: true });
    } else {
      console.log(`Bot installed on server ${guildId} but no matching record found in database`);
      return res.status(404).json({
        success: false,
        error: 'No Discord server record found with this ID',
        message: 'The bot was installed on a server that is not linked to any BioDAO user',
      });
    }
  } catch (error) {
    console.error('Error handling bot installation:', error);
    return res.status(500).json({ success: false, error: 'Server error' });
  }
});

/**
 * Sends a CoreAgent system message to the user with guidance based on their current level
 * and handles automatic level-up when requirements are met
 */
async function sendCoreAgentGuidance(
  ws: any,
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
    const sessionId = await getOrCreateChatSession(userId);

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
      const botStatus = await checkBotInstallationStatus(userId);
      botInstallationUrl = botStatus.installationLink;
    }

    // Generate guidance message based on level and progress
    const progressData = await calculateUserProgress(project);
    let guidanceMessage = '';

    // ... existing code ...

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

    // ... existing code ...
  } catch (error) {
    console.error('Error sending CoreAgent guidance:', error);
  }
}

/**
 * Checks if a user meets requirements for level-up and performs the level-up if needed
 * @returns Boolean indicating if a level-up was performed
 */
async function checkAndPerformLevelUp(project: any, ws: any): Promise<boolean> {
  try {
    // Skip if user is already at max level
    if (project.level >= 4) return false;

    let shouldLevelUp = false;
    let newLevel = project.level;
    let levelUpMessage = '';
    let nextRequirementsMessage = '';

    // Level 1 to 2: Both NFTs minted
    if (project.level === 1) {
      const hasIdeaNFT = project.NFTs.some((nft: { type: string }) => nft.type === 'idea');
      const hasVisionNFT = project.NFTs.some((nft: { type: string }) => nft.type === 'vision');

      if (hasIdeaNFT && hasVisionNFT) {
        shouldLevelUp = true;
        newLevel = 2;
        levelUpMessage = `## Level 2 Unlocked! 🚀

**Congratulations!** You've successfully minted both your **Idea NFT** and **Vision NFT**. You have now advanced to **Level 2!**

### New Level Requirements:
- Create a **Discord server** for your research community
- Add our **verification bot** to your server
- Invite at least **4 members** to your community

Your BioDAO journey is progressing well! Now it's time to build your scientific community by setting up Discord and inviting initial members.`;

        // Next level requirements message
        nextRequirementsMessage = `## Next Steps for Level 2 🧪

To advance to Level 3, complete these requirements:

1. **Create a Discord server** for your research community
2. **Share your Discord invite link** with me so I can register it
3. **Install our verification bot** to track community metrics
4. **Invite at least 4 members** to join your server

I can help you through each of these steps. Would you like guidance on setting up your Discord server?`;
      }
    }
    // Level 2 to 3: Discord with 4+ members
    else if (project.level === 2 && project.Discord) {
      if (project.Discord.botAdded && project.Discord.memberCount >= 4) {
        shouldLevelUp = true;
        newLevel = 3;
        levelUpMessage = `## Level 3 Unlocked! 🚀

**Congratulations!** Your BioDAO community now has **${project.Discord.memberCount} members**, which means you've advanced to **Level 3!**`;

        // Next level requirements message
        nextRequirementsMessage = `## Level 3 Requirements:

To advance to Level 4, you'll need to:

1. **Grow your community to 10+ members** (currently: ${project.Discord.memberCount})
2. **Share 25+ scientific papers** in your Discord (currently: ${project.Discord.papersShared || 0})
3. **Reach 100+ quality messages** (currently: ${project.Discord.messagesCount || 0})

I'll help you track these metrics and provide strategies to achieve them.`;
      }
    }
    // Level 3 to 4: Discord metrics with quality checks
    else if (project.level === 3 && project.Discord) {
      // Basic metrics check
      const hasEnoughMembers = project.Discord.memberCount >= 10;
      const hasEnoughPapers = project.Discord.papersShared >= 25;
      const hasEnoughMessages = project.Discord.messagesCount >= 100;

      // Combined check for level advancement - removed quality score requirement
      if (hasEnoughMembers && hasEnoughPapers && hasEnoughMessages) {
        shouldLevelUp = true;
        newLevel = 4;
        levelUpMessage = `## Level 4 Unlocked! 🎉

**Congratulations!** Your BioDAO community has reached critical mass with:
- **${project.Discord.memberCount} members**
- **${project.Discord.papersShared} scientific papers shared**
- **${project.Discord.messagesCount} messages** in your server

You've advanced to **Level 4** and now have access to the BioDAO sandbox!`;

        // Final level message
        nextRequirementsMessage = `## What's Next:

Now that you've reached Level 4:

1. **The Bio team will contact you** via email shortly to schedule a call
2. **The call will discuss** your BioDAO's next steps and strategy
3. **You now have access** to all platform features and resources

Is there anything specific you'd like to prepare for the team call?`;
      }
    }

    // Perform level-up if needed
    if (shouldLevelUp) {
      // Update user level
      await prisma.project.update({
        where: { id: project.id },
        data: { level: newLevel },
      });

      // Get session for chat history
      const sessionId = await getOrCreateChatSession(project.id);

      // Save level-up message to chat
      await saveChatMessage(sessionId, levelUpMessage, true, 'LEVEL_UP', true);

      // Send level-up message to WebSocket with level-specific requirements
      ws.send(
        JSON.stringify({
          type: 'level_up',
          level: newLevel,
          message: levelUpMessage,
          nextLevelRequirements:
            newLevel === 2
              ? [
                  'Create a Discord server for your research community',
                  'Add verification bot to your Discord server',
                  'Invite at least 4 members to your server',
                ]
              : newLevel === 3
                ? [
                    'Grow your community to 10+ Discord members',
                    'Share at least 25 scientific papers in your server',
                    'Reach 100+ quality messages in your community',
                  ]
                : newLevel === 4
                  ? [
                      'All requirements completed - congratulations!',
                      'The Bio team will contact you to schedule a call',
                      'You now have access to the full BioDAO sandbox',
                    ]
                  : [],
        })
      );

      /*
            // Send additional detailed requirements message as guidance from CoreAgent
            const nextLevel = newLevel + 1;
            const agentRequirementsMessage = newLevel < 4 ? generateNextLevelRequirementsMessage(newLevel, project) : '';

            // Wait a moment before sending the next requirements message
            setTimeout(async () => {
                // Save the requirements message to chat
                await saveChatMessage(
                    sessionId,
                    nextRequirementsMessage,
                    true,
                    'GUIDANCE',
                    true
                );

                // Send the next requirements message to WebSocket
                ws.send(JSON.stringify({
                    type: 'message',
                    content: nextRequirementsMessage,
                    action: 'GUIDANCE'
                }));

                // If there's an additional agent message with detailed requirements, send that as well
                if (agentRequirementsMessage) {
                    setTimeout(async () => {
                        // Save the detailed agent guidance to chat
                        await saveChatMessage(
                            sessionId,
                            agentRequirementsMessage,
                            true,
                            'AGENT_GUIDANCE',
                            true
                        );

                        // Send the detailed guidance as a separate agent message
                        ws.send(JSON.stringify({
                            type: 'message',
                            content: agentRequirementsMessage,
                            action: 'AGENT_GUIDANCE',
                            isFromAgent: true
                        }));
                    }, 1500);
                }
            }, 2000);
            */

      // Send level-up email if we have the user's email
      if (project.email) {
        await sendLevelUpEmail(project.email, newLevel);
      }

      // If reaching sandbox level, notify team
      if (newLevel === 4) {
        await sendSandboxEmail(project);
      }

      console.log(`Project ${project.id} automatically leveled up to ${newLevel}`);
      return true;
    }

    return false;
  } catch (error) {
    console.error('Error in level-up check:', error);
    return false;
  }
}

/**
 * Handle a request to check Discord stats
 * This displays current stats and progress towards level goals
 */
async function handleCheckDiscordStats(ws: any, userId: string): Promise<void> {
  try {
    console.log(`User ${userId} requested Discord stats check`);

    // Check if user is authenticated
    if (!userId) {
      ws.send(
        JSON.stringify({
          type: 'error',
          message: 'You must be logged in to check Discord stats',
        })
      );
      return;
    }

    // Get session for logging chat
    const sessionId = await getOrCreateChatSession(userId);

    // Get the user data to check for Discord setup
    const project = await prisma.project.findUnique({
      where: { id: userId },
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

    // Check if user has a Discord server registered
    if (!project.Discord) {
      const errorMsg =
        'You have not set up a Discord server yet. Please share a Discord invite link to register your server.';

      // Log the action in chat history
      await saveChatMessage(sessionId, errorMsg, true, 'check_discord_stats', false);

      ws.send(
        JSON.stringify({
          type: 'error',
          message: errorMsg,
        })
      );
      return;
    }

    // Get bot installation status and URL if needed
    const botStatus = await checkBotInstallationStatus(userId);

    // Check if we should auto level-up the user (if they meet all requirements)
    if (project.level === 3 && project.Discord) {
      const hasEnoughMembers = project.Discord.memberCount >= 10;
      const hasEnoughPapers = project.Discord.papersShared >= 25;
      const hasEnoughMessages = project.Discord.messagesCount >= 100;

      // If they meet all requirements, perform level up before showing stats
      if (hasEnoughMembers && hasEnoughPapers && hasEnoughMessages) {
        console.log(`User ${userId} meets all Level 4 requirements, attempting auto level-up`);
        const wasLeveledUp = await checkAndPerformLevelUp(project, ws);

        if (wasLeveledUp) {
          // Level up was performed, no need to continue with stats display
          return;
        }
      }
    }

    // Get the latest stats from the database
    const latestStats = project.Discord;
    const currentLevel = project.level;

    // Calculate progress percentages based on level requirements
    const memberProgress =
      currentLevel === 2
        ? Math.min(100, Math.round((latestStats.memberCount / 4) * 100))
        : Math.min(100, Math.round((latestStats.memberCount / 10) * 100));

    const messageProgress = Math.min(100, Math.round((latestStats.messagesCount / 100) * 100));
    const paperProgress = Math.min(100, Math.round((latestStats.papersShared / 25) * 100));
    const qualityProgress = Math.min(100, Math.round((latestStats.qualityScore / 70) * 100));

    // Format a user-friendly stats message
    let statsMessage = `# Discord Community Stats Report\n\n`;
    statsMessage += `## Current Stats for Your Discord Server\n\n`;
    statsMessage += `• Server: ${latestStats.serverName || 'Unknown'}\n`;
    statsMessage += `• Members: ${latestStats.memberCount}\n`;
    statsMessage += `• Messages: ${latestStats.messagesCount}\n`;
    statsMessage += `• Papers shared: ${latestStats.papersShared}\n`;

    // Add bot status
    statsMessage += `• Bot installed: ${latestStats.botAdded ? 'Yes' : 'No'}\n`;

    // Add progress information
    statsMessage += `\n## Progress Towards Level ${currentLevel + 1}\n\n`;

    if (currentLevel === 2) {
      statsMessage += `• Members: ${latestStats.memberCount}/4 (${memberProgress}%)\n\n`;

      if (latestStats.memberCount < 4) {
        statsMessage += `To reach Level 3, invite more members to your Discord server.\n\n`;
      } else {
        statsMessage += `You've met the requirements for Level 3! The CoreAgent will assist you in leveling up.\n\n`;
      }
    } else if (currentLevel === 3) {
      statsMessage += `• Members: ${latestStats.memberCount}/10 (${memberProgress}%)\n`;
      statsMessage += `• Messages: ${latestStats.messagesCount}/100 (${messageProgress}%)\n`;
      statsMessage += `• Papers shared: ${latestStats.papersShared}/25 (${paperProgress}%)\n\n`;

      let missingRequirements = [];
      if (latestStats.memberCount < 10) missingRequirements.push('more members');
      if (latestStats.messagesCount < 100) missingRequirements.push('more messages');
      if (latestStats.papersShared < 25) missingRequirements.push('more shared papers');

      if (missingRequirements.length > 0) {
        statsMessage += `To reach Level 4, you need: ${missingRequirements.join(', ')}.\n\n`;
      } else {
        statsMessage += `You've met all requirements for Level 4! The CoreAgent will assist you in leveling up.\n\n`;
      }

      // Add specific paper sharing guidance
      if (latestStats.papersShared < 25) {
        statsMessage += `## How to Share Papers Correctly\n\n`;
        statsMessage += `To ensure papers are properly counted, share papers in one of these formats:\n\n`;
        statsMessage += `• Upload PDF files directly to Discord\n`;
        statsMessage += `• Share links with DOIs (e.g., doi:10.1038/s41586-021-03819-2)\n`;
        statsMessage += `• Post links from scientific repositories (arxiv.org, nature.com, etc.)\n`;
        statsMessage += `• Format citations with title in quotes, authors, and publication year\n\n`;
        statsMessage += `Example: "Quantum Computing in Biological Systems" by Smith et al. (2023) in Nature Bioscience.\n\n`;
      }
    }

    // Log the action in chat history
    await saveChatMessage(sessionId, { content: statsMessage }, true, 'check_discord_stats', true);

    // Send the response
    ws.send(
      JSON.stringify({
        type: 'message',
        content: statsMessage,
        discord: {
          serverId: latestStats.serverId,
          serverName: latestStats.serverName,
          memberCount: latestStats.memberCount,
          messagesCount: latestStats.messagesCount,
          papersShared: latestStats.papersShared,
          botAdded: latestStats.botAdded,
          verified: latestStats.verified,
          // Remove bot installation URL - it should be embedded in the message if needed
        },
      })
    );
  } catch (error) {
    console.error('Error handling Discord stats check:', error);
    ws.send(
      JSON.stringify({
        type: 'error',
        message: 'Failed to retrieve Discord stats',
      })
    );
  }
}

/**
 * Detects if a message is too simple to count as a meaningful contribution
 * This filters out basic greetings, single-word replies, and other low-value messages
 *
 * @param content The message content to check
 * @returns Boolean indicating if this is a low-value message that should be ignored
 */
function isLowValueMessage(content: string): boolean {
  // Normalize the content
  const normalizedContent = content.toLowerCase().trim();

  // Skip messages that are too short (less than 5 characters)
  if (normalizedContent.length < 5) {
    return true;
  }

  // Common greetings and basic responses that don't contribute meaningful content
  const lowValuePatterns = [
    /^(hi|hey|hello|sup|yo|gm|good morning|good evening|good night|gn|bye|cya|see ya|lol|ok|okay|k|sure|yes|no|maybe|thanks|thx|ty|np|yw|welcome)$/i,
    /^(what'?s up|how are you|how's it going)$/i,
    /^(nice|cool|great|awesome|amazing|good|bad|sad|happy|lmao|lmfao|rofl|oof|rip|f)$/i,
    /^((?:ha){1,5})$/i, // matches: ha, haha, hahaha, etc.
    /^[👋👍👎❤️😂🙏]+$/u, // just emojis
  ];

  // Check against common low-value patterns
  for (const pattern of lowValuePatterns) {
    if (pattern.test(normalizedContent)) {
      return true;
    }
  }

  // Count words - messages with only 1-2 words are usually low value
  const wordCount = normalizedContent.split(/\s+/).filter((word) => word.length > 0).length;
  if (wordCount <= 2) {
    return true;
  }

  // Not a low-value message
  return false;
}

// Add API endpoint to fetch NFT information
app.get('/api/nfts/:userId', async (req: any, res: any) => {
  try {
    const { userId } = req.params;

    if (!userId) {
      return res.status(400).json({ success: false, message: 'User ID is required' });
    }

    // Fetch user's NFTs
    const nfts = await prisma.nFT.findMany({
      where: {
        projectId: userId,
      },
      orderBy: {
        mintedAt: 'desc',
      },
    });

    // Return NFT data
    return res.json({
      success: true,
      nfts: nfts.map((nft) => ({
        id: nft.id,
        type: nft.type,
        mintedAt: nft.mintedAt,
        imageUrl: 'imageUrl' in nft ? nft.imageUrl : null,
        transactionHash: 'transactionHash' in nft ? nft.transactionHash : null,
      })),
    });
  } catch (error) {
    console.error('Error fetching NFTs:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch NFTs',
      error: error instanceof Error ? error.message : String(error),
    });
  }
});

// Helper for extracting Discord ID and invite from message text
function extractDiscordInfo(message: string): {
  serverId: string | null;
  inviteLink: string | null;
  inviteCode: string | null;
} {
  // Default return values
  let serverId: string | null = null;
  let inviteLink: string | null = null;
  let inviteCode: string | null = null;

  // Array of regex patterns to match different Discord invite link formats
  const patterns = [
    // discord.gg/xyz format
    /(?:https?:\/\/)?discord\.gg\/([a-zA-Z0-9-]+)/i,
    // discord.com/invite/xyz format
    /(?:https?:\/\/)?discord\.com\/invite\/([a-zA-Z0-9-]+)/i,
    // discordapp.com/invite/xyz format (legacy)
    /(?:https?:\/\/)?discordapp\.com\/invite\/([a-zA-Z0-9-]+)/i,
    // vanity URL pattern
    /(?:https?:\/\/)?discord\.gg\/([a-zA-Z0-9-]+)/i,
  ];

  // Try each pattern until we find a match
  for (const pattern of patterns) {
    const match = message.match(pattern);
    if (match) {
      inviteCode = match[1];
      inviteLink = match[0];

      // Ensure the invite link has a proper URL format
      if (!inviteLink.startsWith('http')) {
        inviteLink = `https://${inviteLink}`;
      }

      console.log(`Extracted Discord invite: ${inviteLink}, code: ${inviteCode}`);
      break;
    }
  }

  return { serverId, inviteLink, inviteCode };
}

// Simplified action handling function
async function handlePotentialActions(
  ws: any,
  userId: string,
  user: any,
  userMessage: string,
  aiResponse: string
): Promise<Array<{ action: string; success: boolean }>> {
  const actions: Array<{ action: string; success: boolean }> = [];

  try {
    // Check for Discord invite links if user is at level 2 or higher
    if (user.level >= 2) {
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

    // More potential actions can be added here in the future

    return actions;
  } catch (error) {
    console.error('Error processing potential actions:', error);
    return actions;
  }
}

/**
 * Handles the initial connection experience when a user first authenticates
 * This includes welcome message, auto-minting NFTs, and leveling up
 */
async function handleInitialConnection(ws: any, project: any): Promise<void> {
  try {
    console.log(`Processing initial connection for project ${project.id}`);

    // Check if this is a first-time user by looking for existing sessions
    const existingSessions = await prisma.chatSession.count({
      where: {
        projectId: project.id,
      },
    });

    const isFirstTimeUser = existingSessions === 0;
    console.log(
      `User ${project.id} is ${isFirstTimeUser ? 'a first-time user' : 'a returning user'} (${existingSessions} existing sessions)`
    );

    // Get or create the chat session
    const sessionId = await getOrCreateChatSession(project.id);

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

      await saveChatMessage(sessionId, welcomeMessage, true, 'WELCOME', true);

      // Include Discord info in the welcome message if available
      let discordInfo = null;
      if (project.level >= 2) {
        // Get the Discord info if available
        const discordRecord = await prisma.discord.findUnique({
          where: { projectId: project.id },
        });

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
      const existingNFTs = await prisma.nFT.findMany({
        where: { projectId: project.id },
      });

      const hasIdeaNFT = existingNFTs.some((nft) => nft.type === 'idea');
      const hasVisionNFT = existingNFTs.some((nft) => nft.type === 'vision');

      // Auto-mint both NFTs if not already minted
      if (!hasIdeaNFT) {
        // Wait a moment for better UX (message appears, then minting starts)
        await new Promise((resolve) => setTimeout(resolve, 1500));

        // Prepare minting message
        const mintingMessage = "I'll mint your Idea NFT now based on your project description.";

        await saveChatMessage(sessionId, mintingMessage, true, 'MINT_IDEA_INTENT', true);

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

        await saveChatMessage(sessionId, mintingMessage, true, 'MINT_VISION_INTENT', true);

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
      // For returning users, just send the session id and Discord info without a welcome message
      let discordInfo = null;
      if (project.level >= 2) {
        const discordRecord = await prisma.discord.findUnique({
          where: { projectId: project.id },
        });

        if (discordRecord) {
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

      // Only send Discord info for returning users, no welcome message
      if (discordInfo) {
        ws.send(
          JSON.stringify({
            type: 'discord_update',
            discord: discordInfo,
          })
        );
      }
    }

    // For all users, check level-up conditions
    const projectWithNFTs = await prisma.project.findUnique({
      where: { id: project.id },
      include: {
        NFTs: true,
        Discord: true,
      },
    });

    if (projectWithNFTs) {
      await checkAndPerformLevelUp(projectWithNFTs, ws);
    }

    // Send guidance message based on current state for all users
    await sendCoreAgentGuidance(ws, project.id, 'initial_connection');
  } catch (error) {
    console.error('Error in initial connection handling:', error);

    // Send a fallback message if something went wrong
    ws.send(
      JSON.stringify({
        type: 'message',
        content:
          "Welcome to BioDAO! I'm experiencing some technical difficulties at the moment. Please type a message to continue.",
      })
    );
  }
}

// HTTP route for manual Discord server setup
app.post('/api/discord/setup', async (req: any, res: any) => {
  try {
    const { userId, discordInvite } = req.body;

    if (!userId || !discordInvite) {
      return res.status(400).json({
        success: false,
        message: 'Missing userId or discordInvite',
      });
    }

    // Create a mock WebSocket object that just stores the sent data
    const mockWs: {
      sentData: string | null;
      send: (data: string) => void;
      error: string | null;
    } = {
      sentData: null,
      send: function (data: string) {
        this.sentData = data;
        // Parse the data to check if it's an error
        try {
          const parsedData = JSON.parse(data);
          if (parsedData.type === 'error') {
            this.error = parsedData.content || parsedData.message;
          }
        } catch (e) {}
      },
      error: null,
    };

    // Use the existing handleDiscordSetup function
    const success = await handleDiscordSetup(mockWs, userId, { content: discordInvite });

    if (success) {
      return res.status(200).json({
        success: true,
        message: 'Discord server verified and registered successfully',
        data: mockWs.sentData ? JSON.parse(mockWs.sentData) : null,
      });
    } else {
      return res.status(400).json({
        success: false,
        message:
          mockWs.error ||
          'Failed to register Discord server. Please ensure your invite link is valid.',
      });
    }
  } catch (error) {
    console.error('Error in manual Discord setup:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
});

// Add PATCH endpoint for updating a project by ID
app.patch('/api/projects/:id', async (req: any, res: any) => {
  const { id } = req.params;
  const {
    fullName,
    email,
    projectName,
    projectDescription,
    projectVision,
    scientificReferences,
    credentialLinks,
    teamMembers,
    motivation,
    progress,
  } = req.body;

  try {
    // Check if project exists
    const existingProject = await prisma.project.findUnique({
      where: { id },
    });

    if (!existingProject) {
      return res.status(404).json({ error: 'Project not found' });
    }

    // Update the project
    const updatedProject = await prisma.project.update({
      where: { id },
      data: {
        fullName,
        email,
        projectName,
        projectDescription,
        projectVision,
        scientificReferences,
        credentialLinks,
        teamMembers,
        motivation,
        progress,
      },
    });

    res.json(updatedProject);
  } catch (error) {
    console.error('Error updating project:', error);
    res.status(500).json({ error: 'Failed to update project' });
  }
});

/**
 * Generates a detailed message with next level requirements and helpful tips
 */
function generateNextLevelRequirementsMessage(currentLevel: number, project: any): string {
  switch (currentLevel) {
    case 1:
      return `I'm excited to help you set up your research community! Let me guide you through the process of creating your Discord server:

1. **Creating a Discord Server**:
   - Go to Discord and click the + button on the left sidebar
   - Choose "Create a Server" and follow the setup wizard
   - Focus on creating channels for research discussions, paper sharing, and community updates

2. **Adding Our Bot**:
   - Once your server is set up, you'll need to add our CoreAgent bot
   - Just share your Discord invite link with me, and I'll help you complete this step

3. **Growing Your Community**:
   - Invite at least 4 members to reach Level 3
   - Consider reaching out to colleagues, collaborators, and others interested in your research area

Would you like me to help you with any specific part of this process?`;

    case 2:
      const currentMembers = project.Discord?.memberCount || 0;
      const membersNeeded = 10 - currentMembers;

      return `Great progress on reaching Level 3! Here's how you can meet the requirements for Level 4:

1. **Growing to 10+ Members** (you need ${membersNeeded > 0 ? membersNeeded + ' more' : 'no more'} members):
   - Share your Discord invite link with researchers in your field
   - Consider hosting virtual events or discussions to attract new members
   - Connect with related communities and invite interested participants

2. **Sharing 25+ Scientific Papers**:
   - Our bot automatically detects papers shared in your server
   - Papers can be shared as PDFs or as links to repositories like PubMed, bioRxiv, etc.
   - Try to share papers relevant to your research focus to keep discussions meaningful

3. **Reaching 100+ Quality Messages**:
   - Encourage substantive discussions about research topics
   - Ask open-ended questions to stimulate conversation
   - The bot tracks message count and filters out low-value messages

Would you like suggestions for growing your community or tracking your progress?`;

    case 3:
      return `Congratulations on reaching Level 4! This is a major milestone for your BioDAO.

The Bio team will be reaching out to you via email soon to discuss:
- Your research goals and vision
- Potential funding opportunities
- Advanced resources and support available to you
- Strategic guidance for your BioDAO's growth

To prepare for this call, consider:
1. Refining your research roadmap
2. Identifying specific challenges you're facing
3. Preparing questions about how Bio can support your community

In the meantime, you have full access to all platform features. Is there any specific aspect of your BioDAO you'd like to focus on now?`;

    default:
      return '';
  }
}

/**
 * GET /api/discord/:projectId - Get Discord stats with detailed progress information
 *
 * This endpoint retrieves Discord stats and calculates progress metrics for the given project
 * It's designed to support the CoreAgent interface on the client side
 */
app.get('/api/discord/:projectId', async (req: any, res: any) => {
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
          required: 10,
          percent: Math.min(100, Math.round((discordStats.memberCount / 10) * 100)),
        },
        messages: {
          current: discordStats.messagesCount,
          required: 100,
          percent: Math.min(100, Math.round((discordStats.messagesCount / 100) * 100)),
        },
        papers: {
          current: discordStats.papersShared,
          required: 25,
          percent: Math.min(100, Math.round((discordStats.papersShared / 25) * 100)),
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

// ... existing code ...

// Add API endpoint for Discord bot to check level requirements
app.post('/discord/check-level-requirements', async (req: any, res: any) => {
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
      discord.memberCount >= 10 &&
      discord.papersShared >= 25 &&
      discord.messagesCount >= 100
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

      // If user is connected via WebSocket, send them the level-up notification
      const userId = project.id;
      if (userId && activeConnections[userId]) {
        const ws = activeConnections[userId];

        // Call our existing level-up handler with the updated project and WebSocket
        // This will send all appropriate notifications and emails
        const refreshedProject = await prisma.project.findUnique({
          where: { id: project.id },
          include: {
            Discord: true,
            NFTs: true,
          },
        });

        if (refreshedProject) {
          await checkDiscordLevelProgress(refreshedProject);
        }
      } else {
        // Even if user isn't connected, send level-up email
        if (project.email) {
          await sendLevelUpEmail(project.email, newLevel);

          // If they reached level 4, also send sandbox email
          if (newLevel === 4) {
            await sendSandboxEmail(project);
          }
        }
      }

      return res.json({
        success: true,
        levelUp: true,
        previousLevel,
        newLevel,
        userId: project.id,
      });
    }

    // No level-up occurred
    return res.json({
      success: true,
      levelUp: false,
      currentLevel: previousLevel,
      project: {
        id: project.id,
        level: project.level,
      },
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

// ... existing code ...
