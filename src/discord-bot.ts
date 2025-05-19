import {
  Client,
  GatewayIntentBits,
  Events,
  Guild,
  Message,
  TextChannel,
  GuildMember,
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  ChannelType,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  Interaction,
  Attachment,
} from 'discord.js';
import axios from 'axios';
import dotenv from 'dotenv';
import {
  detectPaper,
  evaluatePaperQuality,
  extractPaperMetadata,
  analyzeScientificPdf,
} from './paper-detection';
import prisma from './services/db.service';
import { WebSocketServer, WebSocket as WS } from 'ws';
import { checkAndPerformLevelUp, checkAndUpdateUserLevel, handleBotInstalled } from './websocket/ws.service';
import { sendLevelUpEmail, sendSandboxEmail } from './services/email.service';
import { activeConnections } from './websocket/ws.service';
// Fix for missing types for pdf-parse
// @ts-ignore
import pdfParse from 'pdf-parse';
import OpenAI from 'openai';

dotenv.config();

const PORTAL_API_URL = process.env.PORTAL_API_URL || 'http://localhost:3001';
const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
const API_KEY = process.env.API_KEY || process.env.PORTAL_API_KEY;
const PORTAL_API_KEY = process.env.PORTAL_API_KEY;

/**
 * BioDAO Discord Bot for Community Metrics
 *
 * This bot tracks community engagement metrics for BioDAO communities:
 * - Member counts
 * - Message activity
 * - Papers shared
 * - Quality score based on engagement patterns
 *
 * The data is used by the CoreAgent to automatically progress users through levels
 * as they meet community growth milestones.
 */

// Guild stats tracking
interface GuildStats {
  messageCount: number;
  papersShared: number;
  qualityScore: number;
  lastMessageTimestamp: Date;
  activeUsers: Set<string>; // Track unique active users
}

const guildStats: Map<string, GuildStats> = new Map();

// Paper detection keywords and patterns
const PAPER_KEYWORDS = [
  'research paper',
  'scientific paper',
  'study',
  'findings',
  'journal',
  'published',
  'publication',
  'research',
  'abstract',
  'methodology',
  'results',
  'conclusion',
  'doi',
  'peer-reviewed',
];

const PAPER_DOMAINS = [
  'arxiv.org',
  'nature.com',
  'science.org',
  'cell.com',
  'pubmed',
  'ncbi.nlm.nih.gov',
  'sciencedirect.com',
  'biorxiv.org',
  'medrxiv.org',
  'researchgate.net',
  'jstor.org',
  'scholar.google.com',
  'pnas.org',
  'frontiersin.org',
  'plos.org',
  'sciencemag.org',
  'jbc.org',
];

// Message quality and spam detection configuration
const MESSAGE_CONFIG = {
  SPAM_THRESHOLD: 30, // Messages below this score are considered spam (scale 0-100)
  MIN_QUALITY_LENGTH: 8, // Minimum characters for a message to be potentially non-spam
  MAX_FREQUENCY_PER_USER: 5, // Max messages per minute from one user before applying penalty
  SIMILAR_MESSAGE_THRESHOLD: 0.8, // Similarity threshold to detect repeated messages (0-1)
  COOLDOWN_PERIOD_MS: 60000, // 1 minute cooldown for frequency checking
  QUALITY_CHECK_INTERVAL_MS: 10 * 60 * 1000, // Perform quality check every 10 minutes
  HISTORY_SIZE: 1000, // Maximum history size for message frequency tracking
};

// Track message history for spam detection
interface MessageHistoryItem {
  userId: string;
  content: string;
  timestamp: Date;
  qualityScore: number;
}

// Map of guild IDs to their message history arrays
const guildMessageHistory: Map<string, MessageHistoryItem[]> = new Map();

// Track user message frequency
interface UserMessageFrequency {
  lastMessages: Date[];
  penaltyFactor: number; // Reduces message quality when spamming detected
}

// Map of userIds to their message frequency data
const userMessageFrequency: Map<string, UserMessageFrequency> = new Map();

// Add a command prefix for the bot to respond to
const COMMAND_PREFIX = '!biodao';

// Valid commands
const COMMANDS = {
  HELP: 'help',
  STATS: 'stats',
  QUALITY: 'quality',
  PAPERS: 'papers',
  TIPS: 'tips',
  PROGRESS: 'progress',
};

// Help messages for commands
const HELP_MESSAGES = {
  [COMMANDS.HELP]: 'Shows this help message',
  [COMMANDS.STATS]: 'Shows current community stats',
  [COMMANDS.QUALITY]: 'Explains how message quality is measured',
  [COMMANDS.PAPERS]: 'Shows tips for sharing research papers',
  [COMMANDS.TIPS]: 'Provides tips for improving community engagement',
  [COMMANDS.PROGRESS]: 'Shows current progress toward next level',
};

// Add at the top, after other maps:
const processedMessageIdsByGuild: Record<string, Set<string>> = {};

// --- Temporary Cache for PDF Q&A ---
const pdfTextCache = new Map<string, { text: string; filename: string }>();
// -----------------------------------

// Add this type definition at the top of the file, near other interface definitions
interface PendingResponse {
  guildId: string;
  responseType: string;
  servers?: any[]; // For multiple server selection
}
// Map to track which users we're waiting for responses from
const pendingResponses = new Map<string, PendingResponse>();

// Initialize Discord client with necessary intents
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages,
  ],
});

/**
 * Determine if a message is too simple to count as a meaningful contribution
 */
function isLowValueMessage(content: string): boolean {
  // Normalize the content
  const normalizedContent = content.toLowerCase().trim();
  
  // Skip messages that are too short
  if (normalizedContent.length < 5) {
    return true;
  }
  
  // Common greetings and basic responses
  const lowValuePatterns = [
    /^(hi|hey|hello|sup|yo|gm|good morning|good evening|good night|gn|bye)$/i,
    /^(what'?s up|how are you|how's it going)$/i,
    /^(nice|cool|great|awesome|amazing|good|bad|sad|happy)$/i,
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

// --- Global Error Handlers ---
process.on('uncaughtException', (error) => {
  console.error('UNCAUGHT EXCEPTION:', error);
  // Optionally exit if needed: process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('UNHANDLED REJECTION:', reason);
  // Optionally log the promise that was rejected: console.error('Promise:', promise);
});
// ---------------------------

// Handle bot ready event
client.once(Events.ClientReady, async () => {
  console.log(`BioDAO Bot logged in as ${client.user?.tag}`);
  console.log(`Serving ${client.guilds.cache.size} guilds`);

  // Verify the bot's permissions for critical features
  verifyBotPermissions();

  // Register slash commands
  const commands = [
    // Existing /summarize command
    {
      name: 'summarize',
      description: 'Summarize an uploaded scientific PDF',
      options: [
        {
          name: 'file',
          description: 'The PDF file to summarize',
          type: 11, // ATTACHMENT type
          required: true,
        },
      ],
    },
    // New /upload command
    {
      name: 'upload',
      description: 'Upload a PDF to ask questions about it.',
      options: [
        {
          name: 'file',
          description: 'The PDF file to upload and process.',
          type: 11, // ATTACHMENT type
          required: true,
        },
      ],
    },
    // New /ask command
    {
      name: 'ask',
      description: 'Ask a question about the last PDF you uploaded.',
      options: [
        {
          name: 'question',
          description: 'The question you want to ask about the PDF.',
          type: 3, // STRING type
          required: true,
        },
      ],
    },
  ];

  try {
    // Use global registration by default
    console.log('[Discord Bot] Registering global slash commands...');
    await client.application?.commands.set(commands);
    console.log('[Discord Bot] Global slash commands registered successfully.');
  } catch (error) {
    console.error('Error registering global slash commands:', error);
  }

  // Initialize tracking for all current guilds
  client.guilds.cache.forEach((guild) => {
    initializeGuildStats(guild);
  });

  // Set up periodic stats updates
  setInterval(updateAllGuildStats, 30 * 60 * 1000); // Update every 30 minutes
});

/**
 * Verify that the bot has all the permissions it needs
 */
function verifyBotPermissions() {
  console.log('[BOT PERMISSIONS] Checking bot permissions in all guilds...');
  
  client.guilds.cache.forEach(guild => {
    const botMember = guild.members.cache.get(client.user?.id || '');
    if (!botMember) {
      console.error(`[BOT PERMISSIONS] Could not find bot member in guild: ${guild.name} (${guild.id})`);
      return;
    }
    
    // Check for basic required permissions
    const missingPermissions = [];
    const requiredPermissions = [
      'ViewChannel',
      'SendMessages',
      'EmbedLinks',
      'AttachFiles',
      'ReadMessageHistory',
      'AddReactions',
    ];
    
    // Add "Create Instant Invite" if we want to generate invite links
    requiredPermissions.push('CreateInstantInvite');
    
    for (const permission of requiredPermissions) {
      if (!botMember.permissions.has(permission as any)) {
        missingPermissions.push(permission);
      }
    }
    
    if (missingPermissions.length > 0) {
      console.error(`[BOT PERMISSIONS] Missing permissions in guild ${guild.name} (${guild.id}): ${missingPermissions.join(', ')}`);
    } else {
      console.log(`[BOT PERMISSIONS] All required permissions granted in guild ${guild.name} (${guild.id})`);
    }
    
    // Check if bot can see member events (access private client._intents property)
    const hasGuildMembersIntent = Boolean(
      (client as any)._intents && 
      ((client as any)._intents.has(GatewayIntentBits.GuildMembers) || 
       (client as any)._intents.bitfield & GatewayIntentBits.GuildMembers)
    );
    
    if (!hasGuildMembersIntent) {
      console.error(`[BOT PERMISSIONS] GuildMembers intent is not enabled! The bot won't receive member join/leave events.`);
    } else {
      console.log(`[BOT PERMISSIONS] GuildMembers intent is enabled.`);
    }
  });
}

/**
 * Initialize stats tracking for a guild
 */
async function initializeGuildStats(guild: Guild): Promise<void> {
  console.log(`[DEBUG] initializeGuildStats START for guild: ${guild.name} (${guild.id})`);
  // Fetch from DB
  const discordRecord = await prisma.discord.findFirst({ where: { serverId: guild.id } });
  console.log(`[DEBUG] discordRecord lookup result: ${discordRecord ? 'FOUND' : 'NOT FOUND'}, ID: ${discordRecord?.id || 'N/A'}`);
  
  const dbMessages = discordRecord?.messagesCount || 0;
  const dbPapers = discordRecord?.papersShared || 0;
  const dbQuality = discordRecord?.qualityScore || 50;
  const dbMemberCount = discordRecord?.memberCount || 0;
  
  console.log(`[DEBUG] DB values: messages=${dbMessages}, papers=${dbPapers}, quality=${dbQuality}, members=${dbMemberCount}`);
  
  // Check if member count needs to be updated
  const currentMemberCount = guild.memberCount;
  console.log(`[DEBUG] Current member count from Discord API: ${currentMemberCount}`);
  
  if (discordRecord && currentMemberCount !== dbMemberCount) {
    console.log(`[MEMBER_SYNC] Member count mismatch for ${guild.name}: DB=${dbMemberCount}, Actual=${currentMemberCount}. Updating...`);
    
    try {
      // Update member count in database
      console.log(`[DEBUG] Attempting to update memberCount in database. Record ID: ${discordRecord.id}`);
      const updateResult = await prisma.discord.update({
        where: { id: discordRecord.id },
        data: { memberCount: currentMemberCount }
      });
      
      console.log(`[MEMBER_SYNC] Updated member count in database for ${guild.name} to ${currentMemberCount}`);
      console.log(`[DEBUG] Update result: ${updateResult ? 'SUCCESS' : 'FAILURE'}, new count: ${updateResult?.memberCount}`);
    } catch (dbError) {
      console.error(`[MEMBER_SYNC] Error updating member count in database:`, dbError);
    }
  } else {
    console.log(`[DEBUG] Member count update skipped: ${discordRecord ? 'Record exists' : 'No record'}, counts match: ${currentMemberCount === dbMemberCount}`);
  }

  // Initialize guild stats in memory
  guildStats.set(guild.id, {
    messageCount: dbMessages,
    papersShared: dbPapers,
    qualityScore: dbQuality,
    lastMessageTimestamp: new Date(),
    activeUsers: new Set<string>(),
  });
  console.log(`[DEBUG] In-memory guild stats initialized for ${guild.id}`);

  guildMessageHistory.set(guild.id, []);
  
  // Sync recent messages (last 24 hours)
  const SYNC_RECENT_MESSAGES = process.env.SYNC_RECENT_MESSAGES || 'true';
  console.log(`[DEBUG] SYNC_RECENT_MESSAGES value: ${SYNC_RECENT_MESSAGES}, type: ${typeof SYNC_RECENT_MESSAGES}`);
  console.log(`[DEBUG] Will sync messages: ${SYNC_RECENT_MESSAGES === 'true' && discordRecord ? 'YES' : 'NO'}`);
  
  if (SYNC_RECENT_MESSAGES === 'true' && discordRecord) {
    try {
      console.log(`[MESSAGE_SYNC] Starting message sync for the last 12 hours in ${guild.name}...`);
      
      // Calculate timestamp for 24 hours ago
      const oneDayAgo = new Date();
      oneDayAgo.setHours(oneDayAgo.getHours() - 12);
      console.log(`[DEBUG] Messages since: ${oneDayAgo.toISOString()}`);
      
      // Get all accessible text channels
      const textChannels = guild.channels.cache.filter(
        channel => channel.type === ChannelType.GuildText && 
                  (channel as TextChannel).viewable
      );
      
      console.log(`[MESSAGE_SYNC] Found ${textChannels.size} accessible text channels in ${guild.name}`);
      if (textChannels.size === 0) {
        console.log(`[DEBUG] No accessible text channels found - check bot permissions in this guild`);
      }
      
      let totalProcessedMessages = 0;
      let totalPapersFound = 0;
      const MESSAGE_FETCH_LIMIT = 50; // Reasonable limit per channel to avoid rate limits
      
      // Process each channel
      for (const [channelId, channel] of textChannels) {
        try {
          console.log(`[MESSAGE_SYNC] Fetching messages from channel #${(channel as TextChannel).name} (${channelId})...`);
          
          // Fetch recent messages
          const messages = await (channel as TextChannel).messages.fetch({ 
            limit: MESSAGE_FETCH_LIMIT 
          });
          console.log(`[DEBUG] Fetched ${messages.size} messages from channel #${(channel as TextChannel).name}`);
          
          // Filter to messages within the last 24 hours and not from bots
          const recentMessages = messages.filter(msg => 
            msg.createdAt >= oneDayAgo && 
            !msg.author.bot
          );
          
          console.log(`[MESSAGE_SYNC] Processing ${recentMessages.size} messages from last 12h in #${(channel as TextChannel).name}`);
          
          // Process each message similar to the message event handler
          for (const [msgId, message] of recentMessages) {
            // Skip if we've already processed this message (unlikely but possible)
            if (processedMessageIdsByGuild[guild.id]?.has(msgId)) {
              continue;
            }
            
            // Mark as processed
            if (!processedMessageIdsByGuild[guild.id]) {
              processedMessageIdsByGuild[guild.id] = new Set<string>();
            }
            processedMessageIdsByGuild[guild.id].add(msgId);
            
            // Check for papers/PDFs
            let foundPaper = false;
            
            // Check attachments for PDFs
            if (message.attachments.size > 0) {
              for (const attachment of message.attachments.values()) {
                if (attachment.contentType?.startsWith('application/pdf') || 
                    attachment.name?.toLowerCase().endsWith('.pdf')) {
                  foundPaper = true;
                  break;
                }
              }
            }
            
            // Check content for paper links
            if (!foundPaper) {
              foundPaper = detectPaper(message.content, false);
            }
            
            // Count paper if found
            if (foundPaper) {
              totalPapersFound++;
            }
            
            // Only count non-low-value messages
            if (!isLowValueMessage(message.content)) {
              totalProcessedMessages++;
              
              // Add to message history for quality evaluation
              const stats = guildStats.get(guild.id);
              if (stats) {
                // Add user to active users
                stats.activeUsers.add(message.author.id);
                
                // Add to history array
                const messageHistoryArray = guildMessageHistory.get(guild.id) || [];
                messageHistoryArray.push({
                  userId: message.author.id,
                  content: message.content,
                  timestamp: message.createdAt,
                  qualityScore: 50 // Default score
                });
                
                // Keep history within size limit
                if (messageHistoryArray.length > MESSAGE_CONFIG.HISTORY_SIZE) {
                  messageHistoryArray.shift();
                }
                
                guildMessageHistory.set(guild.id, messageHistoryArray);
              }
            }
          }
        } catch (channelError) {
          console.error(`[MESSAGE_SYNC] Error processing channel #${(channel as TextChannel).name}:`, channelError);
          // Continue with next channel
        }
      }
      
      // Update stats with the processed messages
      if (totalProcessedMessages > 0 || totalPapersFound > 0) {
        const stats = guildStats.get(guild.id);
        if (stats) {
          // Update in-memory stats
          stats.messageCount += totalProcessedMessages;
          stats.papersShared += totalPapersFound;
          guildStats.set(guild.id, stats);
          
          // Update global maps for compatibility
          messageCountByGuild[guild.id] = stats.messageCount;
          papersSharedByGuild[guild.id] = stats.papersShared;
          
          // Update database
          console.log(`[DEBUG] Updating DB with processed messages (${totalProcessedMessages}) and papers (${totalPapersFound})`);
          try {
            const updateResult = await prisma.discord.update({
              where: { id: discordRecord.id },
              data: {
                messagesCount: stats.messageCount,
                papersShared: stats.papersShared
              }
            });
            console.log(`[DEBUG] DB update result: ${JSON.stringify({
              id: updateResult.id,
              messagesCount: updateResult.messagesCount,
              papersShared: updateResult.papersShared
            })}`);
          } catch (updateError) {
            console.error(`[DEBUG] Failed to update DB with new counts:`, updateError);
          }
          
          console.log(`[MESSAGE_SYNC] Successfully synced ${totalProcessedMessages} messages and ${totalPapersFound} papers for ${guild.name}`);
        } else {
          console.log(`[DEBUG] Stats for guild ${guild.id} unexpectedly missing after processing messages`);
        }
      } else {
        console.log(`[MESSAGE_SYNC] No new messages found to sync for ${guild.name}`);
      }
    } catch (syncError) {
      console.error(`[MESSAGE_SYNC] Error syncing messages for ${guild.name}:`, syncError);
    }
  }
  
  // Notify API and schedule quality evaluation
  console.log(`[DEBUG] Calling notifyPortalAPI for guild ${guild.id}`);
  try {
    await notifyPortalAPI(guild.id, 'stats_update');
    console.log(`[DEBUG] notifyPortalAPI completed successfully`);
  } catch (apiError) {
    console.error(`[DEBUG] notifyPortalAPI failed:`, apiError);
  }
  
  setInterval(() => {
    evaluateMessageQuality(guild.id);
  }, MESSAGE_CONFIG.QUALITY_CHECK_INTERVAL_MS);
  console.log(`[DEBUG] Quality evaluation timer set for guild ${guild.id}`);
  
  // Set in-memory for compatibility, but never use as source of truth
  messageCountByGuild[guild.id] = guildStats.get(guild.id)?.messageCount || dbMessages;
  papersSharedByGuild[guild.id] = guildStats.get(guild.id)?.papersShared || dbPapers;
  qualityScoreByGuild[guild.id] = dbQuality;
  
  console.log(`[DEBUG] initializeGuildStats COMPLETE for guild: ${guild.name} (${guild.id})`);
}

// Track papers shared by looking for links/attachments
const papersSharedByGuild: Record<string, number> = {};

// Track message count by guild
const messageCountByGuild: Record<string, number> = {};

// Simple quality score calculation
const qualityScoreByGuild: Record<string, number> = {};

// Map to store ongoing profile collection by user ID
const userProfileCollections = new Map<string, UserProfileData>();

// Handle guild join event
client.on(Events.GuildCreate, async (guild: Guild) => {
  console.log(`[Discord Bot - GuildCreate] Bot added to guild: ${guild.name} (${guild.id})`);

  // Initialize stats tracking for this guild
  initializeGuildStats(guild);

  try {
    console.log(`[Discord Bot - GuildCreate] Dynamically importing ws.service for guild ${guild.id}...`);
    // Import dynamically to avoid circular dependencies
    const wsService = await import('./websocket/ws.service');
    console.log(
      `[Discord Bot - GuildCreate] Successfully imported ws.service. Attempting to call handleGuildCreate for guild ${guild.id}`
    );

    // Use the ws.service handler to process the event and notify users
    await wsService.handleGuildCreate(guild.id, guild.name, guild.memberCount);
    
    console.log(`[Discord Bot] handleGuildCreate completed for guild ${guild.id}`);
  } catch (error) {
    console.error(`[Discord Bot - GuildCreate] Error calling wsService.handleGuildCreate for guild ${guild.id}:`, error);
    // Even if there's an error with the WebSocket service, still try to notify the Portal API
  }

  try {
    // Also notify the Portal API about this new guild
    console.log(`[Discord Bot - GuildCreate] Notifying Portal API about new guild ${guild.id}`);
    await notifyPortalAPI(guild.id, 'guildCreate');

    console.log(`[Discord Bot] Portal API notification completed for guild ${guild.id}`);
  } catch (apiError) {
    console.error(`[Discord Bot - GuildCreate] Error notifying Portal API for guild ${guild.id}:`, apiError);
  }
});

// Track when members join
client.on(Events.GuildMemberAdd, async (member: GuildMember) => {
  const guild = member.guild;
  console.log(`[MEMBER_JOIN] Event triggered for ${member.user.tag} in ${guild.name}`);

  try {
    console.log(`[MEMBER_JOIN] Attempting to call notifyPortalAPI for guild ${guild.id}`);
    try {
      await notifyPortalAPI(guild.id, 'stats_update');
      console.log(`[MEMBER_JOIN] notifyPortalAPI call completed for guild ${guild.id}`);
    } catch (portalApiError) {
      console.error(`[MEMBER_JOIN] CRITICAL: Error during notifyPortalAPI call for guild ${guild.id}:`, portalApiError);
      // Decide if you want to proceed or return if this API call is critical
      // For now, we'll log and continue to ensure DM logic is attempted.
    }

    console.log(`[MEMBER_JOIN] Attempting to call saveDiscordMember for ${member.user.tag}`);
    await saveDiscordMember(member); // saveDiscordMember has its own try-catch
    console.log(`[MEMBER_JOIN] saveDiscordMember call completed for ${member.user.tag}`);

    // Send DM to project founders
    console.log(`[MEMBER_JOIN] Starting founder DM process for guild ${guild.id}`);
    
    // Find the Discord record for this server
    console.log(`[MEMBER_JOIN] Looking up Discord record for server ${guild.id}`);
    const discordRecord = await prisma.discord.findFirst({ 
      where: { serverId: guild.id } 
    });
    
    if (discordRecord) {
      console.log(`[MEMBER_JOIN] Found Discord record for server ${guild.id}, project ID: ${discordRecord.projectId}`);
      
      // Find the project to get the founders
      console.log(`[MEMBER_JOIN] Looking up project ${discordRecord.projectId} with founders`);
      const project = await prisma.project.findUnique({
        where: { id: discordRecord.projectId },
        include: {
          members: {
            where: { role: "founder" },
            include: {
              bioUser: true
            }
          }
        }
      });

      if (project && project.members && project.members.length > 0) {
        console.log(`[MEMBER_JOIN] Found ${project.members.length} founders for project ${project.id}`);
        
        // Log founder details for debugging (excluding sensitive info)
        project.members.forEach((founder, index) => {
          console.log(`[MEMBER_JOIN] Founder ${index + 1}:`);
          console.log(`  - bioUserId: ${founder.bioUserId}`);
          console.log(`  - discordId present: ${founder.bioUser?.discordId ? 'YES' : 'NO'}`);
          if (founder.bioUser?.discordId) {
            console.log(`  - discordId: ${founder.bioUser.discordId}`);
          }
        });
        
        // For each founder with a Discord ID, send a DM
        for (const founderMember of project.members) {
          if (founderMember.bioUser && founderMember.bioUser.discordId) {
            console.log(`[MEMBER_JOIN] Attempting to notify founder: BioUserID ${founderMember.bioUser.id}, DiscordID ${founderMember.bioUser.discordId}`);
            try {
              // Try to fetch the Discord user object for this founder
              const founderUser = await client.users.fetch(founderMember.bioUser.discordId);
              if (founderUser) {
                console.log(`[MEMBER_JOIN] Successfully fetched founder Discord user: ${founderUser.tag}`);
                // Create and send a detailed notification message about the new member
                const dmMessage = `👋 **New Member Alert!**\n\nA new member has joined your BioDAO community server: **${guild.name}**\n\n**Member Details:**\n• **Username:** ${member.user.tag}\n• **Discord ID:** ${member.id}\n• **Joined:** ${new Date().toLocaleString()}\n\nConsider reaching out to welcome them to your BioDAO community!`;
                try {
                  await founderUser.send(dmMessage);
                  console.log(`[Discord] Sent DM to founder ${founderUser.tag} (${founderMember.bioUser.id})`);
                } catch (dmSendError) {
                  console.error(`[Discord] Failed to send DM to founder ${founderUser.tag} (DiscordID: ${founderMember.bioUser.discordId}):`, dmSendError);
                }
              } else {
                console.error(`[MEMBER_JOIN] Fetched founder user for DiscordID ${founderMember.bioUser.discordId} but it was null/undefined.`);
              }
            } catch (fetchError) {
              console.error(`[Discord] Failed to fetch founder user with DiscordID ${founderMember.bioUser.discordId}:`, fetchError);
            }
          } else {
            console.log(`[MEMBER_JOIN] Skipping founder notification: BioUserID ${founderMember.bioUser?.id} - Missing bioUser or discordId.`);
          }
        }

        // Send welcome DM to the new member to collect LinkedIn/profile information
        await sendWelcomeDMToNewMember(member, discordRecord, project);
      } else {
        console.log(`[MEMBER_JOIN] No founders found for project ${discordRecord.projectId}`);
      }
    } else {
      console.log(`[MEMBER_JOIN] No Discord record found for server ${guild.id}`);
    }

    // Check level requirements when specific member count thresholds are hit
    const memberCount = guild.memberCount;
    console.log(`[MEMBER_JOIN] Current member count: ${memberCount}`);
    if (memberCount === 4 || memberCount === 10 || memberCount % 5 === 0) {
      console.log(
        `[MEMBER_JOIN] Member milestone reached (${memberCount}) - checking level requirements`
      );
      await checkGuildLevelRequirements(guild.id);
    }
  } catch (error) {
    console.error(`[MEMBER_JOIN] Error in GuildMemberAdd event handler:`, error);
  }
});

// Enhanced message handler to better track message counts and papers
client.on(Events.MessageCreate, async (message: Message) => {
  // Ignore bot messages
  if (message.author.bot) return;
  
  // Handle DM responses for user profile collection
  if (message.channel.type === ChannelType.DM) {
    await processDMResponse(message);
    return;
  }
  
  const guildId = message.guild?.id;
  if (!guildId) return;
  
  // Initialize stats tracking if needed
  const stats = guildStats.get(guildId);
  if (!stats) {
    console.log(`[MESSAGE_TRACK] Initializing stats for guild ${guildId} from message event`);
    await initializeGuildStats(message.guild);
  }
  
  // Get updated stats
  const updatedStats = guildStats.get(guildId);
  if (!updatedStats) {
    console.error(`[MESSAGE_TRACK] Failed to get guild stats for ${guildId} even after initialization`);
    return;
  }
  
  // --- DKG PDF Upload Handling ---
  let paperDetected = false;
  if (message.attachments.size > 0) {
    for (const attachment of message.attachments.values()) {
      if (attachment.contentType?.startsWith('application/pdf') || attachment.name?.toLowerCase().endsWith('.pdf')) {
        console.log(`[PDF_DETECT] PDF detected: ${attachment.name} in guild ${guildId}`);
        paperDetected = true;
        
        // Process PDF directly here without relying on external functions
        if (attachment.url) {
          console.log(`[PDF_PROCESS] Processing PDF: ${attachment.name} from guild ${guildId}`);
          try {
            // Get the project ID from the database
            const discordRecord = await prisma.discord.findFirst({
              where: { serverId: guildId },
              select: { projectId: true }
            });
            
            if (discordRecord?.projectId) {
              // Log the PDF detection to DB directly
              await prisma.dKGFile.create({
                data: {
                  hash: `temp-${Date.now()}`, // Temporary hash until actual DKG implementation
                  filename: attachment.name,
                  projectId: discordRecord.projectId,
                }
              });
              
              // Replace reply with emoji reaction
              await message.react('📄'); // Paper emoji reaction
              console.log(`[PDF_PROCESS] Successfully logged PDF: ${attachment.name} for project ${discordRecord.projectId}`);
            }
          } catch (uploadError) {
            console.error(`[PDF_PROCESS] Error processing PDF: ${attachment.name}`, uploadError);
          }
        }
      }
    }
  }
  
  // Check for paper links in message
  const hasPaperLink = detectPaper(message.content, paperDetected);
  if (hasPaperLink || paperDetected) {
    updatedStats.papersShared += 1;
    console.log(`[PAPER_TRACK] Paper count increased to ${updatedStats.papersShared} in guild ${guildId}`);
    papersSharedByGuild[guildId] = updatedStats.papersShared;
    
    try {
      // Update the paper count in the database
      const discordRecord = await prisma.discord.findFirst({ 
        where: { serverId: guildId } 
      });
      
      if (discordRecord) {
        await prisma.discord.update({
          where: { id: discordRecord.id },
          data: { papersShared: updatedStats.papersShared }
        });
        console.log(`[PAPER_TRACK] Updated paper count in DB for guild ${guildId}`);
      }
    } catch (dbError) {
      console.error(`[PAPER_TRACK] Error updating paper count in DB:`, dbError);
    }
  }
  
  // Skip low value messages for count, but still process papers
  const isLowValue = isLowValueMessage(message.content);
  if (!isLowValue) {
    // Increment message count
    updatedStats.messageCount += 1;
    messageCountByGuild[guildId] = updatedStats.messageCount;
    console.log(`[MESSAGE_TRACK] Message count increased to ${updatedStats.messageCount} in guild ${guildId}`);
    
    // Add user to active users set
    updatedStats.activeUsers.add(message.author.id);
    
    // Update last message timestamp
    updatedStats.lastMessageTimestamp = new Date();
    
    try {
      // Update the message count in the database
      const discordRecord = await prisma.discord.findFirst({ 
        where: { serverId: guildId } 
      });
      
      if (discordRecord) {
        await prisma.discord.update({
          where: { id: discordRecord.id },
          data: { messagesCount: updatedStats.messageCount }
        });
        console.log(`[MESSAGE_TRACK] Updated message count in DB for guild ${guildId}`);
      }
    } catch (dbError) {
      console.error(`[MESSAGE_TRACK] Error updating message count in DB:`, dbError);
    }
    
    // Add to message history for quality evaluation
    const messageHistoryArray = guildMessageHistory.get(guildId) || [];
    messageHistoryArray.push({
      userId: message.author.id,
      content: message.content,
      timestamp: new Date(),
      qualityScore: 50 // Default score, will be evaluated later
    });
    
    // Limit history size
    if (messageHistoryArray.length > MESSAGE_CONFIG.HISTORY_SIZE) {
      messageHistoryArray.shift();
    }
    
    guildMessageHistory.set(guildId, messageHistoryArray);
  }
  
  // Save updated stats
  guildStats.set(guildId, updatedStats);
  
  // Notify Portal API on milestones
  if (updatedStats.messageCount % 10 === 0 || updatedStats.papersShared % 5 === 0) {
    try {
      await notifyPortalAPI(guildId, 'stats_update');
      console.log(`[API_NOTIFY] Portal API notified for guild ${guildId} stats update`);
    } catch (apiError) {
      console.error(`[API_NOTIFY] Error notifying Portal API:`, apiError);
    }
  }
});

/**
 * Save a Discord member to the database
 */
async function saveDiscordMember(member: GuildMember): Promise<void> {
  console.log(`[MEMBER_SAVE_ENTRY] Attempting to save member ${member.user.tag} (${member.user.id}) from guild ${member.guild.id}`);
  try {
    // First check if this Discord record exists for the guild
    const discordGuildRecord = await prisma.discord.findFirst({
      where: { serverId: member.guild.id }
    });

    if (!discordGuildRecord) {
      console.warn(`[MEMBER_SAVE] No Discord guild record found for server ${member.guild.id}. Cannot save member ${member.user.tag}. This guild might not be registered in the system.`);
      return;
    }
    console.log(`[MEMBER_SAVE] Found guild record for server ${member.guild.id}. Project ID: ${discordGuildRecord.projectId}`);

    // Check if member already exists in the database
    const existingMember = await prisma.discordMember.findUnique({
      where: { discordId: member.user.id } // Assuming discordId is unique across all guilds for a user
                                          // If a user can be in multiple DAOs, this model might need adjustment
                                          // or a composite key like { discordId_discordServerId }
    });

    if (existingMember) {
      console.log(`[MEMBER_SAVE] Member ${member.user.tag} (DiscordID: ${member.user.id}) already exists in database (ID: ${existingMember.id}). Skipping save.`);
      // Optionally, update their username/avatar if it changed, or lastSeenAt timestamp
      return;
    }

    console.log(`[MEMBER_SAVE] Member ${member.user.tag} does not exist. Creating new record.`);
    // Create the new member record
    const newMemberRecord = await prisma.discordMember.create({
      data: {
        discordId: member.user.id,
        discordUsername: member.user.tag,
        discordAvatar: member.user.displayAvatarURL(),
        discordServerId: member.guild.id, // This links the member to this specific guild
        // Ensure projectId is linked if your schema supports it directly on DiscordMember
        // or rely on the discordServerId to link back to the project via the Discord table.
        // For now, assuming discordServerId is the link.
        linkedinUrl: null,
        scientificProfileUrl: null,
        motivationToJoin: null,
        isOnboarded: false,
        paperContributions: 0,
        messageCount: 0,
      }
    });

    console.log(`[MEMBER_SAVE] Successfully saved Discord member ${member.user.tag} to database with new ID ${newMemberRecord.id}`);

  } catch (error) {
    console.error(`[MEMBER_SAVE_ERROR] Error saving Discord member ${member.user.tag} (${member.user.id}) to database:`, error);
  }
  console.log(`[MEMBER_SAVE_EXIT] Finished save attempt for member ${member.user.tag}`);
}

// --- REPLACE UserProfileData and onboarding state tracking ---
interface UserProfileData {
  userId: string;
  guildId: string;
  contributorType?: string; // e.g., 'scientist', 'developer', 'community', 'other'
  credentials: {
    linkedin?: string;
    github?: string;
    scholar?: string;
    orcid?: string;
    twitter?: string;
    other?: string;
  };
  description?: string; // For 'other' or extra info
  onboardingStep: number; // 1: self-ID, 2: credentials, 3: confirm
  lastInteraction: Date;
  isComplete: boolean;
}

// --- REPLACE setupPersistentResponseCollector ---
function setupPersistentResponseCollector(userId: string, guildId: string): void {
  console.log(`[PROFILE_SETUP] Setting up persistent response collector for UserID: ${userId}, GuildID: ${guildId}`);
  if (!userProfileCollections.has(userId)) {
    userProfileCollections.set(userId, {
      userId,
      guildId,
      onboardingStep: 1,
      credentials: {},
      lastInteraction: new Date(),
      isComplete: false,
    });
    console.log(`[PROFILE] Initialized profile collection for user ${userId}`);
  }
}

// --- REPLACE sendWelcomeDMToNewMember ---
async function sendWelcomeDMToNewMember(member: GuildMember, discordRecord: any, project: any): Promise<void> {
  // Setup collector first
  setupPersistentResponseCollector(member.user.id, member.guild.id);

  // Set onboarding step to 1
  let profile = userProfileCollections.get(member.user.id);
  if (profile) {
      profile.onboardingStep = 1;
  } else {
      console.error(`[WELCOME_DM] Profile not found for ${member.user.id} after setup. Initializing robustly.`);
      userProfileCollections.set(member.user.id, {
          userId: member.user.id,
          guildId: member.guild.id,
          onboardingStep: 1,
          credentials: {},
          lastInteraction: new Date(),
          isComplete: false,
      });
      profile = userProfileCollections.get(member.user.id)!;
      if (profile) {
          profile.onboardingStep = 1;
          console.log(`[PROFILE] Force-initialized profile and set step for ${member.user.id} in sendWelcomeDMToNewMember.`);
      } else {
          console.error(`[PROFILE] CRITICAL: Failed to retrieve profile for ${member.user.id} even after force-initialization.`);
          return; // Cannot proceed if profile is not set up
      }
  }

  try {
    const welcomeText = `👋 Welcome to **${project.projectName || member.guild.name}**! We're excited to have you.\n\nTo help us understand your interests and how you'd like to contribute, please select an option below:`;

    const scientistButton = new ButtonBuilder()
      .setCustomId('onboarding_scientist')
      .setLabel('Scientist / Researcher')
      .setStyle(ButtonStyle.Primary);

    const developerButton = new ButtonBuilder()
      .setCustomId('onboarding_developer')
      .setLabel('Developer / Engineer')
      .setStyle(ButtonStyle.Primary);

    const communityButton = new ButtonBuilder()
      .setCustomId('onboarding_community')
      .setLabel('Community Builder')
      .setStyle(ButtonStyle.Primary);

    const web3Button = new ButtonBuilder()
      .setCustomId('onboarding_web3_enthusiast')
      .setLabel('Web3 Enthusiast')
      .setStyle(ButtonStyle.Primary);

    const row = new ActionRowBuilder<ButtonBuilder>()
      .addComponents(scientistButton, developerButton, communityButton, web3Button);

    await member.send({ content: welcomeText, components: [row] });
    console.log(`[WELCOME_DM] Sent welcome DM with buttons to new member ${member.user.tag} (${member.user.id})`);

  } catch (error) {
    console.error(`[WELCOME_DM] Error sending welcome DM with buttons to ${member.user.tag} (${member.user.id}):`, error);
    const welcomeChannel = member.guild.channels.cache.find(
      (ch) => ch.type === ChannelType.GuildText && ch.name.toLowerCase().includes('welcome')
    ) as TextChannel | undefined;
    if (welcomeChannel) {
      try {
        await welcomeChannel.send(`👋 Welcome <@${member.user.id}>! I tried to send you a DM with some options to start your onboarding, but it seems your DMs might be closed. Please check your server privacy settings and then DM me directly to begin!`);
        console.log(`[WELCOME_DM] Sent fallback welcome message in #${welcomeChannel.name} for ${member.user.tag} due to DM failure.`);
      } catch (fallbackError) {
        console.error(`[WELCOME_DM] Failed to send fallback welcome message in #${welcomeChannel?.name}:`, fallbackError);
      }
    }
  }
}

// Add this new interaction handler
client.on(Events.InteractionCreate, async (interaction: Interaction) => {
  if (!interaction.isButton()) return;

  const { customId, user } = interaction;
  const userId = user.id;

  if (customId.startsWith('onboarding_')) {
    await interaction.deferUpdate(); // Acknowledge the button click

    let profileData = userProfileCollections.get(userId);
    if (!profileData) {
      // This can happen if the user clicks a button from an old message after bot restart or map clear
      // Or if they weren't properly added to userProfileCollections during GuildMemberAdd
      // Attempt to set up profile data again. Guild ID might be missing if not from GuildMemberAdd initially.
      // We need guildId for role assignment. If the interaction is from a DM, interaction.guildId is null.
      // The original guildId should have been stored in profileData when sendWelcomeDMToNewMember was called.
      
      // Let's try to retrieve it one more time, in case it was set by GuildMemberAdd but interaction is faster
      const member = interaction.member as GuildMember; // This is only available if interaction is from a guild context, not DM
      const guildIdFromInteraction = member?.guild?.id;

      setupPersistentResponseCollector(userId, guildIdFromInteraction || ' '); // guildId might be empty
      profileData = userProfileCollections.get(userId);

      if (!profileData) {
          console.error(`[INTERACTION_PROFILE] CRITICAL: Profile for ${userId} still not found after trying to set up from interaction. Cannot proceed with onboarding via button.`);
          try {
            await interaction.followUp({ content: "Sorry, there was an issue retrieving your onboarding status. Please try typing 'hello' to restart the process.", ephemeral: true });
          } catch (e) { console.error("Failed to send followUp to interaction", e); }
          return;
      }
       // Ensure onboarding step is 1 if we are re-initializing
      profileData.onboardingStep = 1; 
    }
    
    // Ensure guildId is present in profileData for role assignment
    if (!profileData.guildId || profileData.guildId.trim() === '') {
        // This implies the profile was set up without a guildId (e.g. direct DM to bot without prior join)
        console.error(`[INTERACTION_PROFILE] CRITICAL: profileData.guildId is missing for user ${userId}. Cannot assign role.`);
        // Ask for credentials, but skip role assignment
    }


    if (profileData.onboardingStep !== 1) {
      console.log(`[INTERACTION_HANDLER] User ${userId} clicked onboarding button but is not on step 1 (current step: ${profileData.onboardingStep}). Ignoring.`);
      // Optionally, tell the user they are already past this step or to follow current instructions.
      // await interaction.followUp({ content: "You've already selected your contributor type.", ephemeral: true });
      return;
    }

    let type = customId.replace('onboarding_', '');
    if (type === 'web3_enthusiast') {
        profileData.contributorType = 'web3_enthusiast';
        profileData.description = 'Web3 Enthusiast';
    } else if (type === 'scientist' || type === 'developer' || type === 'community') {
        profileData.contributorType = type;
        profileData.description = type.charAt(0).toUpperCase() + type.slice(1);
    } else {
        console.warn(`[INTERACTION_HANDLER] Unknown onboarding type from button: ${type}`);
        await interaction.followUp({ content: "Sorry, I didn't recognize that selection. Please try again or type 'help'.", ephemeral: true });
        return;
    }
    
    profileData.onboardingStep = 2;
    userProfileCollections.set(userId, profileData);

    console.log(`[INTERACTION_HANDLER] User ${userId} selected contributor type: ${profileData.contributorType}. GuildID: ${profileData.guildId}. Proceeding to role assignment and credential prompt.`);

    // Assign role
    if (profileData.guildId && profileData.guildId.trim() !== '') {
        try {
            const roleAssigned = await assignContributorRole(client, profileData.guildId, userId, profileData.contributorType);
            const friendlyTypeName = profileData.contributorType.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
            if (roleAssigned) {
                await interaction.followUp({ content: `✅ You've been assigned the **${friendlyTypeName}** role in the server!\n\n*If you don't see it immediately, sometimes Discord takes a moment, or you might need to toggle your server profile or restart Discord.*`, ephemeral: true });
            } else {
                await interaction.followUp({ content: `📝 Your selection (${friendlyTypeName}) has been noted. We'll update server roles if applicable.`, ephemeral: true });
            }
        } catch (roleError) {
            console.error(`[INTERACTION_HANDLER] Error calling assignContributorRole for user ${userId}:`, roleError);
            await interaction.followUp({ content: "There was an issue setting your role, but your contributor type has been noted.", ephemeral: true });
        }
    } else {
        console.warn(`[INTERACTION_HANDLER] Cannot assign role for user ${userId}: profileData.guildId is missing or empty. This can happen if user DMs bot directly or initial setup failed.`);
         const friendlyTypeName = profileData.contributorType.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
        await interaction.followUp({ content: `📝 Your contributor type (${friendlyTypeName}) has been noted!`, ephemeral: true }).catch(console.error);
    }
    
    // Ask for credentials
    let prompt = '';
    const nextStepPrompt = "\n\nPlease reply to this message with the requested information. If you don't have something, you can type 'skip'.";
    switch (profileData.contributorType) {
      case 'scientist':
        prompt = `🔬 **Scientist/Researcher Profile**\nTo help us connect you with relevant opportunities, please share any of the following:\n• Your **LinkedIn** profile URL\n• Your **Google Scholar** profile URL\n• Your **ORCID** iD or profile URL\n• Links to any key **research papers, projects, or your ResearchGate** profile.` + nextStepPrompt;
        break;
      case 'developer':
        prompt = `💻 **Developer/Engineer Profile**\nLet's see your work! Please share:\n• Your **LinkedIn** profile URL\n• Your **GitHub** profile URL\n• Links to any **notable projects, portfolios, or contributions** you're proud of.` + nextStepPrompt;
        break;
      case 'community':
        prompt = `💬 **Community Builder Profile**\nTell us about your community involvement! Please share:\n• Your **LinkedIn** profile URL\n• Your **Twitter (X)** profile URL\n• Details about **communities you've managed or contributed to**, or any relevant links.` + nextStepPrompt;
        break;
      case 'web3_enthusiast':
        prompt = `🌐 **Web3 Enthusiast Profile**\nWe're glad to have your interest in Web3! Please share:\n• Your **LinkedIn** profile URL (if you have one)\n• Your **Twitter (X)** profile URL (if you have one)\n• A brief description of your **interests in Web3, or any projects/DAOs you follow or are part of**.` + nextStepPrompt;
        break;
    }
    // Send the credential prompt as a new message in the DM channel
    try {
        const dmChannel = await interaction.user.createDM();
        await dmChannel.send(prompt);
        console.log(`[INTERACTION_HANDLER] Sent credential prompt to ${userId} for type ${profileData.contributorType}.`);
    } catch (dmError) {
        console.error(`[INTERACTION_HANDLER] Failed to send credential prompt DM to ${userId}:`, dmError);
        // If DM fails, try to use ephemeral follow-up, though it might be too long.
        try {
            await interaction.followUp({ content: `There was an issue DMing you the next step. Please ensure your DMs are open. The next step is: ${prompt}`, ephemeral: true });
        } catch (e) { /* ignore, already logged */ }
    }
  }
});

// Modify processDMResponse to primarily handle steps 2 and 3, 
// as step 1 (contributor type) is now handled by button interaction.
// However, if a user types during step 1 instead of clicking, we can still process it.
async function processDMResponse(message: Message): Promise<void> {
  if (message.channel.type !== ChannelType.DM || message.author.bot) return;

  const userId = message.author.id;
  let profileData = userProfileCollections.get(userId);

  if (!profileData) {
    console.log(`[PROCESS_DM] No profile found for ${userId}. This might be a new user DMing directly or a race condition.`);
    
    let potentialGuildId = '';
    // Attempt to find a mutual server to infer guildId if user DMed directly
    // This is a simple approach; for bots in many mutual servers, this might not be reliable enough
    // and a disambiguation step for the user might be better.
    client.guilds.cache.forEach(guild => {
        if (guild.members.cache.has(userId)) {
            potentialGuildId = guild.id; 
            // If user is in multiple mutual servers with the bot, this takes the last one found.
        }
    });

    if (potentialGuildId) {
        console.log(`[PROCESS_DM] User ${userId} DMed directly. Found potential guildId: ${potentialGuildId} from mutual server.`);
    } else {
        console.log(`[PROCESS_DM] User ${userId} DMed directly. No mutual server found to infer guildId. Role assignment will be skipped if initiated this way.`);
    }

    setupPersistentResponseCollector(userId, potentialGuildId); 
    profileData = userProfileCollections.get(userId)!; // Should exist now
    
    if (!profileData) {
        console.error(`[PROCESS_DM] CRITICAL: Profile for ${userId} is null even after setupPersistentResponseCollector. Aborting.`);
        await message.reply("Sorry, there was an internal error setting up your profile. Please try again later or contact support.");
        return;
    }
    
    profileData.onboardingStep = 1; // Set to step 1, expecting text input for contributor type
    userProfileCollections.set(userId, profileData); // Save the updated profile

    // Do NOT send buttons here if it's a new profile. 
    // The GuildMemberAdd event (sendWelcomeDMToNewMember) is responsible for sending buttons.
    // If the user DMs first, they will get a text prompt.
    await message.reply("Hello! To get started with your onboarding, please tell me how you would self-identify. For example, you can type:\n• `Scientist`\n• `Developer`\n• `Community Builder`\n• `Web3 Enthusiast`");
    console.log(`[PROCESS_DM] Sent text-based initial prompt to user ${userId} (updated for Web3 Enthusiast).`);
    return; 
  }

  profileData.lastInteraction = new Date();
  const content = message.content.trim();

  // --- Step 1: Contributor Type (Text Input) ---
  if (profileData.onboardingStep === 1) {
    console.log(`[PROCESS_DM_STEP1_TEXT] User ${userId} (guildId: ${profileData.guildId || 'N/A'}) typed for step 1: "${content}"`);
    const type = content.toLowerCase();
    if (type.includes('scientist') || type.includes('researcher')) profileData.contributorType = 'scientist';
    else if (type.includes('developer') || type.includes('engineer') || type.includes('dev')) profileData.contributorType = 'developer';
    else if (type.includes('community')) profileData.contributorType = 'community';
    else if (type.includes('web3') || type.includes('enthusiast')) profileData.contributorType = 'web3_enthusiast';
    else {
        // If none of the keywords match, default to web3_enthusiast but use their text as description
        profileData.contributorType = 'web3_enthusiast'; 
        profileData.description = content; // User's original text becomes description for this catch-all
        console.log(`[PROCESS_DM_STEP1_TEXT] User ${userId} typed "${content}", defaulted to web3_enthusiast, description set to input.`);
    } 
    // If it's a recognized type (not the else block above), set description to the type itself for consistency
    if (profileData.description !== content && profileData.contributorType !== 'web3_enthusiast') {
         profileData.description = profileData.contributorType.charAt(0).toUpperCase() + profileData.contributorType.slice(1);
    }
    // Special handling if it defaulted to web3_enthusiast and used content as description, ensure contributorType reflects this too for role map.
    if (profileData.description === content && profileData.contributorType === 'web3_enthusiast'){
        // No change needed here, type is already web3_enthusiast
    } else if (profileData.contributorType !== 'web3_enthusiast') { // For scientist, dev, community, ensure description is standardized if not custom
         profileData.description = profileData.contributorType.charAt(0).toUpperCase() + profileData.contributorType.slice(1);
    } else { // It is web3_enthusiast from keyword match, ensure description is standardized.
         profileData.description = "Web3 Enthusiast";
    }

    profileData.onboardingStep = 2;
    userProfileCollections.set(userId, profileData);
    const friendlyTypeNameRole = profileData.contributorType.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());

    // ... (Role assignment logic - uses profileData.contributorType, which is now correctly set)
    if (profileData.guildId && profileData.contributorType) {
      try {
        const roleAssigned = await assignContributorRole(client, profileData.guildId, userId, profileData.contributorType);
        if (roleAssigned) {
          await message.reply(`✅ Role assigned: You're now a **${friendlyTypeNameRole}** in the server!\n\n*If you don't see it immediately, sometimes Discord takes a moment or a quick restart of your app helps.*`);
        } else {
           await message.reply(`📝 Your selection (${friendlyTypeNameRole}) has been noted. We'll update server roles if applicable.`);
        }
      } catch (roleError) {
        // ... (error handling)
      }
    } else {
      // ... (warning for missing guildId)
    }

    // Updated credential prompts to match interaction handler
    let prompt = '';
    const nextStepPrompt = "\n\nPlease reply to this message with the requested information. If you don't have something, you can type 'skip'.";
    switch (profileData.contributorType) {
      case 'scientist':
        prompt = `🔬 **Scientist/Researcher Profile**\nTo help us connect you with relevant opportunities, please share any of the following:\n• Your **LinkedIn** profile URL\n• Your **Google Scholar** profile URL\n• Your **ORCID** iD or profile URL\n• Links to any key **research papers, projects, or your ResearchGate** profile.` + nextStepPrompt;
        break;
      case 'developer':
        prompt = `💻 **Developer/Engineer Profile**\nLet's see your work! Please share:\n• Your **LinkedIn** profile URL\n• Your **GitHub** profile URL\n• Links to any **notable projects, portfolios, or contributions** you're proud of.` + nextStepPrompt;
        break;
      case 'community':
        prompt = `💬 **Community Builder Profile**\nTell us about your community involvement! Please share:\n• Your **LinkedIn** profile URL\n• Your **Twitter (X)** profile URL\n• Details about **communities you've managed or contributed to**, or any relevant links.` + nextStepPrompt;
        break;
      case 'web3_enthusiast':
        prompt = `🌐 **Web3 Enthusiast Profile**\nWe're glad to have your interest in Web3! Please share:\n• Your **LinkedIn** profile URL (if you have one)\n• Your **Twitter (X)** profile URL (if you have one)\n• A brief description of your **interests in Web3, or any projects/DAOs you follow or are part of**.` + nextStepPrompt;
        break;
    }
    await message.reply(prompt);
    return;
  }

  // --- Step 2: Credentials ---
  if (profileData.onboardingStep === 2) {
    // Parse and store credentials based on type
    const lower = content.toLowerCase();
    let found = false;
    if (content.match(/linkedin\.com\//i)) {
      profileData.credentials.linkedin = content.match(/https?:\/\/(www\.)?linkedin\.com\/in\/[\w\-]+/i)?.[0] || content;
      found = true;
    }
    if (content.match(/github\.com\//i)) {
      profileData.credentials.github = content.match(/https?:\/\/(www\.)?github\.com\/[\w\-]+/i)?.[0] || content;
      found = true;
    }
    if (content.match(/scholar\.google\.com/i)) {
      profileData.credentials.scholar = content.match(/https?:\/\/(www\.)?scholar\.google\.com\/[\w\-\/?=]+/i)?.[0] || content;
      found = true;
    }
    if (content.match(/orcid\.org/i)) {
      profileData.credentials.orcid = content.match(/https?:\/\/(www\.)?orcid\.org\/[\d\-]+/i)?.[0] || content;
      found = true;
    }
    if (content.match(/twitter\.com\//i)) {
      profileData.credentials.twitter = content.match(/https?:\/\/(www\.)?twitter\.com\/[\w\-]+/i)?.[0] || content;
      found = true;
    }
    // Accept any other link as 'other'
    if (!found && content.match(/https?:\/\//i)) {
      profileData.credentials.other = content.match(/https?:\/\/[\w\-\.\/\?=]+/i)?.[0] || content;
      found = true;
    }
    // Accept freeform description for 'other'
    if (!found && profileData.contributorType === 'other') {
      profileData.description = content;
      found = true;
    }
    // If at least one credential or description, move to next step
    if (found) {
      profileData.onboardingStep = 3;
      await message.reply(`✅ Got it! Your information has been added.\n\nType **'done'** if you have nothing more to add, or provide another link/credential.`);
    } else {
      await message.reply(`Hmm, I didn't recognize that as a common link format (like LinkedIn, GitHub, Scholar, ORCID, Twitter) or a description for your Web3 interests. \n\nPlease try again with a valid URL, or type **'done'** to finish with the info you've provided so far.`);
    }
    userProfileCollections.set(userId, profileData);
    return;
  }
  // --- Step 3: Confirmation ---
  if (profileData.onboardingStep === 3) {
    if (content.toLowerCase() === 'done') {
      profileData.isComplete = true;
      await message.reply(`🎉 **Onboarding Complete!** Thank you for sharing your information.\n\nOur team will review your profile. You can update your info anytime by DMing me again with new links or details.\n\nWelcome to the community!`);
      // Save to DB and notify founders (reuse existing logic, adapt as needed)
      await saveUserProfileToDatabase(profileData);
      await notifyFoundersAboutNewMemberProfile(profileData);
      userProfileCollections.set(userId, profileData);
      return;
    } else {
      // Allow adding more credentials
      profileData.onboardingStep = 2;
      await processDMResponse(message); // Recurse to handle as step 2
      return;
    }
  }
  // Fallback: help
  await message.reply("I'm not sure how to process that. If you're stuck in onboarding, you can try DMing me 'help' or contact a server admin.");
}

// Move saveUserProfileToDatabase above processDMResponse
// Update all references to profileData.linkedIn to profileData.credentials?.linkedin
async function saveUserProfileToDatabase(profileData: UserProfileData): Promise<void> {
  try {
    console.log(`[PROFILE_SAVE] Saving profile data for user ${profileData.userId}`);

    // First check if this Discord record exists
    const discordRecord = await prisma.discord.findFirst({
      where: { serverId: profileData.guildId }
    });

    if (!discordRecord) {
      console.log(`[PROFILE_SAVE] No Discord record found for server ${profileData.guildId}, cannot save profile`);
      return;
    }

    // Check if member already exists in the database
    const existingMember = await prisma.discordMember.findUnique({
      where: { discordId: profileData.userId }
    });

    if (existingMember) {
      console.log(`[PROFILE_SAVE] Member ${profileData.userId} already exists in database, skipping save`);
      return;
    }

    // Create the new member record
    const newMember = await prisma.discordMember.create({
      data: {
        discordId: profileData.userId,
        discordUsername: profileData.userId,
        discordAvatar: null,
        discordServerId: profileData.guildId,
        linkedinUrl: profileData.credentials?.linkedin || null,
        scientificProfileUrl: profileData.credentials?.scholar || null,
        motivationToJoin: profileData.description || null,
        isOnboarded: true,
        paperContributions: 0,
        messageCount: 0,
      }
    });

    console.log(`[PROFILE_SAVE] Successfully saved Discord member ${profileData.userId} to database with ID ${newMember.id}`);
  } catch (error) {
    console.error(`[PROFILE_SAVE] Error saving Discord member to database:`, error);
  }
}

// Rename and update the notifyFoundersAboutMeetingRequest function to be more informative about new member profiles
async function notifyFoundersAboutNewMemberProfile(profileData: UserProfileData): Promise<void> {
  try {
    const { guildId, userId } = profileData;
    
    // Get Discord info for this guild
    const discordRecord = await prisma.discord.findFirst({
      where: { serverId: guildId },
      include: { project: true }
    });
    
    if (!discordRecord || !discordRecord.project) {
      console.error(`[MEMBER_PROFILE] Could not find project for guild ${guildId}`);
      return;
    }
    
    // Find founders with Discord IDs
    const founders = await prisma.projectMember.findMany({
      where: {
        projectId: discordRecord.project.id,
        role: 'founder',
        bioUser: {
          discordId: {
            not: null
          }
        }
      },
      include: {
        bioUser: true
      }
    });
    
    if (!founders || founders.length === 0) {
      console.log(`[MEMBER_PROFILE] No founders found with Discord IDs for project ${discordRecord.project.id}`);
      return;
    }
    
    // Get user info safely
    let user;
    try {
      user = await client.users.fetch(userId);
    } catch (error) {
      console.error(`[MEMBER_PROFILE] Error fetching user ${userId}:`, error);
      return;
    }

    if (!user) {
      console.error(`[MEMBER_PROFILE] Could not fetch user ${userId}`);
      return;
    }
    
    // Fetch Discord member record to get the scientific profiles
    const memberRecord = await prisma.discordMember.findUnique({
      where: { discordId: userId },
      include: { scientificProfiles: true }
    });
    
    // Determine what was updated
    let updateType = 'profile';
    if (profileData.credentials?.linkedin && (!memberRecord || memberRecord.linkedinUrl !== profileData.credentials?.linkedin)) {
      updateType = 'LinkedIn';
    } else if (profileData.credentials?.scholar && (!memberRecord || !memberRecord.scientificProfiles || memberRecord.scientificProfiles.length === 0)) {
      updateType = 'scientific profiles';
    } else if (profileData.credentials?.other) {
      updateType = 'research papers';
    } else if (profileData.isComplete) {
      updateType = 'completed profile';
    }
    
    // Compile profile info for the notification
    const linkedInInfo = profileData.credentials?.linkedin ? `\n**LinkedIn:** ${profileData.credentials?.linkedin}` : "\n**LinkedIn:** Not provided";
    
    // Format scientific profiles nicely
    let scientificProfilesInfo = "\n**Scientific Profiles:** Not provided";
    if (memberRecord?.scientificProfiles && memberRecord.scientificProfiles.length > 0) {
      scientificProfilesInfo = "\n**Scientific Profiles:**";
      memberRecord.scientificProfiles.forEach(profile => {
        scientificProfilesInfo += `\n• ${profile.platform}: ${profile.url}`;
      });
    } else if (profileData.credentials?.scholar) {
      scientificProfilesInfo = `\n**Scientific Profiles:** ${profileData.credentials?.scholar}`;
    }
    
    const papersInfo = profileData.credentials?.other ? 
      `\n**Research Papers:** ${profileData.credentials?.other.substring(0, 200)}${profileData.credentials?.other.length > 200 ? '...' : ''}` : 
      "\n**Research Papers:** Not provided";
    
    // Notify each founder
    for (const founder of founders) {
      try {
        // Skip founders without a Discord ID
        if (!founder.bioUser?.discordId) {
          console.log(`[MEMBER_PROFILE] Founder ${founder.bioUserId} has no Discord ID, skipping notification`);
          continue;
        }
        
        const founderUser = await client.users.fetch(founder.bioUser.discordId);
        if (founderUser) {
          const notification = `
📝 **Member Profile Update**

A member in your BioDAO community server **${discordRecord.project.projectName || discordRecord.serverName || 'your project'}** has shared their ${updateType}.

**Member Details:**
• **Username:** ${user.tag}
• **Discord ID:** ${user.id}
• **Update Time:** ${new Date().toLocaleString()}${linkedInInfo}${scientificProfilesInfo}${papersInfo}

This member may be a good candidate for collaboration or a 1:1 onboarding meeting if you wish to reach out.
`;
          await founderUser.send(notification);
          console.log(`[MEMBER_PROFILE] Sent profile notification to founder ${founderUser.tag}`);
        }
      } catch (error) {
        // Safe error logging that doesn't rely on potentially undefined properties
        console.error(`[MEMBER_PROFILE] Error notifying founder ${founder.bioUser?.discordId || founder.bioUserId}:`, error);
      }
    }
    
  } catch (error) {
    console.error(`[MEMBER_PROFILE] Error notifying founders about member profile:`, error);
  }
}

// --- Utility functions re-added to fix linter errors ---

async function updateAllGuildStats(): Promise<void> {
  console.log('Running scheduled guild stats update...');
  for (const [guildId, stats] of guildStats.entries()) {
    try {
      await notifyPortalAPI(guildId, 'stats_update');
    } catch (error) {
      console.error(`Error updating stats for guild ${guildId}:`, error);
    }
  }
  console.log('Scheduled update complete');
}

async function notifyPortalAPI(
  guildId: string,
  eventType: 'guildCreate' | 'stats_update'
): Promise<void> {
  console.log(`[PORTAL_API] Attempting to notify for guild ${guildId}, event: ${eventType}`);
  try {
    const guild = client.guilds.cache.get(guildId);
    if (!guild) {
      console.warn(`Cannot update stats: Guild ${guildId} not found`);
      return;
    }
    // Always fetch current stats from the database
    const discordRecord = await prisma.discord.findFirst({ where: { serverId: guildId } });
    const dbMessages = discordRecord?.messagesCount || 0;
    const dbPapers = discordRecord?.papersShared || 0;
    const dbQuality = discordRecord?.qualityScore || 50;
    const stats = guildStats.get(guildId) || {
      messageCount: dbMessages,
      papersShared: dbPapers,
      qualityScore: dbQuality,
      lastMessageTimestamp: new Date(),
      activeUsers: new Set<string>(),
    };
    // Prepare payload - always use database values
    const payload = {
      event: eventType,
      guildId: guild.id,
      memberCount: guild.memberCount,
      messagesCount: dbMessages,
      papersShared: dbPapers,
      qualityScore: Math.round(dbQuality),
      activeUsers: stats.activeUsers.size,
      apiKey: API_KEY,
    };
    // Determine endpoint based on event type
    let endpoint;
    if (eventType === 'guildCreate') {
      endpoint = '/api/discord/bot-installed';
      console.log(`Notifying API of bot installation in ${guild.name}`);
    } else {
      endpoint = '/api/discord/stats-update';
      console.log(`Updating stats for ${guild.name}: ${JSON.stringify(payload)}`);
    }
    // Send to API
    const response = await axios.post(`${PORTAL_API_URL}${endpoint}`, payload);
    console.log(`[PORTAL_API] Successfully notified for guild ${guildId}, event: ${eventType}. Response: ${response.status}`);
  } catch (error: any) { // Catching error as any
    console.error(`[PORTAL_API_ERROR] Failed to notify Portal API for guild ${guildId}, event: ${eventType}. Error: ${error.message}`);
    if (error.response) {
      console.error('[PORTAL_API_ERROR_DATA]', error.response.data);
      console.error('[PORTAL_API_ERROR_STATUS]', error.response.status);
      console.error('[PORTAL_API_ERROR_HEADERS]', error.response.headers);
    } else if (error.request) {
      console.error('[PORTAL_API_ERROR_REQUEST]', 'No response received, request was made:', error.request);
    } else {
      console.error('[PORTAL_API_ERROR_SETUP]', 'Error setting up the request:', error.message);
    }
    // Re-throw the error if you want the caller (GuildMemberAdd) to handle it further or stop execution.
    // For now, we log it and let GuildMemberAdd continue.
    // throw error; // Uncomment if this API call is absolutely critical to halt further GMANewMember logic
  }
}

function evaluateMessageQuality(guildId: string): void {
  const stats = guildStats.get(guildId);
  const messageHistory = guildMessageHistory.get(guildId);
  if (!stats || !messageHistory) return;
  console.log(`Evaluating message quality for guild ${guildId}`);
  // Get the last 24 hours of messages
  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const recentMessages = messageHistory.filter((msg) => msg.timestamp > oneDayAgo);
  // Count quality messages
  const qualityMessages = recentMessages.filter(
    (msg) => msg.qualityScore > MESSAGE_CONFIG.SPAM_THRESHOLD
  );
  // Calculate percentage of quality messages
  const qualityPercentage =
    recentMessages.length > 0 ? (qualityMessages.length / recentMessages.length) * 100 : 0;
  console.log(
    `Guild ${guildId} quality evaluation: ${qualityMessages.length}/${recentMessages.length} quality messages (${qualityPercentage.toFixed(1)}%)`
  );
  // If less than 50% of messages are quality, apply a penalty to the overall quality score
  if (recentMessages.length > 10 && qualityPercentage < 50) {
    stats.qualityScore = Math.max(30, stats.qualityScore * 0.9);
    console.log(
      `Applied quality penalty to guild ${guildId}, new score: ${stats.qualityScore.toFixed(1)}`
    );
  }
  // If more than 80% of messages are quality, apply a bonus
  if (recentMessages.length > 10 && qualityPercentage > 80) {
    stats.qualityScore = Math.min(100, stats.qualityScore * 1.1);
    console.log(
      `Applied quality bonus to guild ${guildId}, new score: ${stats.qualityScore.toFixed(1)}`
    );
  }
  // Update API with latest stats
  notifyPortalAPI(guildId, 'stats_update').catch(console.error);
}

async function checkGuildLevelRequirements(guildId: string): Promise<void> {
  try {
    // Get guild stats from database via API
    const response = await axios.post(`${PORTAL_API_URL}/api/discord/check-level-requirements`, {
      guildId: guildId,
      apiKey: API_KEY,
      source: 'discord_bot',
      event: 'metrics_updated',
    });
    if (response.data?.levelUp) {
      console.log(
        `[Discord Bot] Level-up triggered for guild ${guildId} from level ${response.data.previousLevel} to ${response.data.newLevel}`
      );
    }
  } catch (error) {
    console.error('[Discord Bot] Error checking level requirements:', error);
  }
}

/**
 * Initializes and logs in the Discord bot client, sets up all event handlers, and returns the client instance.
 * This function should be called from the main entry point to start the bot.
 */
async function initDiscordBot(): Promise<Client> {
  // Attach all event handlers (already set up above)
  // Log in the client
  if (!DISCORD_BOT_TOKEN) {
    throw new Error('DISCORD_BOT_TOKEN is not set in environment variables');
  }
  await client.login(DISCORD_BOT_TOKEN);
  console.log('[Discord Bot] Client login initiated');
  return client;
}

export { initDiscordBot };

async function assignContributorRole(
  client: Client,
  guildId: string,
  userId: string,
  contributorType: string
): Promise<boolean> {
  console.log(`[ROLE_ASSIGN] Attempting to assign role for UserID: ${userId}, GuildID: ${guildId}, Type: ${contributorType}`);
  if (!guildId) {
    console.error('[ROLE_ASSIGN] Guild ID is undefined. Cannot assign role.');
    return false;
  }

  try {
    const guild = await client.guilds.fetch(guildId);
    if (!guild) {
      console.error(`[ROLE_ASSIGN] Guild ${guildId} not found.`);
      return false;
    }

    const member = await guild.members.fetch(userId);
    if (!member) {
      console.error(`[ROLE_ASSIGN] Member ${userId} not found in guild ${guildId}.`);
      return false;
    }

    const roleNameMap: { [key: string]: string } = {
      scientist: 'Scientist',
      developer: 'Developer',
      community: 'Community Builder',
      web3_enthusiast: 'Web3 Enthusiast',
    };

    const targetRoleName = roleNameMap[contributorType.toLowerCase()];
    if (!targetRoleName) {
      console.warn(`[ROLE_ASSIGN] No role defined for contributor type: ${contributorType}`);
      return false;
    }

    let role = guild.roles.cache.find(r => r.name === targetRoleName);
    if (!role) {
      console.log(`[ROLE_ASSIGN] Role "${targetRoleName}" not found in guild ${guild.name}. Attempting to create it.`);
      try {
        role = await guild.roles.create({
          name: targetRoleName,
          reason: `Auto-created role for BioDAO contributor type: ${contributorType}`,
          //permissions: [], // Optional: define default permissions for the new role
          //color: 'DEFAULT', // Optional: define a color
        });
        console.log(`[ROLE_ASSIGN] Successfully created role "${targetRoleName}" in guild ${guild.name}.`);
        // Send a DM to the user that the role was created, if possible and desired.
        // This might be better handled in the calling function `processDMResponse`
        // as it has direct access to the `message` object for replying.
      } catch (creationError: any) {
        console.error(`[ROLE_ASSIGN] Failed to create role "${targetRoleName}" in guild ${guild.name}:`, creationError);
        if (creationError && creationError.code === 50013) { // DiscordAPIError: Missing Permissions
          console.error(`[ROLE_ASSIGN] Bot is missing "Manage Roles" permission in guild ${guild.name} to create the role.`);
        }
        return false;
      }
    }

    if (member.roles.cache.has(role.id)) {
      console.log(`[ROLE_ASSIGN] Member ${member.user.tag} already has the "${targetRoleName}" role.`);
      return true;
    }

    await member.roles.add(role);
    console.log(`[ROLE_ASSIGN] Successfully assigned role "${targetRoleName}" to ${member.user.tag} in ${guild.name}.`);
    return true;
  } catch (error: any) {
    console.error(`[ROLE_ASSIGN] Failed to assign role for ${userId} in guild ${guildId}:`, error);
    if (error && error.code === 50013) { // DiscordAPIError: Missing Permissions
        console.error(`[ROLE_ASSIGN] Bot is missing "Manage Roles" permission in guild ${guildId} to assign the role.`);
    }
    return false;
  }
}

// Handle slash command interactions
client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  const { commandName } = interaction;
  console.log(`[SLASH] Processing command: ${commandName}`);

  try {
    // Handle different commands
    switch (commandName) {
      case 'summarize':
        await handleSummarizeCommand(interaction);
        break;
      case 'upload':
        await handleUploadCommand(interaction);
        break;
      case 'ask':
        await handleAskCommand(interaction);
        break;
      default:
        await interaction.reply({ content: 'Unknown command', ephemeral: true });
    }
  } catch (error) {
    console.error(`[SLASH] Error handling command ${commandName}:`, error);
    // Try to respond to the user if we haven't already
    if (interaction.deferred || interaction.replied) {
      await interaction.followUp({ 
        content: 'There was an error processing your command.', 
        ephemeral: true 
      }).catch(console.error);
    } else {
      await interaction.reply({ 
        content: 'There was an error processing your command.', 
        ephemeral: true 
      }).catch(console.error);
    }
  }
});

async function handleSummarizeCommand(interaction: ChatInputCommandInteraction) {
  // Add comprehensive logging
  console.log(`[Summarize] Handling interaction for user ${interaction.user.id} in guild ${interaction.guildId}`);
  
  try {
    const file = interaction.options.getAttachment('file');

    // Log the received file object for debugging
    console.log('[Summarize] Received file attachment object:', JSON.stringify(file, null, 2)); // Added log

    // Robust check for PDF
    let isPdf = false;
    if (file && file.url) {
      const urlLower = file.url.toLowerCase(); // Convert to lowercase
      const urlParts = urlLower.split('?');   // Remove query parameters if they exist
      if (urlParts[0].endsWith('.pdf')) {      // Check the part before '?'
        isPdf = true;
      }
    }

    // Check the result of the robust check
    if (!isPdf) {
      // Log the URL that failed the check
      console.log(`[Summarize] Invalid file provided. URL check failed for: ${file?.url}`);
      // Reply immediately for invalid file
      await interaction.reply({ content: 'Please upload a valid PDF file.', ephemeral: true });
      return; // Stop execution
    }

    // If we reach here, the file is considered a valid PDF

    // Defer the reply immediately - IMPORTANT!
    console.log('[Summarize] Deferring reply...');
    await interaction.deferReply(); // Use deferReply here
    console.log('[Summarize] Reply deferred. Processing PDF...');

    // Import node-fetch properly using dynamic import
    // Use a simpler implementation that avoids type issues
    const nodeFetch = await import('node-fetch').then(module => module.default);

    // Download the PDF
    console.log(`[Summarize] Fetching PDF from: ${file?.url}`);
    const response = await nodeFetch(file?.url || '');
    if (!response.ok) {
        throw new Error(`Failed to fetch PDF: ${response.statusText}`);
    }
    const buffer = await response.arrayBuffer();
    console.log(`[Summarize] PDF downloaded (${buffer.byteLength} bytes). Parsing...`);
    const data = await pdfParse(Buffer.from(buffer));
    console.log('[Summarize] PDF parsed.');

    // Truncate if too long for LLM
    let text = data.text;
    const MAX_TEXT_LENGTH = 2000;
    if (text.length > MAX_TEXT_LENGTH) {
      console.log(`[Summarize] Text truncated from ${text.length} to ${MAX_TEXT_LENGTH} chars.`);
      text = text.slice(0, MAX_TEXT_LENGTH);
    }

    // Summarize with OpenAI
    console.log('[Summarize] Calling OpenAI API...');
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const completion = await openai.chat.completions.create({
      model: 'gpt-4', // Consider a faster model if needed (e.g., 'gpt-3.5-turbo')
      messages: [
        { role: 'system', content: 'You are a scientific research assistant. Summarize the following scientific paper and provide key insights, main findings, and any notable limitations or future directions. Make sure to keep it short 2000 characters and concise.' },
        { role: 'user', content: text }
      ],
      max_tokens: 500,
      temperature: 0.3,
    });
    console.log('[Summarize] OpenAI API call completed.');

    const summary = completion.choices[0]?.message?.content;
    if (!summary) {
        throw new Error('OpenAI response did not contain a summary.');
    }

    console.log('[Summarize] Sending final summary via editReply...');
    await interaction.editReply({ // Use editReply here
      content: `**Summary & Insights:**\n${summary}`,
    });
    console.log('[Summarize] Summary sent successfully.');

  } catch (err) {
    console.error('[Summarize] Error processing command:', err);
    // Use editReply because we deferred earlier
    try {
        // Check if we already replied or deferred before trying to edit
        if (interaction.replied || interaction.deferred) {
            await interaction.editReply('Sorry, an error occurred while processing the PDF.'); // Use editReply here
        } else {
             // Fallback if deferral failed somehow (unlikely but safe)
            await interaction.reply({ content: 'Sorry, an error occurred before processing could start.', ephemeral: true });
        }
    } catch (replyError) {
        console.error('[Summarize] Failed to send error reply:', replyError);
        // Cannot recover the interaction if sending the error message fails
    }
  }
}

async function handleUploadCommand(interaction: ChatInputCommandInteraction) {
  console.log(`[Upload] Handling interaction ID: ${interaction.id} for user ${interaction.user.id}`);

  try {
    console.log(`[Upload] Attempting deferReply for interaction ID: ${interaction.id}`);
    await interaction.deferReply({ ephemeral: true }); // Defer ephemerally initially
    console.log(`[Upload] deferReply SUCCESSFUL for interaction ID: ${interaction.id}`);

    const file = interaction.options.getAttachment('file');
    console.log('[Upload] Received file attachment object:', JSON.stringify(file, null, 2));

    // Robust check for PDF
    let isPdf = false;
    let filename = 'document'; // Default filename
    if (file && file.url) {
      filename = file.name || filename;
      const urlLower = file.url.toLowerCase();
      const urlParts = urlLower.split('?');
      if (urlParts[0].endsWith('.pdf')) {
        isPdf = true;
      }
    }

    if (!isPdf) {
      console.log(`[Upload] Invalid file provided. URL check failed for: ${file?.url}`);
      console.log(`[Upload] Attempting editReply (invalid file) for interaction ID: ${interaction.id}`);
      await interaction.editReply({ content: 'Please upload a valid PDF file.' });
      console.log(`[Upload] editReply (invalid file) SUCCESSFUL for interaction ID: ${interaction.id}`);
      return;
    }
    const validFile = file!; // Non-null assertion

    console.log(`[Upload] Processing ${filename}... Fetching from: ${validFile.url}`);
    console.log(`[Upload] Attempting editReply (processing status) for interaction ID: ${interaction.id}`);
    await interaction.editReply(`⏳ Processing ${filename}...`); // Update user
    console.log(`[Upload] editReply (processing status) SUCCESSFUL for interaction ID: ${interaction.id}`);

    // Download & Parse
    // Import node-fetch properly
    const nodeFetch = await import('node-fetch').then(module => module.default);
    const response = await nodeFetch(validFile.url);
    if (!response.ok) throw new Error(`Failed to fetch PDF: ${response.statusText}`);
    const buffer = await response.arrayBuffer();
    const data = await pdfParse(Buffer.from(buffer));
    const extractedText = data.text;
    console.log(`[Upload] PDF ${filename} parsed (${extractedText.length} chars). Caching for user ${interaction.user.id}`);

    // Store in cache (overwrites previous for this user)
    pdfTextCache.set(interaction.user.id, { text: extractedText, filename: filename });

    // Confirm success
    console.log(`[Upload] Attempting editReply (success) for interaction ID: ${interaction.id}`);
    await interaction.editReply(`✅ \`${filename}\` processed! You can now use \`/ask question: [your question]\` to ask about this document.`);
    console.log(`[Upload] editReply (success) SUCCESSFUL for interaction ID: ${interaction.id}`);

  } catch (err) {
    console.error(`[Upload] Error processing command for interaction ID: ${interaction.id}:`, err);
    // Try to edit the reply, fallback to a new ephemeral reply if needed
    try {
      console.log(`[Upload] In CATCH block for interaction ID: ${interaction.id}. Checking if replied/deferred: ${interaction.replied || interaction.deferred}`);
      if (interaction.replied || interaction.deferred) {
        console.log(`[Upload] Attempting editReply (error) for interaction ID: ${interaction.id}`);
        // Just try editing, catch if it fails
        await interaction.editReply('Sorry, an error occurred while processing the PDF.');
        console.log(`[Upload] editReply (error) SUCCESSFUL for interaction ID: ${interaction.id}`);
      } else {
        // If we couldn't even defer/reply initially, send a new reply
        console.log(`[Upload] Interaction ${interaction.id} was not replied/deferred. Attempting reply (error).`);
        await interaction.reply({ content: 'Sorry, an error occurred.', ephemeral: true });
        console.log(`[Upload] reply (error) SUCCESSFUL for interaction ID: ${interaction.id}`);
      }
    } catch (replyError) {
      // If even sending the error fails, log it
      console.error(`[Upload] Failed to send error reply for interaction ID: ${interaction.id}:`, replyError);
    }
  }
}

async function handleAskCommand(interaction: ChatInputCommandInteraction) {
  console.log(`[Ask] Handling interaction ID: ${interaction.id} for user ${interaction.user.id}`);
  const question = interaction.options.getString('question', true);

  try {
    // Try to defer the reply FIRST
    console.log(`[Ask] Attempting deferReply for interaction ID: ${interaction.id}`);
    await interaction.deferReply();
    console.log(`[Ask] deferReply SUCCESSFUL for interaction ID: ${interaction.id}`);

    // --- Main Logic ---
    const cachedData = pdfTextCache.get(interaction.user.id);

    if (!cachedData) {
      console.log(`[Ask] No cached PDF found for user ${interaction.user.id}`);
      console.log(`[Ask] Attempting editReply (no cache) for interaction ID: ${interaction.id}`);
      await interaction.editReply('No PDF found for you. Please use `/upload` first.');
      console.log(`[Ask] editReply (no cache) SUCCESSFUL for interaction ID: ${interaction.id}`);
      return; // Stop processing
    }

    const { text: pdfText, filename } = cachedData;
    console.log(`[Ask] Found cached PDF: ${filename}. Asking question: "${question}"`);
    console.log(`[Ask] Attempting editReply (asking status) for interaction ID: ${interaction.id}`);
    await interaction.editReply(`🤔 Asking question about \`${filename}\`...`);
    console.log(`[Ask] editReply (asking status) SUCCESSFUL for interaction ID: ${interaction.id}`);

    // Prepare prompt for LLM
    const MAX_CONTEXT_LENGTH = 6000; // Adjust as needed
    const context = pdfText.length > MAX_CONTEXT_LENGTH
      ? pdfText.slice(0, MAX_CONTEXT_LENGTH) + "\n... (context truncated)"
      : pdfText;

    // Call OpenAI
    console.log('[Ask] Calling OpenAI API...');
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const completion = await openai.chat.completions.create({
      model: 'gpt-4', // Or a faster/cheaper model like gpt-3.5-turbo
      messages: [
        { role: 'system', content: `You are a helpful assistant answering questions based ONLY on the provided text from a document named '${filename}'. If the answer is not found in the text, say "The answer is not found in the provided document text."` },
        { role: 'user', content: `Document Text:\n---\n${context}\n---\n\nQuestion: ${question}` }
      ],
      max_tokens: 300, // Limit answer length
      temperature: 0.2,
    });
    console.log('[Ask] OpenAI API call completed.');

    let answer = completion.choices[0]?.message?.content?.trim();
    if (!answer) {
      // If OpenAI gives no content, use a default message
      answer = "Sorry, I couldn't generate an answer based on the document.";
      console.warn('[Ask] OpenAI response did not contain answer content.');
    }

    // Truncate answer if needed for Discord limit
    const DISCORD_MAX_LENGTH = 2000;
    if (answer.length > DISCORD_MAX_LENGTH) {
      console.log(`[Ask] Answer length (${answer.length}) exceeds Discord limit. Truncating.`);
      answer = answer.slice(0, DISCORD_MAX_LENGTH - 20) + '... (answer truncated)';
    }

    console.log(`[Ask] Attempting final editReply (answer) for interaction ID: ${interaction.id}`);
    // Edit the deferred reply with the final answer
    await interaction.editReply(answer);
    console.log(`[Ask] Final editReply (answer) SUCCESSFUL for interaction ID: ${interaction.id}`);
    // --- End Main Logic ---

  } catch (err) {
    console.error(`[Ask] Error processing command for interaction ID: ${interaction.id}:`, err);
    // Attempt to inform the user about the error
    try {
      console.log(`[Ask] In CATCH block for interaction ID: ${interaction.id}. Checking if replied/deferred: ${interaction.replied || interaction.deferred}`);
      if (interaction.replied || interaction.deferred) {
        // If we already replied/deferred, try editing the message
        console.log(`[Ask] Attempting editReply (error) for interaction ID: ${interaction.id}`);
        // Just try editing, catch if it fails
        await interaction.editReply('Sorry, an error occurred while getting the answer.');
        console.log(`[Ask] editReply (error) SUCCESSFUL for interaction ID: ${interaction.id}`);
      } else {
        // If we couldn't even defer/reply initially, send a new reply
        console.log(`[Ask] Interaction ${interaction.id} was not replied/deferred. Attempting reply (error).`);
        await interaction.reply({ content: 'Sorry, an error occurred processing your request.', ephemeral: true });
        console.log(`[Ask] reply (error) SUCCESSFUL for interaction ID: ${interaction.id}`);
      }
    } catch (replyError) {
      // If even sending the error fails, log it
      console.error(`[Ask] Failed to send error reply for interaction ID: ${interaction.id}:`, replyError);
    }
  }
}

export { client };