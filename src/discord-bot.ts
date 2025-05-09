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
  console.log(`[MEMBER_JOIN] New member joined ${guild.name}: ${member.user.tag} (${member.user.id})`);

  try {
    // Update member count immediately when someone joins
    console.log(`[MEMBER_JOIN] Updating stats via API for guild ${guild.id}`);
    await notifyPortalAPI(guild.id, 'stats_update');
    console.log(`[MEMBER_JOIN] Stats update completed for guild ${guild.id}`);

    // First, save the new Discord member to our database
    await saveDiscordMember(member);

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
            try {
              // Try to fetch the Discord user object for this founder
              const founderUser = await client.users.fetch(founderMember.bioUser.discordId);
              
              if (founderUser) {
                // Create and send a detailed notification message about the new member
                const dmMessage = `👋 **New Member Alert!**

A new member has joined your BioDAO community server: **${guild.name}**

**Member Details:**
• **Username:** ${member.user.tag}
• **Discord ID:** ${member.id}
• **Joined:** ${new Date().toLocaleString()}

Consider reaching out to welcome them to your BioDAO community!`;

                //await founderUser.send(dmMessage);
                console.log(`[Discord] Sent DM to founder ${founderUser.tag} (${founderMember.bioUser.id})`);
              }
            } catch (dmError) {
              console.error(`[Discord] Failed to send DM to founder ${founderMember.bioUser.discordId}:`, dmError);
            }
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

/**
 * Save a Discord member to the database
 */
async function saveDiscordMember(member: GuildMember): Promise<void> {
  try {
    console.log(`[MEMBER_SAVE] Saving member ${member.user.tag} (${member.user.id}) to database`);

    // First check if this Discord record exists
    const discordRecord = await prisma.discord.findFirst({
      where: { serverId: member.guild.id }
    });

    if (!discordRecord) {
      console.log(`[MEMBER_SAVE] No Discord record found for server ${member.guild.id}, cannot save member`);
      return;
    }

    // Check if member already exists in the database
    const existingMember = await prisma.discordMember.findUnique({
      where: { discordId: member.user.id }
    });

    if (existingMember) {
      console.log(`[MEMBER_SAVE] Member ${member.user.tag} already exists in database, skipping save`);
      return;
    }

    // Create the new member record
    const newMember = await prisma.discordMember.create({
      data: {
        discordId: member.user.id,
        discordUsername: member.user.tag,
        discordAvatar: member.user.displayAvatarURL(),
        discordServerId: member.guild.id,
        // These fields will be populated later when the user responds to DMs
        linkedinUrl: null,
        scientificProfileUrl: null,
        motivationToJoin: null,
        isOnboarded: false,
        paperContributions: 0,
        messageCount: 0,
      }
    });

    console.log(`[MEMBER_SAVE] Successfully saved Discord member ${member.user.tag} to database with ID ${newMember.id}`);
  } catch (error) {
    console.error(`[MEMBER_SAVE] Error saving Discord member to database:`, error);
  }
}

/**
 * Send a welcome DM to a new Discord member asking for LinkedIn and scientific profile URLs
 */
async function sendWelcomeDMToNewMember(member: GuildMember, discordRecord: any, project: any): Promise<void> {
  try {
    console.log(`[WELCOME_DM] Sending welcome message to ${member.user.tag}`);
    
    // Find any founders with Discord IDs to notify them
    const founders = await prisma.projectMember.findMany({
      where: {
        projectId: project.id,
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
    
    // Notify founders about the new member
    if (founders && founders.length > 0) {
      console.log(`[WELCOME_DM] Found ${founders.length} founders to notify about new member`);
      
      for (const founder of founders) {
        try {
          // Add null check before accessing discordId
          if (!founder.bioUser?.discordId) {
            console.log(`[WELCOME_DM] Founder has no Discord ID, skipping notification`);
            continue;
          }
          
          console.log(`[WELCOME_DM] Sending notification to founder with ID ${founder.bioUser.discordId}`);
          const founderUser = await client.users.fetch(founder.bioUser.discordId);
          
          if (founderUser) {
            // Create a more detailed notification message with member info
            const founderNotification = `
👋 **New Member Alert!**

A new member has joined your BioDAO community server: **${project.projectName || member.guild.name}**

**Member Details:**
• **Username:** ${member.user.tag}
• **Discord ID:** ${member.user.id}
• **Joined:** ${new Date().toLocaleString()}
• **Account Created:** ${member.user.createdAt.toLocaleString()}

They'll be prompted to share their LinkedIn and scientific profiles for better community connection. I'll recommend a 1:1 onboarding meeting if they share scientific profiles.

🔔 **Recommendation:** Consider proactively reaching out to welcome them to the community!
`;
            await founderUser.send(founderNotification);
            console.log(`[WELCOME_DM] Successfully sent notification to founder ${founderUser.tag}`);
          }
        } catch (error) {
          console.error(`[WELCOME_DM] Error notifying founder ${founder.bioUser?.discordId || founder.bioUserId}:`, error);
        }
      }
    }

    // Create welcome message with embedded form, now with more guidance
    const welcomeMessage = `
👋 Welcome to **${project.projectName || member.guild.name}**! 

We're excited to have you join our scientific community. To help foster collaboration, we'd love to know a bit more about you.

**To enhance your experience, could you please share:**

1️⃣ Your LinkedIn profile URL (if available)
2️⃣ Your scientific profile URLs (e.g., Google Scholar, ORCID, ResearchGate, Exaly.com) - feel free to share multiple profiles! (optional)
3️⃣ Any research papers or projects you'd like to share

You can respond to any of these questions whenever you're ready - just send them as separate messages. I'll be here to collect your responses anytime!
`;

    await member.send(welcomeMessage);
    console.log(`[WELCOME_DM] Sent welcome message to ${member.user.tag}`);
    
    // Set up message collector for this user
    setupPersistentResponseCollector(member.user.id, member.guild.id);
    
  } catch (error) {
    console.error(`[WELCOME_DM] Error sending welcome DM to ${member.user.tag}:`, error);
  }
}

// Store user profile information as it comes in
interface UserProfileData {
  userId: string;
  guildId: string;
  linkedIn?: string;
  scientificBackground?: string;
  researchPapers?: string;
  lastInteraction: Date;
  isComplete: boolean;
}

// Add this type definition to fix errors with pendingResponses
interface PendingGuildSelectionResponse {
  responseType: string;
  servers: Guild[];
}

// Map to store ongoing profile collection by user ID
const userProfileCollections = new Map<string, UserProfileData>();

// Set up a persistent response collector for a user
function setupPersistentResponseCollector(userId: string, guildId: string): void {
  // Initialize profile data for this user if not exists
  if (!userProfileCollections.has(userId)) {
    userProfileCollections.set(userId, {
      userId,
      guildId,
      lastInteraction: new Date(),
      isComplete: false
    });
    
    console.log(`[PROFILE] Initialized profile collection for user ${userId}`);
  }
  
  // Note: We don't set up a message collector here since we'll handle 
  // all DM messages in the client.on('messageCreate') handler
}

// Process a DM response for profile collection
async function processDMResponse(message: Message): Promise<void> {
  // Only process DMs
  if (message.channel.type !== ChannelType.DM || message.author.bot) return;
  
  const userId = message.author.id;
  
  // Check if we're collecting profile info for this user
  const profileData = userProfileCollections.get(userId);
  
  // If no ongoing collection for this user, check if this might be a new request to share profile info
  if (!profileData) {
    const content = message.content.toLowerCase().trim();
    
    // Check if the user is asking to update or share their profile
    if (content.includes('update profile') || 
        content.includes('share profile') || 
        content.includes('my profile') ||
        content.includes('add my') ||
        content.includes('share my')) {
      
      try {
        // Find which guild this user is from
        const userGuilds = [];
        for (const guild of client.guilds.cache.values()) {
          try {
            const member = await guild.members.fetch(userId);
            if (member) {
              userGuilds.push(guild);
            }
          } catch (e) {
            // User is not in this guild
          }
        }
        
        if (userGuilds.length === 0) {
          await message.reply("I couldn't find any mutual servers with you. Please make sure you're a member of a BioDAO community server.");
          return;
        } else if (userGuilds.length === 1) {
          // If only one guild, use that
          const guildId = userGuilds[0].id;
          
          // Initialize a new profile collection
          userProfileCollections.set(userId, {
            userId,
            guildId,
            lastInteraction: new Date(),
            isComplete: false
          });
          
          await message.reply(`
Great! I'd love to collect your profile information for the BioDAO community. Please share:

1️⃣ Your LinkedIn profile URL (if available)
2️⃣ Your scientific profile URLs (e.g., Google Scholar, ORCID, ResearchGate, Exaly.com) - feel free to share multiple profiles! (optional)
3️⃣ Any research papers or projects you'd like to share

You can respond to these in separate messages, at any time. No rush!`);
        } else {
          // Multiple guilds, ask which one
          const guildList = userGuilds.map((g, i) => `${i+1}. ${g.name}`).join('\n');
          await message.reply(`You're in multiple BioDAO servers. Which one would you like to update your profile for?\n\n${guildList}\n\nPlease reply with the number.`);
          
          // Set up pending response for guild selection
          pendingResponses.set(userId, {
            guildId: '', // Empty string to satisfy type requirement
            responseType: 'guildSelection',
            servers: userGuilds
          } as PendingResponse);
        }
      } catch (error) {
        console.error(`[PROFILE] Error initializing profile collection:`, error);
        await message.reply("Sorry, there was an error starting the profile collection process. Please try again later.");
      }
      return;
    }
    
    // Handle guild selection response
    const pendingResponse = pendingResponses.get(userId);
    if (pendingResponse && pendingResponse.responseType === 'guildSelection' && (pendingResponse as any).servers) {
      const selection = parseInt(message.content.trim());
      const servers = (pendingResponse as any).servers as Guild[];
      if (!isNaN(selection) && selection > 0 && selection <= servers.length) {
        const selectedGuild = servers[selection - 1];
        
        // Clear the pending response
        pendingResponses.delete(userId);
        
        // Initialize profile collection for the selected guild
        userProfileCollections.set(userId, {
          userId,
          guildId: selectedGuild.id,
          lastInteraction: new Date(),
          isComplete: false
        });
        
        await message.reply(`
Great! I'll update your profile for **${selectedGuild.name}**. Please share:

1️⃣ Your LinkedIn profile URL (if available)
2️⃣ Your scientific profile URLs (e.g., Google Scholar, ORCID, ResearchGate, Exaly.com) - feel free to share multiple profiles! (optional)
3️⃣ Any research papers or projects you'd like to share

You can respond to these in separate messages, at any time. No rush!`);
      } else {
        await message.reply("I couldn't understand your selection. Please enter a number from the list.");
      }
      return;
    }
    
    // If we get here, it's a DM but not for profile collection or updating, so just ignore
    return;
  }
  
  // If we get here, we have an ongoing profile collection
  
  // Update last interaction time
  profileData.lastInteraction = new Date();
  
  const content = message.content.trim();
  
  try {
    // Detect LinkedIn URL
    if ((content.includes('linkedin.com/') || content.toLowerCase().includes('linkedin:')) && !profileData.linkedIn) {
      // Extract the URL pattern if it exists
      const linkedinMatches = content.match(/(https?:\/\/)?(www\.)?linkedin\.com\/in\/[^\s]+/i);
      if (linkedinMatches) {
        profileData.linkedIn = linkedinMatches[0];
        if (!profileData.linkedIn.startsWith('http')) {
          profileData.linkedIn = 'https://' + profileData.linkedIn;
        }
        
        await message.reply("Thanks for sharing your LinkedIn profile! 👍 This will help connect you with professionals in your field.");
        console.log(`[PROFILE] Received LinkedIn profile from user ${userId}`);
        
        // Notify founders about the LinkedIn update
        await notifyFoundersAboutNewMemberProfile(profileData);
      } else {
        // If they mentioned LinkedIn but no valid URL was found
        await message.reply("I couldn't find a valid LinkedIn URL in your message. Please make sure it's in the format 'linkedin.com/in/username'.");
      }
    }
    // Detect scientific profile URLs like Google Scholar, ORCID, etc.
    else if (content.includes('scholar.google.com') || 
             content.includes('orcid.org') || 
             content.includes('researchgate.net') ||
             content.includes('academia.edu') ||
             content.includes('exaly.com') ||
             content.toLowerCase().includes('scholar') ||
             content.toLowerCase().includes('scientific profile') ||
             content.toLowerCase().includes('academic profile')) {
      
      // Extract URLs from the message
      const scientificUrls = extractScientificProfileUrls(content);
      
      if (scientificUrls.length > 0) {
        // Save the profile URLs
        profileData.scientificBackground = scientificUrls.join('\n');
        await message.reply(`Thanks for sharing your scientific profile${scientificUrls.length > 1 ? 's' : ''}! 🔬 This will help connect you with researchers in your field.`);
        console.log(`[PROFILE] Received ${scientificUrls.length} scientific profile URLs from user ${userId}`);
        
        // Notify founders about the scientific profiles update
        await notifyFoundersAboutNewMemberProfile(profileData);
        
        userProfileCollections.set(userId, profileData);
        return;
      } else {
        // If they mentioned scientific profiles but no valid URLs were found
        await message.reply("I couldn't find valid scientific profile URLs in your message. Please make sure to include the full URLs to your profiles (e.g., https://scholar.google.com/...)");
      }
    }
    // Detect research papers
    else if ((content.includes('doi.org/') || 
              content.includes('arxiv.org/') || 
              content.includes('pubmed') || 
              content.includes('ncbi.nlm') ||
              content.includes('researchgate.net/') ||
              content.includes('biorxiv.org/') ||
              content.toLowerCase().includes('paper:') ||
              (content.toLowerCase().includes('paper') && content.includes('http')))
            && !profileData.researchPapers) {
      profileData.researchPapers = content;
      await message.reply("Thanks for sharing your research papers! 📚 This will help others understand your work and find opportunities for collaboration.");
      console.log(`[PROFILE] Received research papers from user ${userId}`);
      
      // Notify founders about the research papers update
      await notifyFoundersAboutNewMemberProfile(profileData);
      
      userProfileCollections.set(userId, profileData);
      return;
    }
    // Detect yes/no responses for meeting suggestion
    else if (content.toLowerCase() === 'yes' || content.toLowerCase() === 'y') {
      await message.reply("Thank you for your response. Just to let you know, our founders will reach out to members directly for 1:1 meetings as they see fit. Continue to engage in the community!");
    }
    else if (content.toLowerCase() === 'no' || content.toLowerCase() === 'n') {
      await message.reply("Thank you for your response. Our founders will reach out directly if they'd like to schedule a meeting with you.");
    }
    // Handle explicit commands
    else if (content.toLowerCase() === 'help') {
      await message.reply(`
I'm collecting information to enhance your community experience. You can share:

1️⃣ Your LinkedIn profile URL
2️⃣ Your scientific profile URLs (e.g., Google Scholar, ORCID)
3️⃣ Any research papers or projects

You can send these anytime - there's no time limit! Just message them to me whenever you're ready.

Other commands:
• Type 'progress' to see what information you've shared so far
• Type 'done' when you've finished sharing information
• Type 'cancel' to cancel the profile collection process`);
    }
    else if (content.toLowerCase() === 'meeting') {
      await message.reply("Our founders will reach out to members for 1:1 meetings as needed. There's no need to request one directly - just continue to share your research and engage in the community!");
      // await notifyFoundersAboutMeetingRequest(profileData); // Remove or comment out
    }
    else if (content.toLowerCase() === 'progress') {
      // Show what they've shared so far
      const linkedInStatus = profileData.linkedIn ? "✅ Provided" : "❌ Not provided yet";
      const scientificStatus = profileData.scientificBackground ? "✅ Provided" : "❌ Not provided yet";
      const papersStatus = profileData.researchPapers ? "✅ Provided" : "❌ Not provided yet";
      
      await message.reply(`
Here's your current profile progress:

LinkedIn profile: ${linkedInStatus}
Scientific profiles: ${scientificStatus}
Research papers: ${papersStatus}

You can continue sharing any missing information in separate messages whenever you're ready.`);
    }
    else if (content.toLowerCase() === 'done') {
      // Check if they've provided anything
      if (!profileData.linkedIn && !profileData.scientificBackground && !profileData.researchPapers) {
        await message.reply("You haven't shared any profile information yet. Would you like to skip the profile collection process? (yes/no)");
        
        // Update the pending response type
        pendingResponses.set(userId, {
          guildId: profileData.guildId,
          responseType: 'skipProfile'
        });
        return;
      }
      
      profileData.isComplete = true;
      userProfileCollections.set(userId, profileData);
      
      await message.reply(`
Thank you for sharing your information! Your profile has been saved with the details you provided.

Remember, you can message me anytime if you'd like to update your information or request a meeting with the founders by typing 'update profile' or 'meeting'.`);
      
      // Save the profile information to database
      await saveUserProfileToDatabase(profileData);
      
      // Notify founders about the completed profile
      await notifyFoundersAboutNewMemberProfile(profileData);
    }
    else if (content.toLowerCase() === 'cancel') {
      userProfileCollections.delete(userId);
      await message.reply("Profile collection cancelled. You can start again anytime by messaging 'update profile'.");
      return;
    }
    // For messages we don't recognize
    else {
      // Check if this might contain a scientific profile URL we didn't catch with our initial checks
      const scientificUrls = extractScientificProfileUrls(content);
      if (scientificUrls.length > 0) {
        // Save the profile URLs
        profileData.scientificBackground = (profileData.scientificBackground || '') + 
                                           (profileData.scientificBackground ? '\n' : '') + 
                                           scientificUrls.join('\n');
        
        await message.reply(`Thanks for sharing your scientific profile${scientificUrls.length > 1 ? 's' : ''}! 🔬 This will help connect you with researchers in your field.`);
        console.log(`[PROFILE] Received ${scientificUrls.length} scientific profile URLs from user ${userId}`);
      }
      // Only respond if they haven't shared much yet, to avoid being too chatty
      else if (!profileData.linkedIn && !profileData.scientificBackground && !profileData.researchPapers) {
        await message.reply(`
Thanks for your message! I'm looking for:

1️⃣ Your LinkedIn profile URL
2️⃣ Your scientific profile URLs (e.g., Google Scholar, ORCID)
3️⃣ Any research papers or projects

You can send these anytime - just message them whenever you're ready. Type 'help' if you need more information, or 'cancel' to stop the profile collection.`);
      }
    }
    
    // Update the map with modified data
    userProfileCollections.set(userId, profileData);
    
    // Check if all information is provided and mark as complete if so
    if (profileData.linkedIn && profileData.scientificBackground && profileData.researchPapers && !profileData.isComplete) {
      profileData.isComplete = true;
      userProfileCollections.set(userId, profileData);
      
      await message.channel.send(`
Thank you for sharing all your information! Your profile is now complete. This will greatly help with connecting you to the right people and opportunities in the community.

Remember, you can message me anytime if you'd like to update your information or request a meeting with the founders by typing 'update profile' or 'meeting'.`);
      
      // Save the profile information to database
      await saveUserProfileToDatabase(profileData);
      
      // Notify founders about the completed profile
      await notifyFoundersAboutNewMemberProfile(profileData);
    }
    
  } catch (error) {
    console.error(`[PROFILE] Error processing DM from ${userId}:`, error);
    await message.reply("Sorry, there was an error processing your message. Please try again or type 'help' for assistance.");
  }
}

// Helper function to extract scientific profile URLs from a message
function extractScientificProfileUrls(content: string): string[] {
  const urls: string[] = [];
  
  // Common scientific profile domains - expanded list
  const scientificDomains = [
    'scholar.google.com',
    'orcid.org',
    'researchgate.net',
    'academia.edu',
    'exaly.com',
    'publons.com',
    'webofscience.com',
    'scopus.com',
    'mendeley.com',
    'semanticscholar.org',
    'loop.frontiersin.org',
    'sciprofiles.com',
    'dimension.ai',
    'linkedin.com/in/',  // Also check LinkedIn profiles in case they're shared here
    'ncbi.nlm.nih.gov/pubmed/',
    'figshare.com',
    'europepmc.org',
    'profile.elsevier.com',
    'research.com'
  ];
  
  // Extract all URLs from the content
  const urlRegex = /(https?:\/\/[^\s]+)/gi;
  const matches = content.match(urlRegex);
  
  if (matches) {
    for (const match of matches) {
      // Check if URL is from a scientific domain
      if (scientificDomains.some(domain => match.includes(domain))) {
        urls.push(match);
      }
    }
  }
  
  // If we didn't find any matches but content has mentions of specific platforms, 
  // look for text patterns that might be mentions of profile identifiers
  if (urls.length === 0) {
    const identifierPatterns = [
      { pattern: /orcid:?\s*([0-9]{4}-[0-9]{4}-[0-9]{4}-[0-9]{4})/i, platform: 'orcid.org/'},
      { pattern: /google scholar:?\s*([A-Za-z0-9_-]+)/i, platform: 'scholar.google.com/citations?user='},
      { pattern: /researchgate:?\s*([A-Za-z0-9_-]+)/i, platform: 'researchgate.net/profile/'}
    ];
    
    for (const { pattern, platform } of identifierPatterns) {
      const idMatch = content.match(pattern);
      if (idMatch && idMatch[1]) {
        urls.push(`https://${platform}${idMatch[1]}`);
      }
    }
  }
  
  return urls;
}

// Update the saveUserProfileToDatabase function to properly handle scientific profile URLs
async function saveUserProfileToDatabase(profileData: UserProfileData): Promise<void> {
  try {
    const { guildId, userId, linkedIn, scientificBackground, researchPapers } = profileData;
    
    // Find Discord member record or create one
    const member = await prisma.discordMember.upsert({
      where: {
        discordId: userId
        // Note: discordServerId needs to be in a separate component since it's not part of a composite key
      },
      update: {
        linkedinUrl: linkedIn || null,
        // Only update the motivation if scientific profiles were not provided
        ...(scientificBackground ? {} : { motivationToJoin: null })
      },
      create: {
        discordId: userId,
        discordUsername: userId, // Default value, will be updated later
        discordServerId: guildId,
        joinedAt: new Date(),
        linkedinUrl: linkedIn || null,
        // Use scientific background as motivation if profiles weren't provided
        motivationToJoin: !scientificBackground?.includes('http') ? scientificBackground : null,
        isOnboarded: true
      }
    });
    
    // Flag to track if a scientific profile was actually created
    let scientificProfileCreated = false;
    
    // Extract scientific profile URLs and save them individually
    if (scientificBackground) {
      // Split by newlines in case multiple URLs were provided
      const profileUrls = scientificBackground.split('\n');
      
      for (const url of profileUrls) {
        if (url.trim() && url.includes('http')) {
          // Determine platform from URL
          let platform = 'Other';
          if (url.includes('scholar.google.com')) platform = 'Google Scholar';
          else if (url.includes('orcid.org')) platform = 'ORCID';
          else if (url.includes('researchgate.net')) platform = 'ResearchGate';
          else if (url.includes('academia.edu')) platform = 'Academia.edu';
          else if (url.includes('exaly.com')) platform = 'Exaly';
          else if (url.includes('publons.com')) platform = 'Publons';
          else if (url.includes('webofscience.com')) platform = 'Web of Science';
          else if (url.includes('scopus.com')) platform = 'Scopus';
          else if (url.includes('mendeley.com')) platform = 'Mendeley';
          else if (url.includes('semanticscholar.org')) platform = 'Semantic Scholar';
          else if (url.includes('loop.frontiersin.org')) platform = 'Frontiers';
          
          // Create a scientific profile record (avoid duplicates)
          const existingProfile = await prisma.scientificProfile.findFirst({
            where: {
              memberId: member.id,
              url: url.trim()
            }
          });
          
          if (!existingProfile) {
            await prisma.scientificProfile.create({
              data: {
                url: url.trim(),
                platform,
                profileId: null, // Could extract ID if needed
                memberId: member.id
              }
            });
            console.log(`[PROFILE] Created scientific profile record for platform: ${platform}`);
            scientificProfileCreated = true;
          }
        }
      }
    }
    
    // Save research papers if provided
    if (researchPapers) {
      // Papers could be saved as a scientific profile or as part of the motivation
      if (researchPapers.includes('http')) {
        // Extract paper URLs and save them
        const paperUrls = researchPapers.split('\n');
        for (const url of paperUrls) {
          if (url.trim() && url.includes('http')) {
            let platform = 'Research Paper';
            if (url.includes('arxiv.org')) platform = 'arXiv';
            else if (url.includes('doi.org')) platform = 'DOI';
            else if (url.includes('biorxiv.org')) platform = 'bioRxiv';
            else if (url.includes('pubmed')) platform = 'PubMed';
            
            // Create a scientific profile record for the paper
            const existingProfile = await prisma.scientificProfile.findFirst({
              where: {
                memberId: member.id,
                url: url.trim()
              }
            });
            
            if (!existingProfile) {
              await prisma.scientificProfile.create({
                data: {
                  url: url.trim(),
                  platform,
                  profileId: null,
                  memberId: member.id
                }
              });
              console.log(`[PROFILE] Created paper record for platform: ${platform}`);
              scientificProfileCreated = true;
            }
          }
        }
      } else {
        // Update motivation if papers were described in text
        await prisma.discordMember.update({
          where: { id: member.id },
          data: { motivationToJoin: researchPapers }
        });
      }
    }
    
    // If any scientific profile was created, increment the verifiedScientistCount for the project
    if (scientificProfileCreated) {
      // Find the Discord server for this member
      const discord = await prisma.discord.findFirst({
        where: { serverId: guildId }
      });
      
      if (discord) {
        // Get the project associated with this Discord server
        const project = await prisma.project.findUnique({
          where: { id: discord.projectId }
        });
        
        if (project) {
          // Check if this is the first scientific profile for this Discord member
          const existingProfiles = await prisma.scientificProfile.count({
            where: { memberId: member.id }
          });
          
          // Only increment if this is the first set of profiles (to avoid counting the same scientist multiple times)
          if (existingProfiles <= 1) {
            // Increment the verifiedScientistCount
            await prisma.project.update({
              where: { id: project.id },
              data: { 
                verifiedScientistCount: {
                  increment: 1
                }
              } as any
            });
            
            console.log(`[PROFILE] Incremented verified scientist count for project ${project.id}`);
            
            // Check if this update triggers a level-up to level 6
            if (project.level === 5) {
              // Check the updated count
              const updatedProject = await prisma.project.findUnique({
                where: { id: project.id },
                include: {
                  Discord: true,
                  NFTs: true,
                  members: {
                    include: {
                      bioUser: true
                    }
                  },
                }
              });
              
              // If the updated count is now at least 10, check for level-up
              if (updatedProject && (updatedProject as any).verifiedScientistCount >= 10) {
                console.log(`[PROFILE] Project ${project.id} now has ${(updatedProject as any).verifiedScientistCount} verified scientists, checking for level-up`);
                
                // If user is connected via WebSocket, perform level-up
                if (activeConnections[project.id]) {
                  await checkAndPerformLevelUp(updatedProject, activeConnections[project.id]);
                }
              }
            }
          }
        }
      }
    }
    
    console.log(`[PROFILE] Saved profile for user ${userId} to database`);
    
  } catch (error) {
    console.error(`[PROFILE] Error saving profile to database:`, error);
  }
}

// Notify founders about meeting request
async function notifyFoundersAboutMeetingRequest(profileData: UserProfileData): Promise<void> {
  try {
    const { guildId, userId } = profileData;
    
    // Get Discord info for this guild
    const discordRecord = await prisma.discord.findFirst({
      where: { serverId: guildId },
      include: { project: true }
    });
    
    if (!discordRecord || !discordRecord.project) {
      console.error(`[MEETING] Could not find project for guild ${guildId}`);
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
      console.log(`[MEETING] No founders found with Discord IDs for project ${discordRecord.project.id}`);
      return;
    }
    
    // Get user info safely
    let user;
    try {
      user = await client.users.fetch(userId);
    } catch (error) {
      console.error(`[MEETING] Error fetching user ${userId}:`, error);
      return;
    }

    if (!user) {
      console.error(`[MEETING] Could not fetch user ${userId}`);
      return;
    }
    
    // Fetch Discord member record to get the scientific profiles
    const memberRecord = await prisma.discordMember.findUnique({
      where: { discordId: userId },
      include: { scientificProfiles: true }
    });
    
    // Compile profile info for the notification
    const linkedInInfo = profileData.linkedIn ? `\n**LinkedIn:** ${profileData.linkedIn}` : "\n**LinkedIn:** Not provided";
    
    // Format scientific profiles nicely
    let scientificProfilesInfo = "\n**Scientific Profiles:** Not provided";
    if (memberRecord?.scientificProfiles && memberRecord.scientificProfiles.length > 0) {
      scientificProfilesInfo = "\n**Scientific Profiles:**";
      memberRecord.scientificProfiles.forEach(profile => {
        scientificProfilesInfo += `\n• ${profile.platform}: ${profile.url}`;
      });
    } else if (profileData.scientificBackground) {
      // Fallback to the older format if no profiles in the new format
      scientificProfilesInfo = `\n**Scientific Background:** ${profileData.scientificBackground.substring(0, 200)}${profileData.scientificBackground.length > 200 ? '...' : ''}`;
    }
    
    const papersInfo = profileData.researchPapers ? 
      `\n**Research Papers:** ${profileData.researchPapers.substring(0, 200)}${profileData.researchPapers.length > 200 ? '...' : ''}` : 
      "\n**Research Papers:** Not provided";
    
    // Notify each founder
    for (const founder of founders) {
      try {
        // Skip founders without a Discord ID
        if (!founder.bioUser?.discordId) {
          console.log(`[MEETING] Founder ${founder.bioUserId} has no Discord ID, skipping notification`);
          continue;
        }
        
        const founderUser = await client.users.fetch(founder.bioUser.discordId);
        if (founderUser) {
          const notification = `
🤝 **Meeting Request**

A member in your BioDAO community server **${discordRecord.project.projectName || 'your project'}** has requested a 1:1 onboarding meeting.

**Member Details:**
• **Username:** ${user.tag}
• **Discord ID:** ${user.id}
• **Joined:** ${new Date().toLocaleString()}${linkedInInfo}${scientificProfilesInfo}${papersInfo}

📅 Please reach out to schedule a meeting with this member at your earliest convenience.
`;
          await founderUser.send(notification);
          console.log(`[MEETING] Sent meeting request notification to founder ${founderUser.tag}`);
        }
      } catch (error) {
        // Safe error logging that doesn't rely on potentially undefined properties
        console.error(`[MEETING] Error notifying founder ${founder.bioUser?.discordId || founder.bioUserId}:`, error);
      }
    }
    
  } catch (error) {
    console.error(`[MEETING] Error notifying founders about meeting request:`, error);
  }
}

// Add to the messageCreate event handler
client.on('messageCreate', async (message) => {
  // ... existing code ...
  
  // Process DM responses for profile collection
  if (message.channel.type === ChannelType.DM && !message.author.bot) {
    await processDMResponse(message);
    return;
  }
  
  // ... rest of existing messageCreate handler ...
});

// Add this type definition at the top of the file, near other interface definitions
interface PendingResponse {
  guildId: string;
  responseType: string;
  servers?: any[]; // For multiple server selection
}

// Map to track which users we're waiting for responses from
const pendingResponses = new Map<string, PendingResponse>();

/**
 * Set up a message collector for profile information
 */
function setUpProfileInfoCollector(userId: string, guildId: string): void {
  // Track that we're waiting for a response from this user
  pendingResponses.set(userId, { guildId, responseType: 'profileInfo' });
}

// Add a message listener to collect DM responses
client.on(Events.MessageCreate, async (message) => {
  // Ignore messages from bots (including ourselves)
  if (message.author.bot) return;
  
  // Ignore non-DM messages
  if (message.channel.type !== 1) return; // ChannelType.DM === 1
  
  // Check if we're waiting for a response from this user
  const pendingResponse = pendingResponses.get(message.author.id);
  if (!pendingResponse) return;
  
  try {
    // Handle the response based on its type
    if (pendingResponse.responseType === 'profileInfo') {
      await handleProfileInfoResponse(message, pendingResponse.guildId);
    }
    // Remove the pending response
    pendingResponses.delete(message.author.id);
  } catch (error) {
    console.error(`[RESPONSE_HANDLER] Error handling DM response:`, error);
  }
});

/**
 * Handle a response to the profile information request
 */
async function handleProfileInfoResponse(message: Message, guildId: string): Promise<void> {
  try {
    console.log(`[PROFILE_INFO] Received profile info response from ${message.author.tag}`);
    
    // Parse the response - this is basic for now, can be enhanced later
    const responseText = message.content.trim();
    
    // If the user replied "skip", we'll just save empty values
    if (responseText.toLowerCase() === 'skip') {
      console.log(`[PROFILE_INFO] User ${message.author.tag} skipped providing profile info`);
      await message.reply("No problem! Thank you for joining the community. If you change your mind, you can always update your information later by sending me a message with 'update profile'.");
      return;
    }
    
    // Try to extract LinkedIn URL, scientific profile URLs, and motivation
    let linkedinUrl: string | null = null;
    let scientificProfileUrls: string[] = [];
    let motivationToJoin: string | null = null;
    
    // Simple extraction based on common patterns
    // Look for LinkedIn URL
    const linkedinMatches = responseText.match(/linkedin\.com\/in\/[^\s]+/gi);
    if (linkedinMatches && linkedinMatches.length > 0) {
      linkedinUrl = linkedinMatches[0];
      if (!linkedinUrl.startsWith('https://')) {
        linkedinUrl = 'https://' + linkedinUrl;
      }
    }
    
    // Look for common scientific profile URLs
    // Match multiple scientific profile URLs
    const scientificUrlPatterns = [
      /(?:scholar\.google\.com[^\s]*)/gi,
      /(?:orcid\.org[^\s]*)/gi,
      /(?:researchgate\.net[^\s]*)/gi,
      /(?:academia\.edu[^\s]*)/gi,
      /(?:exaly\.com\/author[^\s]*)/gi,
      /(?:publons\.com[^\s]*)/gi,
      /(?:loop\.frontiersin\.org[^\s]*)/gi,
      /(?:scopus\.com[^\s]*)/gi,
      /(?:webofscience\.com[^\s]*)/gi
    ];
    
    // Extract all scientific URLs
    for (const pattern of scientificUrlPatterns) {
      const matches = responseText.match(pattern);
      if (matches) {
        for (const match of matches) {
          let url = match;
          if (!url.startsWith('https://') && !url.startsWith('http://')) {
            url = 'https://' + url;
          }
          scientificProfileUrls.push(url);
        }
      }
    }
    
    // Extract other URLs that might be scientific profiles but not matching our patterns
    const genericUrlMatches = responseText.match(/https?:\/\/[^\s]+/gi);
    if (genericUrlMatches) {
      for (const url of genericUrlMatches) {
        // Skip URLs we've already captured
        if (linkedinUrl === url) continue;
        if (scientificProfileUrls.includes(url)) continue;
        
        // Check if it might be a scientific profile URL not in our patterns
        const lowerUrl = url.toLowerCase();
        if (
          lowerUrl.includes('profile') || 
          lowerUrl.includes('scholar') || 
          lowerUrl.includes('author') || 
          lowerUrl.includes('citation') ||
          lowerUrl.includes('research') ||
          lowerUrl.includes('science') ||
          lowerUrl.includes('academic')
        ) {
          scientificProfileUrls.push(url);
        }
      }
    }
    
    // Deduplicate scientific profile URLs
    scientificProfileUrls = [...new Set(scientificProfileUrls)];
    
    // Create a formatted string with all scientific URLs for the database
    const scientificProfileUrlsString = scientificProfileUrls.length > 0 
      ? scientificProfileUrls.join('|')
      : null;
    
    // Just use the entire response as motivation if no URLs were found
    // Otherwise, use the text that isn't a URL
    if (!linkedinUrl && scientificProfileUrls.length === 0) {
      motivationToJoin = responseText;
    } else {
      // Remove the URLs from the text to get the motivation
      let motivationText = responseText
        .replace(/https?:\/\/[^\s]+/g, '')
        .replace(/linkedin\.com\/in\/[^\s]+/g, '')
        .replace(/(scholar\.google\.com|orcid\.org|researchgate\.net|academia\.edu|exaly\.com\/author)[^\s]*/g, '')
        .trim();
      
      if (motivationText) {
        motivationToJoin = motivationText;
      }
    }
    
    // Check if this member already exists in the database
    const existingMember = await prisma.discordMember.findFirst({
      where: { 
        discordId: message.author.id,
        discordServerId: guildId
      }
    });
    
    const isUpdate = existingMember?.isOnboarded === true;
    
    // First update the Discord member record with basic info
    await prisma.discordMember.updateMany({
      where: { 
        discordId: message.author.id,
        discordServerId: guildId
      },
      data: {
        linkedinUrl,
        motivationToJoin,
        isOnboarded: true,
        updatedAt: new Date()
      }
    });

    // Get the updated member to use its ID
    const updatedMember = await prisma.discordMember.findFirst({
      where: { 
        discordId: message.author.id,
        discordServerId: guildId
      }
    });
    
    if (!updatedMember) {
      throw new Error('Failed to find updated Discord member record');
    }

    // If this is an update, first delete existing scientific profiles
    if (isUpdate) {
      await prisma.scientificProfile.deleteMany({
        where: { memberId: updatedMember.id }
      });
    }
    
    // Create the scientific profile records
    for (const url of scientificProfileUrls) {
      // Determine platform from URL
      let platform = 'Other';
      
      if (url.includes('scholar.google.com')) platform = 'Google Scholar';
      else if (url.includes('orcid.org')) platform = 'ORCID';
      else if (url.includes('researchgate.net')) platform = 'ResearchGate';
      else if (url.includes('academia.edu')) platform = 'Academia.edu';
      else if (url.includes('exaly.com')) platform = 'Exaly';
      else if (url.includes('publons.com')) platform = 'Publons';
      else if (url.includes('loop.frontiersin.org')) platform = 'Frontiers';
      else if (url.includes('scopus.com')) platform = 'Scopus';
      else if (url.includes('webofscience.com')) platform = 'Web of Science';
      
      // Extract profile ID if possible
      let profileId = null;
      
      // Different regex for different platforms
      if (platform === 'Google Scholar') {
        const match = url.match(/user=([^&]+)/);
        if (match) profileId = match[1];
      } else if (platform === 'ORCID') {
        const match = url.match(/orcid\.org\/(\d{4}-\d{4}-\d{4}-\d{4})/);
        if (match) profileId = match[1];
      } else if (platform === 'Exaly') {
        const match = url.match(/author\/(\d+)/);
        if (match) profileId = match[1];
      }
      
      // Create the profile record
      await prisma.scientificProfile.create({
        data: {
          url,
          platform,
          profileId,
          memberId: updatedMember.id
        }
      });
    }
    
    console.log(`[PROFILE_INFO] ${isUpdate ? 'Updated' : 'Set'} profile info for ${message.author.tag}, including ${scientificProfileUrls.length} scientific profiles`);
    
    // Thank the user with appropriate message based on whether this is an update or initial setup
    if (isUpdate) {
      await message.reply("Your profile information has been updated successfully! Thank you for keeping your information current.");
    } else {
      await message.reply("Thank you for sharing your information! This will help foster collaboration in the community.\n\nIf you ever need to update this information, just send me a direct message with 'update profile'.");
    }
    
    // If we found scientific profiles, suggest a 1:1 meeting
    if (scientificProfileUrls.length > 0) {
      setTimeout(async () => {
        try {
          await message.reply("I noticed you shared your scientific profiles. Would you be interested in a 1:1 meeting with one of our founders to discuss your research interests and potential collaboration opportunities? Reply with 'yes' if interested.");
          
          // Set up collector for 1:1 meeting response
          pendingResponses.set(message.author.id, {
            guildId,
            responseType: 'meeting'
          } as PendingResponse);
          
        } catch (error) {
          console.error(`[PROFILE_INFO] Error sending meeting suggestion:`, error);
        }
      }, 5000); // Wait 5 seconds before sending follow-up
    }
    
    // Notify project founders about the profile information
    try {
      const discordRecord = await prisma.discord.findFirst({
        where: { serverId: guildId }
      });
      
      if (discordRecord) {
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
          const founders = project.members.filter((m: any) => m.bioUser?.discordId);
          
          for (const founder of founders) {
            try {
              // Check that discordId is not null before fetching
              if (!founder.bioUser?.discordId) {
                console.log(`[PROFILE_INFO] Founder has no Discord ID, skipping notification`);
                continue;
              }
              
              const founderUser = await client.users.fetch(founder.bioUser.discordId);
              
              if (founderUser) {
                // Format scientific URLs for display
                const formattedScientificUrls = scientificProfileUrls.length > 0 
                  ? scientificProfileUrls.map((url, index) => `• ${index + 1}. ${url}`).join('\n')
                  : '• No scientific profiles provided';
                
                const profileUpdateNotification = `
📝 **Member ${isUpdate ? 'Profile Update' : 'Profile Submission'}!**

Member **${message.author.tag}** has ${isUpdate ? 'updated their' : 'shared their'} profile information:

${linkedinUrl ? `• **LinkedIn:** ${linkedinUrl}` : '• No LinkedIn provided'}

**Scientific Profiles:**
${formattedScientificUrls}

${motivationToJoin ? `• **Motivation:** ${motivationToJoin}` : '• No motivation provided'}

${scientificProfileUrls.length > 0 ? '**✅ Recommendation: Consider scheduling a 1:1 meeting with this member to discuss research collaboration opportunities.**' : ''}

You might want to connect with them${isUpdate ? ' about their updated information' : ' and welcome them to the community'}!
`;
                await founderUser.send(profileUpdateNotification);
                console.log(`[PROFILE_INFO] Sent profile ${isUpdate ? 'update' : 'submission'} notification to founder ${founderUser.tag}`);
              }
            } catch (error) {
              console.error(`[PROFILE_INFO] Error sending profile update to founder ${founder.bioUser.discordId}:`, error);
            }
          }
        }
      }
    } catch (error) {
      console.error(`[PROFILE_INFO] Error notifying founders about profile update:`, error);
    }
  } catch (error) {
    console.error(`[PROFILE_INFO] Error handling profile info response:`, error);
    // Send an error message to the user
    try {
      await message.reply("Sorry, there was an error processing your information. Please try again later or contact an administrator.");
    } catch (replyError) {
      console.error(`[PROFILE_INFO] Error sending error reply:`, replyError);
    }
  }
}

// Add this after the existing message listener that handles profileInfo responses
// Handle direct messages to the bot for meeting requests
client.on(Events.MessageCreate, async (message) => {
  // Ignore messages from bots or non-DM messages
  if (message.author.bot || message.channel.type !== 1) return;
  
  // Check if we're waiting for a meeting response
  const pendingResponse = pendingResponses.get(message.author.id);
  if (!pendingResponse || pendingResponse.responseType !== 'meeting') return;
  
  try {
    const content = message.content.toLowerCase().trim();
    
    // Remove the pending response
    pendingResponses.delete(message.author.id);
    
    // Handle positive response
    if (content === 'yes' || content === 'sure' || content === 'ok' || content === 'okay' || content === 'interested') {
      await message.reply("Great! I've notified our founders of your interest. Someone will reach out to schedule a 1:1 meeting with you soon.");
      
      // Notify founders of the interest
      const guildId = pendingResponse.guildId;
      const discordRecord = await prisma.discord.findFirst({
        where: { serverId: guildId }
      });
      
      if (discordRecord) {
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
        
        if (project && project.members) {
          for (const founder of project.members.filter((m: any) => m.bioUser?.discordId)) {
            try {
              if (!founder.bioUser?.discordId) continue;
              
              const founderUser = await client.users.fetch(founder.bioUser.discordId);
              if (founderUser) {
                await founderUser.send(`
🔔 **1:1 Meeting Request**

Member **${message.author.tag}** has expressed interest in a 1:1 meeting to discuss research collaboration opportunities!

Please consider reaching out to schedule a meeting at your earliest convenience.
`);
              }
            } catch (error) {
              console.error(`[MEETING_REQUEST] Error notifying founder of meeting request:`, error);
            }
          }
        }
      }
    } else {
      // Handle negative response
      await message.reply("No problem! If you change your mind in the future, feel free to let us know.");
    }
  } catch (error) {
    console.error(`[MEETING_REQUEST] Error processing meeting request response:`, error);
    await message.reply("Sorry, there was an error processing your response. Please try again later.");
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
            members: {
              where: { role: "founder" },
              include: {
                bioUser: true
              }
            }
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
            if (project.members[0].bioUser.email) {
              //if there is more than one member, send the email to both founders
              if (project.members.length > 1) {
                await sendLevelUpEmail(project.members[0].bioUser.email, 4);
                await sendLevelUpEmail(project.members[1]?.bioUser.email || '', 4);
              }
              else {
                await sendLevelUpEmail(project.members[0].bioUser.email, 4);
              }
              
            }
            await sendSandboxEmail(project);
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
        Authorization: `Bearer ${PORTAL_API_KEY}`,
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

      // Send DM to project founders
      try {
        // Find the Discord record for this server
        const discordRecord = await prisma.discord.findFirst({ 
          where: { serverId: guild.id } 
        });
        
        if (discordRecord) {
          console.log(`[Discord] Found Discord record for server ${guild.id}, project ID: ${discordRecord.projectId}`);
          
          // Find the project to get the founders
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
            console.log(`[Discord] Found ${project.members.length} founders for project ${project.id}`);
            
            // For each founder with a Discord ID, send a DM
            for (const founderMember of project.members) {
              if (founderMember.bioUser && founderMember.bioUser.discordId) {
                try {
                  // Try to fetch the Discord user object for this founder
                  const founderUser = await client.users.fetch(founderMember.bioUser.discordId);
                  
                  if (founderUser) {
                    // Create and send a detailed notification message about the new member
                    const dmMessage = `👋 **New Member Alert!**

A new member has joined your BioDAO community server: **${guild.name}**

**Member Details:**
• **Username:** ${member.user.tag}
• **Discord ID:** ${member.id}
• **Joined:** ${new Date().toLocaleString()}

Consider reaching out to welcome them to your BioDAO community!`;

                    //await founderUser.send(dmMessage);
                    console.log(`[Discord] Sent DM to founder ${founderUser.tag} (${founderMember.bioUser.id})`);
                  }
                } catch (dmError) {
                  console.error(`[Discord] Failed to send DM to founder ${founderMember.bioUser.discordId}:`, dmError);
                }
              }
            }
          } else {
            console.log(`[Discord] No founders found for project ${discordRecord.projectId}`);
          }
        } else {
          console.log(`[Discord] No Discord record found for server ${guild.id}`);
        }
      } catch (error) {
        console.error(`[Discord] Error sending founder DMs:`, error);
      }

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

// Add this after the Events.MessageCreate listener that handles DM responses:

// Handle direct messages to the bot for profile updates
client.on(Events.MessageCreate, async (message) => {
  // Ignore messages from bots or messages that aren't direct messages
  if (message.author.bot || message.channel.type !== 1) return;
  
  // Check if this is a message that isn't already being processed by a collector
  const pendingResponse = pendingResponses.get(message.author.id);
  if (pendingResponse) return; // Already being processed by a collector
  
  // Check if this is a profile update request
  const content = message.content.toLowerCase().trim();
  if (content === 'update profile' || content === 'profile update' || content === 'update my profile') {
    try {
      console.log(`[DM_HANDLER] Received profile update request from ${message.author.tag}`);
      
      // Find which servers this user is a member of
      const userDiscordServers = await prisma.discordMember.findMany({
        where: { discordId: message.author.id },
        include: {
          discord: {
            include: {
              project: true
            }
          }
        }
      });
      
      if (!userDiscordServers || userDiscordServers.length === 0) {
        await message.reply("I couldn't find you in any BioDAO servers. Please join a server first.");
        return;
      }
      
      // If user is in multiple servers, ask which one they want to update for
      if (userDiscordServers.length > 1) {
        const serverOptions = userDiscordServers.map((server, index) => 
          `${index + 1}. ${server.discord?.project?.projectName || server.discord?.serverName || 'Unknown Server'}`
        ).join('\n');
        
        await message.reply(`You're a member of multiple BioDAO servers. Please specify which one you'd like to update your profile for by replying with the number:\n\n${serverOptions}\n\nOr reply "all" to update for all servers.`);
        
        // Set up a response collector for server selection
        pendingResponses.set(message.author.id, { 
          responseType: 'serverSelection',
          guildId: 'multiple',
          servers: userDiscordServers
        } as PendingResponse);
        return;
      }
      
      // User is only in one server
      const serverId = userDiscordServers[0].discordServerId;
      
      // Send profile update instructions
      await message.reply(`
I'll help you update your profile information for the BioDAO community. Please provide:

1. Your LinkedIn profile URL (optional)
2. Your scientific profile URL (e.g., Google Scholar, ORCID, ResearchGate) (optional)
3. What motivated you to join this BioDAO community? (optional)

You can include all of these in a single message. If you don't want to provide some information, just omit it.
`);
      
      // Set up pending response for profile info
      pendingResponses.set(message.author.id, { 
        guildId: serverId, 
        responseType: 'profileInfo' 
      });
      
    } catch (error) {
      console.error(`[DM_HANDLER] Error handling profile update request:`, error);
      await message.reply("Sorry, there was an error processing your request. Please try again later.");
    }
  }
});

// Add this after the existing message listener that handles profileInfo responses

// Update the Events.MessageCreate listener to handle server selection
client.on(Events.MessageCreate, async (message) => {
  // Ignore messages from bots or messages that aren't DMs
  if (message.author.bot || message.channel.type !== 1) return;
  
  // Check if we're waiting for a server selection from this user
  const pendingResponse = pendingResponses.get(message.author.id);
  if (!pendingResponse || pendingResponse.responseType !== 'serverSelection') return;
  
  try {
    const content = message.content.toLowerCase().trim();
    
    // Remove the pending response as we'll process it now
    pendingResponses.delete(message.author.id);
    
    const servers = pendingResponse.servers || [];
    
    // Handle "all" response
    if (content === 'all') {
      // Send instructions for updating profile
      await message.reply(`
I'll help you update your profile information for all your BioDAO communities. Please provide:

1. Your LinkedIn profile URL (optional)
2. Your scientific profile URL (e.g., Google Scholar, ORCID, ResearchGate) (optional)
3. What motivated you to join these BioDAO communities? (optional)

You can include all of these in a single message. If you don't want to provide some information, just omit it.
`);
      
      // Set up pending response for all servers
      pendingResponses.set(message.author.id, { 
        guildId: 'all', 
        responseType: 'profileInfo',
        servers: servers
      } as PendingResponse);
      return;
    }
    
    // Handle numeric selection
    const selection = parseInt(content);
    if (isNaN(selection) || selection < 1 || selection > servers.length) {
      await message.reply(`Invalid selection. Please reply with a number between 1 and ${servers.length}, or "all".`);
      
      // Re-set the pending response since it was invalid
      pendingResponses.set(message.author.id, pendingResponse);
      return;
    }
    
    // Valid selection
    const selectedServer = servers[selection - 1];
    
    // Send instructions for the selected server
    await message.reply(`
I'll help you update your profile information for ${selectedServer.discord?.project?.projectName || selectedServer.discord?.serverName || 'the selected community'}. Please provide:

1. Your LinkedIn profile URL (optional)
2. Your scientific profile URL (e.g., Google Scholar, ORCID, ResearchGate) (optional)
3. What motivated you to join this BioDAO community? (optional)

You can include all of these in a single message. If you don't want to provide some information, just omit it.
`);
    
    // Set up pending response for the selected server
    pendingResponses.set(message.author.id, { 
      guildId: selectedServer.discordServerId, 
      responseType: 'profileInfo' 
    });
    
  } catch (error) {
    console.error(`[SERVER_SELECTION] Error handling server selection:`, error);
    await message.reply("Sorry, there was an error processing your selection. Please try again by sending 'update profile'.");
  }
});

// Update the existing MessageCreate listener that processes profileInfo responses
client.on(Events.MessageCreate, async (message) => {
  // Ignore messages from bots (including ourselves)
  if (message.author.bot) return;
  
  // Ignore non-DM messages
  if (message.channel.type !== 1) return; // ChannelType.DM === 1
  
  // Check if we're waiting for a response from this user
  const pendingResponse = pendingResponses.get(message.author.id);
  if (!pendingResponse) return;
  
  try {
    // Handle the response based on its type
    if (pendingResponse.responseType === 'profileInfo') {
      // Handle the case where user wants to update profile for all servers
      if (pendingResponse.guildId === 'all' && pendingResponse.servers && pendingResponse.servers.length > 0) {
        for (const server of pendingResponse.servers) {
          await handleProfileInfoResponse(message, server.discordServerId);
        }
        // Remove the pending response
        pendingResponses.delete(message.author.id);
        
        // Send a confirmation for multiple updates
        await message.reply("Your profile has been updated across all your BioDAO communities!");
      } else {
        // Regular single-server update
        await handleProfileInfoResponse(message, pendingResponse.guildId);
        // Remove the pending response
        pendingResponses.delete(message.author.id);
      }
    }
    // Other response types can be handled here as needed
  } catch (error) {
    console.error(`[RESPONSE_HANDLER] Error handling DM response:`, error);
    pendingResponses.delete(message.author.id);
    await message.reply("Sorry, an error occurred while processing your response. Please try again by sending 'update profile'.");
  }
});

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
    if (profileData.linkedIn && (!memberRecord || memberRecord.linkedinUrl !== profileData.linkedIn)) {
      updateType = 'LinkedIn';
    } else if (profileData.scientificBackground && (!memberRecord || !memberRecord.scientificProfiles || memberRecord.scientificProfiles.length === 0)) {
      updateType = 'scientific profiles';
    } else if (profileData.researchPapers) {
      updateType = 'research papers';
    } else if (profileData.isComplete) {
      updateType = 'completed profile';
    }
    
    // Compile profile info for the notification
    const linkedInInfo = profileData.linkedIn ? `\n**LinkedIn:** ${profileData.linkedIn}` : "\n**LinkedIn:** Not provided";
    
    // Format scientific profiles nicely
    let scientificProfilesInfo = "\n**Scientific Profiles:** Not provided";
    if (memberRecord?.scientificProfiles && memberRecord.scientificProfiles.length > 0) {
      scientificProfilesInfo = "\n**Scientific Profiles:**";
      memberRecord.scientificProfiles.forEach(profile => {
        scientificProfilesInfo += `\n• ${profile.platform}: ${profile.url}`;
      });
    } else if (profileData.scientificBackground) {
      scientificProfilesInfo = `\n**Scientific Profiles:** ${profileData.scientificBackground}`;
    }
    
    const papersInfo = profileData.researchPapers ? 
      `\n**Research Papers:** ${profileData.researchPapers.substring(0, 200)}${profileData.researchPapers.length > 200 ? '...' : ''}` : 
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



