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

// Initialize Discord client with necessary intents
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.MessageContent,
  ],
});

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
 * Initialize stats tracking for a guild
 */
async function initializeGuildStats(guild: Guild): Promise<void> {
  console.log(`Initializing stats for guild: ${guild.name} (${guild.id})`);
  // Fetch from DB
  const discordRecord = await prisma.discord.findFirst({ where: { serverId: guild.id } });
  const dbMessages = discordRecord?.messagesCount || 0;
  const dbPapers = discordRecord?.papersShared || 0;
  const dbQuality = discordRecord?.qualityScore || 50;

  guildStats.set(guild.id, {
    messageCount: dbMessages,
    papersShared: dbPapers,
    qualityScore: dbQuality,
    lastMessageTimestamp: new Date(),
    activeUsers: new Set<string>(),
  });

  guildMessageHistory.set(guild.id, []);
  notifyPortalAPI(guild.id, 'stats_update');
  setInterval(() => {
    evaluateMessageQuality(guild.id);
  }, MESSAGE_CONFIG.QUALITY_CHECK_INTERVAL_MS);
  // Set in-memory for compatibility, but never use as source of truth
  messageCountByGuild[guild.id] = dbMessages;
  papersSharedByGuild[guild.id] = dbPapers;
  qualityScoreByGuild[guild.id] = dbQuality;
}

// Track papers shared by looking for links/attachments
const papersSharedByGuild: Record<string, number> = {};

// Track message count by guild
const messageCountByGuild: Record<string, number> = {};

// Simple quality score calculation
const qualityScoreByGuild: Record<string, number> = {};

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
  console.log(`New member joined ${guild.name}: ${member.user.username}`);

  // Update member count immediately when someone joins
  await notifyPortalAPI(guild.id, 'stats_update');

  // Check level requirements when specific member count thresholds are hit
  const memberCount = guild.memberCount;
  if (memberCount === 4 || memberCount === 10 || memberCount % 5 === 0) {
    console.log(
      `[Discord Bot] Member milestone reached (${memberCount}) - checking level requirements`
    );
    await checkGuildLevelRequirements(guild.id);
  }
});

/**
 * Determine if a message is too simple to count as a meaningful contribution
 * This filters out basic greetings, single-word replies, and other low-value messages
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

// Listen for messages to track activity
client.on(Events.MessageCreate, async (message) => {
  // Ignore messages from bots
  if (message.author.bot) return;

  // Check if this is in a guild (not a DM)
  if (!message.guild) return;

  const guildId = message.guild.id;

  // --- DEDUPLICATION: Only process each message.id once per guild ---
  if (!processedMessageIdsByGuild[guildId]) {
    processedMessageIdsByGuild[guildId] = new Set();
  }
  if (processedMessageIdsByGuild[guildId].has(message.id)) {
    // Already processed this message, skip
    return;
  }
  processedMessageIdsByGuild[guildId].add(message.id);

  // Check if this is a low-value message that shouldn't count toward stats
  const isSpam = isLowValueMessage(message.content);

  // --- PDF LINK DETECTION ---
  // Detect if the message contains a direct link to a PDF (e.g., https://.../paper.pdf)
  const pdfUrlRegex = /https?:\/\/[^\s]+\.pdf(\?[^\s]*)?/i;
  const hasPdfLink = pdfUrlRegex.test(message.content);

  // Use the stricter paper detection logic from paper-detection.ts
  const hasAttachment = message.attachments.size > 0;
  let isPaper = false;
  if (hasAttachment) {
    for (const [, attachment] of message.attachments) {
      const filename = attachment.name?.toLowerCase() || '';
      if (filename.endsWith('.pdf')) {
        const paperAnalysis = analyzeScientificPdf(attachment.name || '', attachment.size);
        const isArxivPattern = attachment.name?.match(/^[0-9]{4}\.[0-9]{4,5}\.pdf$/i);
        if (isArxivPattern || paperAnalysis.isScientificPaper) {
          isPaper = true;
          try {
            await message.react('📚');
          } catch (error) {}
          break; // Stop after first detected paper
        }
      }
    }
  }
  // Only run text-based detection if no PDF-based paper was found
  if (!isPaper) {
    // If there's a PDF link, count as paper
    if (hasPdfLink) {
      isPaper = true;
      try {
        await message.react('📚');
      } catch (error) {}
    } else {
      isPaper = detectPaper(message.content, hasAttachment);
    }
  }

  // --- Paper counting block ---
  if (isPaper) {
    // Only increment papersShared, not messagesCount
    try {
      const discordRecord = await prisma.discord.findFirst({ where: { serverId: guildId } });
      if (discordRecord) {
        const updatedRecord = await prisma.discord.update({
          where: { id: discordRecord.id },
          data: {
            papersShared: discordRecord.papersShared + 1,
            updatedAt: new Date(),
          },
        });
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
            project.Discord?.memberCount &&
            project.Discord?.papersShared >= 5 &&
            project.Discord?.messagesCount >= 50
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
            }
            if (project.email) {
              await sendLevelUpEmail(project.email, 4);
              await sendSandboxEmail(project);
            }
          }
        }
      }
    } catch (error) {
      console.error(`[Paper Detection] Error updating papers count or checking level-up:`, error);
    }
    // Do NOT increment messagesCount for paper messages
    return;
  }

  // --- Message counting block ---
  // Only increment messagesCount if not spam, and not a paper message
  if (!isSpam) {
    try {
      const discordRecord = await prisma.discord.findFirst({ where: { serverId: guildId } });
      if (discordRecord) {
        const updatedRecord = await prisma.discord.update({
          where: { id: discordRecord.id },
          data: {
            messagesCount: discordRecord.messagesCount + 1,
            papersShared: discordRecord.papersShared, // don't update here
            qualityScore: qualityScoreByGuild[guildId],
            updatedAt: new Date(),
          },
        });
        messageCountByGuild[guildId] = updatedRecord.messagesCount;
        papersSharedByGuild[guildId] = updatedRecord.papersShared;

        // Log update
        console.log(
          `[Discord] Real-time update: message #${updatedRecord.messagesCount} recorded for ${message.guild.name}`
        );

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
            updatedRecord.messagesCount === 10 ||
            updatedRecord.messagesCount === 20 ||
            updatedRecord.messagesCount === 30 ||
            updatedRecord.messagesCount === 40 ||
            updatedRecord.messagesCount === 50 ||
            (updatedRecord.messagesCount >= 50 && updatedRecord.messagesCount % 25 === 0)
          ) {
            console.log(
              `[Discord] Message count milestone reached: ${updatedRecord.messagesCount} - checking for level-up`
            );

            // Level 3 to 4 transition depends heavily on message count
            if (
              project.level === 3 &&
              updatedRecord.memberCount &&
              updatedRecord.memberCount >= 5 &&
              updatedRecord.papersShared >= 5 &&
              updatedRecord.messagesCount >= 50
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
              }
            }
          }

          // Always check user level on message updates
          await checkAndUpdateUserLevel(project);
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
});

// Replace the handleBotCommand function with a stub that does nothing but logs
async function handleBotCommand(message: Message): Promise<void> {
  console.log(`Command handling disabled: ${message.content}`);
  // We no longer respond to commands
  return;
}

/**
 * Send help information about available commands
 */
async function sendHelpMessage(message: Message): Promise<void> {
  // Command responses disabled
  console.log(`Help command disabled for: ${message.content}`);
  return;
}

/**
 * Send current community stats
 */
async function sendStatsMessage(message: Message, stats: any, guildId: string): Promise<void> {
  // Command responses disabled
  console.log(`Stats command disabled for: ${message.content}`);
  return;
}

/**
 * Explain how message quality is measured
 */
async function sendQualityInfoMessage(message: Message): Promise<void> {
  // Command responses disabled
  console.log(`Quality info command disabled for: ${message.content}`);
  return;
}

/**
 * Provide tips for sharing papers
 */
async function sendPaperSharingTips(message: Message): Promise<void> {
  // Command responses disabled
  console.log(`Paper sharing tips command disabled for: ${message.content}`);
  return;
}

/**
 * Provide community engagement tips
 */
async function sendCommunityTips(message: Message): Promise<void> {
  // Command responses disabled
  console.log(`Community tips command disabled for: ${message.content}`);
  return;
}

/**
 * Send information about progress toward the next level
 */
async function sendProgressInfo(message: Message, stats: any, guildId: string): Promise<void> {
  // Command responses disabled
  console.log(`Progress info command disabled for: ${message.content}`);
  return;
}

/**
 * Fetches Discord information from the Portal API
 * @param guildId The guild ID to fetch info for, or 'all' to fetch all records
 * @returns Discord information or null if not found
 */
async function fetchDiscordInfoFromAPI(guildId: string): Promise<any> {
  try {
    // Different endpoint for fetching all Discord records
    const endpoint =
      guildId === 'all'
        ? `${PORTAL_API_URL}/api/discord/all-records`
        : `${PORTAL_API_URL}/api/discord/info/${guildId}`;

    const response = await axios.get(endpoint, {
      headers: {
        Authorization: `Bearer ${API_KEY}`,
      },
    });

    return response.data;
  } catch (error) {
    console.error(
      `Error fetching Discord info for ${guildId === 'all' ? 'all guilds' : `guild ${guildId}`}:`,
      error
    );
    return null;
  }
}

/**
 * Updates the message frequency tracking for a user to detect spam behavior
 * @param userId The user ID to update frequency for
 */
function updateUserMessageFrequency(userId: string): void {
  const userFrequency = userMessageFrequency.get(userId);
  if (!userFrequency) return;

  const now = new Date();

  // Add current message timestamp
  userFrequency.lastMessages.push(now);

  // Remove messages older than cooldown period
  userFrequency.lastMessages = userFrequency.lastMessages.filter(
    (time) => now.getTime() - time.getTime() < MESSAGE_CONFIG.COOLDOWN_PERIOD_MS
  );

  // Check if user is sending too many messages too quickly
  if (userFrequency.lastMessages.length > MESSAGE_CONFIG.MAX_FREQUENCY_PER_USER) {
    // Apply penalty to user's message quality
    userFrequency.penaltyFactor = 0.5; // 50% quality reduction for spamming
    console.log(`Spam behavior detected from user ${userId} - applying quality penalty`);
  } else {
    // Gradually restore penalty factor if user stops spamming
    userFrequency.penaltyFactor = Math.min(1.0, userFrequency.penaltyFactor + 0.1);
  }
}

/**
 * Calculate message similarity penalty
 */
function calculateMessageSimilarityPenalty(
  content: string,
  messageHistory: MessageHistoryItem[],
  userId: string
): number {
  // Get the last 5 messages from the user
  const userRecentMessages = messageHistory.filter((item) => item.userId === userId).slice(-5);

  // Calculate similarity between the new message and the recent messages
  for (const prevMessage of userRecentMessages) {
    const similarity = calculateStringSimilarity(prevMessage.content, content);
    if (similarity > MESSAGE_CONFIG.SIMILAR_MESSAGE_THRESHOLD) {
      return 0.3; // 70% penalty for very similar message
    }
  }

  return 1.0; // Default penalty if no similar message found
}

/**
 * Calculate message quality score (0-100)
 */
function calculateMessageQuality(content: string): number {
  let score = 0;

  // Base score on length (up to 40 points)
  const length = content.length;
  score += Math.min(40, length / 5);

  // Add points for formatting that indicates thoughtful content
  if (content.includes('```')) score += 10; // Code blocks
  if (content.match(/\*\*.*\*\*/)) score += 5; // Bold text
  if (content.match(/\[.*\]\(.*\)/)) score += 10; // Links with proper formatting
  if (content.includes('\n\n')) score += 5; // Multiple paragraphs
  if (content.match(/\d+\./)) score += 10; // Numbered lists
  if (content.match(/^>.*$/m)) score += 10; // Quotes

  // Cap at 100
  return Math.min(100, score);
}

/**
 * Calculate similarity between two strings (0-1 scale)
 * Uses Dice's coefficient for efficient string comparison
 */
function calculateStringSimilarity(str1: string, str2: string): number {
  // For very short messages, do exact matching
  if (str1.length < 10 && str2.length < 10) {
    return str1.toLowerCase() === str2.toLowerCase() ? 1.0 : 0.0;
  }

  // Normalize and clean strings
  const s1 = str1.toLowerCase().trim();
  const s2 = str2.toLowerCase().trim();

  if (s1 === s2) return 1.0;
  if (s1.length < 2 || s2.length < 2) return 0.0;

  // Create bigrams
  const createBigrams = (str: string): Set<string> => {
    const bigrams = new Set<string>();
    for (let i = 0; i < str.length - 1; i++) {
      bigrams.add(str.substring(i, i + 2));
    }
    return bigrams;
  };

  const bigrams1 = createBigrams(s1);
  const bigrams2 = createBigrams(s2);

  // Count intersection
  let intersection = 0;
  for (const bigram of bigrams1) {
    if (bigrams2.has(bigram)) {
      intersection++;
    }
  }

  // Calculate Dice's coefficient
  return (2 * intersection) / (bigrams1.size + bigrams2.size);
}

/**
 * Evaluate message quality across the guild and update statistics
 */
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

/**
 * Notifies the Portal API about guild events (creation or stats updates)
 */
async function notifyPortalAPI(
  guildId: string,
  eventType: 'guildCreate' | 'stats_update'
): Promise<void> {
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
    await axios.post(`${PORTAL_API_URL}${endpoint}`, payload);
  } catch (error) {
    console.error(`Failed to notify Portal API for guild ${guildId}:`, error);
  }
}

/**
 * Update stats for all guilds
 */
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

// Test function to validate PDF analysis for arXiv-style filenames
function testPdfAnalysis() {
  console.log('============ PDF ANALYSIS TEST CASES ============');

  // Test arXiv-style papers
  const testCases = [
    '2504.11091.pdf',
    'arXiv_2201.09876.pdf',
    '1903.07933.pdf',
    'smith_2022_quantum_algorithm.pdf',
    '10.1038_s41586-021-03819-2.pdf',
  ];

  for (const testFile of testCases) {
    const result = analyzeScientificPdf(testFile, 1.5 * 1024 * 1024); // Assume 1.5MB size
    console.log(
      `PDF Analysis for "${testFile}": confidence=${result.confidence}, isScientificPaper=${result.isScientificPaper}`
    );
    console.log(`- Reason: ${result.reason}`);
  }

  console.log('=================================================');
}

// Run the test on startup
testPdfAnalysis();

// Start the bot
client.login(DISCORD_BOT_TOKEN).catch((err) => {
  console.error('Failed to login to Discord:', err);
  process.exit(1);
});

// Handle process termination
process.on('SIGINT', async () => {
  console.log('Bot shutting down, updating final stats...');
  await updateAllGuildStats();
  client.destroy();
  process.exit(0);
});

// Function to update server stats directly in the database
async function updateDiscordStats(guildId: string) {
  const guild = client.guilds.cache.get(guildId);
  if (!guild) {
    console.warn(`Cannot update stats: Guild ${guildId} not found in cache`);
    return;
  }

  try {
    // Always fetch the latest from the database
    const discordRecord = await prisma.discord.findFirst({ where: { serverId: guildId } });
    if (!discordRecord) {
      console.warn(
        `[Discord Stats] Could not find Discord record for server ID: ${guildId}. Stats will not be saved.`
      );
      return;
    }

    // Use DB values as source of truth
    const updatedMessageCount = discordRecord.messagesCount;
    const updatedPapersShared = discordRecord.papersShared;
    const updatedQualityScore = discordRecord.qualityScore;

    // Update stats directly (no change, just to keep updatedAt fresh)
    const updatedRecord = await prisma.discord.update({
      where: { id: discordRecord.id },
      data: {
        memberCount: guild.memberCount,
        papersShared: updatedPapersShared,
        messagesCount: updatedMessageCount,
        qualityScore: updatedQualityScore,
        updatedAt: new Date(),
      },
    });

    // Update in-memory counters for compatibility, but never use as source of truth
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
    console.error(`[Discord Stats] Failed to update stats in database for ${guild?.name}:`, error);
    throw error;
  }
}

/**
 * Checks if a guild's metrics meet level-up requirements and triggers level advancement
 * This is called after significant events like paper detection or message threshold reached
 */
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

// Function to initialize the Discord bot
export function initDiscordBot() {
  console.log('Discord bot initialization requested');

  // Initialize event listeners if not already set up
  if (!client.isReady()) {
    // Set up event handlers
    client.once(Events.ClientReady, () => {
      console.log(`[Discord Bot] Logged in as ${client.user?.tag}`);
      console.log(`[Discord Bot] Serving ${client.guilds.cache.size} guilds`);

      // Initialize stats for all guilds from database
      initializeAllGuildsFromDatabase();

      // Start periodic updates
      setInterval(
        () => {
          updateAllGuildStats();
        },
        5 * 60 * 1000
      ); // Update every 5 minutes
    });

    // Handle guild creation (bot added to new server)
    client.on(Events.GuildCreate, async (guild) => {
      console.log(`[Discord Bot] Added to guild: ${guild.name} (${guild.id})`);

      // Initialize stats for this guild
      initializeGuildStats(guild);

      try {
        // Import dynamically to avoid circular dependencies
        const wsService = await import('./websocket/ws.service');
        console.log(
          `[Discord Bot] Successfully imported ws.service, calling handleGuildCreate for guild ${guild.id}`
        );

        // Use the ws.service handler to process the event and notify users
        await wsService.handleGuildCreate(guild.id, guild.name, guild.memberCount);
        console.log(`[Discord Bot] handleGuildCreate completed for guild ${guild.id}`);
      } catch (error) {
        console.error('[Discord Bot] Error calling handleGuildCreate:', error);
        // Even if there's an error with the WebSocket service, still try to notify the Portal API
      }

      try {
        // Also notify the Portal API about this new guild
        console.log(`[Discord Bot] Notifying Portal API about new guild ${guild.id}`);
        await notifyPortalAPI(guild.id, 'guildCreate');
        console.log(`[Discord Bot] Portal API notification completed for guild ${guild.id}`);
      } catch (apiError) {
        console.error('[Discord Bot] Error notifying Portal API:', apiError);
      }
    });

    // Track when members join
    client.on(Events.GuildMemberAdd, async (member) => {
      const guild = member.guild;
      console.log(`New member joined ${guild.name}: ${member.user.username}`);

      // Update member count immediately when someone joins
      await notifyPortalAPI(guild.id, 'stats_update');

      // Check level requirements when specific member count thresholds are hit
      const memberCount = guild.memberCount;
      if (memberCount === 4 || memberCount === 10 || memberCount % 5 === 0) {
        console.log(
          `[Discord Bot] Member milestone reached (${memberCount}) - checking level requirements`
        );
        await checkGuildLevelRequirements(guild.id);
      }
    });

    // --- Add InteractionCreate Listener Here ---
    client.on(Events.InteractionCreate, async (interaction) => {
      console.log(`[InteractionCreate] Event received. Type: ${interaction.type}. Is command: ${interaction.isCommand()}.`);
      if (!interaction.isCommand()) {
          console.log(`[InteractionCreate] Interaction was not a command (Type: ${interaction.type}). Ignoring.`);
          // Handle other interaction types if necessary (e.g., buttons, modals)
          return;
      }
      console.log(`[InteractionCreate] Handling command: ${interaction.commandName} (ID: ${interaction.id})`);

      switch (interaction.commandName) {
        case 'summarize':
          // Add type check for safety
          if (interaction.isChatInputCommand()) {
            console.log(`[InteractionCreate] Routing to handleSummarizeCommand for interaction ID: ${interaction.id}`);
            await handleSummarizeCommand(interaction);
          } else {
             console.warn(`[InteractionCreate] Received summarize interaction, but it wasn't ChatInputCommand. Type: ${interaction.type}`);
             // Optionally reply with an error if this shouldn't happen
             if (!interaction.replied && !interaction.deferred) {
                try {
                   await interaction.reply({ content: "Error: Received wrong interaction type.", ephemeral: true });
                } catch (e) { console.error("Failed to reply to wrong interaction type:", e); }
             }
          }
          break;

        // Add this case for /upload
        case 'upload':
          if (interaction.isChatInputCommand()) {
            console.log(`[InteractionCreate] Routing to handleUploadCommand for interaction ID: ${interaction.id}`);
            await handleUploadCommand(interaction);
          } else {
             console.warn(`[InteractionCreate] Received upload interaction, but it wasn't ChatInputCommand. Type: ${interaction.type}`);
          }
          break;

        // Add this case for /ask
        case 'ask':
          if (interaction.isChatInputCommand()) {
            console.log(`[InteractionCreate] Routing to handleAskCommand for interaction ID: ${interaction.id}`);
            await handleAskCommand(interaction);
          } else {
             console.warn(`[InteractionCreate] Received ask interaction, but it wasn't ChatInputCommand. Type: ${interaction.type}`);
          }
          break;

        default:
          console.log(`[InteractionCreate] Received unhandled command: ${interaction.commandName}`);
          // Optional: Reply for unhandled commands
          if (!interaction.replied && !interaction.deferred) {
             try {
                await interaction.reply({ content: `Command '${interaction.commandName}' is not handled.`, ephemeral: true });
             } catch (e) { console.error("Failed to reply to unhandled command:", e); }
          }
      }
    });
    // ------------------------------------------

    // Login to Discord
    console.log('[initDiscordBot] Attempting to login...');
    client
      .login(DISCORD_BOT_TOKEN)
      .then(() => console.log('[Discord Bot] Login successful'))
      .catch((error) => console.error('[Discord Bot] Login failed:', error));
  }

  return client;
}

// Function to initialize all guilds with data from database
async function initializeAllGuildsFromDatabase() {
  try {
    console.log(`[Discord Bot] Initializing all guilds with database values...`);

    // Attempt to fetch Discord records from database via API
    let discordRecords = await fetchDiscordInfoFromAPI('all');

    // If the all-records endpoint fails or returns null, try to fetch individually
    if (!discordRecords) {
      console.log(`[Discord Bot] Bulk fetch failed, trying individual fetches...`);
      discordRecords = [];

      // For each guild, fetch its data individually
      for (const guild of client.guilds.cache.values()) {
        const record = await fetchDiscordInfoFromAPI(guild.id);
        if (record) {
          discordRecords.push(record);
        }
      }
    }

    if (Array.isArray(discordRecords) && discordRecords.length > 0) {
      console.log(`[Discord Bot] Found ${discordRecords.length} Discord records from API`);

      // For each guild the bot is in
      client.guilds.cache.forEach((guild) => {
        console.log(`[Discord Bot] Initializing tracking for guild: ${guild.name} (${guild.id})`);

        // Find matching record from API response
        const matchingRecord = discordRecords.find((record) => record.serverId === guild.id);

        // Initialize the guild stats
        initializeGuildStats(guild);

        // If we have database records for this guild, update the stats manually
        if (matchingRecord) {
          console.log(`[Discord Bot] Using existing stats from database for guild ${guild.id}`);

          // Update the stats with database values if available
          const guildStat = guildStats.get(guild.id);
          if (guildStat && matchingRecord) {
            guildStat.messageCount = matchingRecord.messagesCount || 0;
            guildStat.papersShared = matchingRecord.papersShared || 0;
            guildStat.qualityScore = matchingRecord.qualityScore || 50;

            // Update the stats map with new values
            guildStats.set(guild.id, guildStat);
          }
        }
      });
    } else {
      console.log(`[Discord Bot] No Discord records found from API, initializing with defaults`);

      // Initialize all guilds with default values
      client.guilds.cache.forEach((guild) => {
        initializeGuildStats(guild);
      });
    }

    console.log(`[Discord Bot] Guild initialization complete`);
  } catch (error) {
    console.error(`[Discord Bot] Error initializing guilds:`, error);

    // Initialize all guilds with default values on error
    client.guilds.cache.forEach((guild) => {
      initializeGuildStats(guild);
    });
  }
}


// Implement the summarize handler:
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

    // Dynamically import node-fetch
    const { default: fetch } = await import('node-fetch');

    // Download the PDF
    console.log(`[Summarize] Fetching PDF from: ${file?.url}`);
    const response = await fetch(file?.url || '');
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

// Export the client
export { client };

// --- Handler for /upload command ---
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
    // Dynamically import node-fetch here as well
    const { default: fetch } = await import('node-fetch');
    const response = await fetch(validFile.url);
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
        await interaction.editReply('Sorry, an error occurred while processing the PDF.');
        console.log(`[Upload] editReply (error) SUCCESSFUL for interaction ID: ${interaction.id}`);
      } else {
        console.log(`[Upload] Interaction ${interaction.id} was not replied/deferred. Attempting reply (error).`);
        await interaction.reply({ content: 'Sorry, an error occurred.', ephemeral: true });
        console.log(`[Upload] reply (error) SUCCESSFUL for interaction ID: ${interaction.id}`);
      }
    } catch (replyError) {
      console.error(`[Upload] Failed to send error reply for interaction ID: ${interaction.id}:`, replyError);
    }
  }
}

// --- Handler for /ask command ---
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



