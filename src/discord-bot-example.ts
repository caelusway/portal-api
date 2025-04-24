import { Client, Events, GatewayIntentBits, Guild, TextChannel } from 'discord.js';
import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();

/**
 * Example Discord bot implementation for BioDAO
 *
 * This bot demonstrates how to integrate with the BioDAO Portal API
 * to report guild creation events and statistics updates.
 */

// Configuration
const BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
const PORTAL_API_URL = process.env.PORTAL_API_URL || 'http://localhost:3001';
const PORTAL_API_KEY = process.env.PORTAL_API_KEY; // For API authentication

// Create Discord client with necessary intents
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
  ],
});

// Track messages and papers per guild
const guildStats: Record<
  string,
  {
    messagesCount: number;
    papersShared: number;
    qualityScore: number;
  }
> = {};

// Initialize stats for a guild
function initGuildStats(guildId: string) {
  if (!guildStats[guildId]) {
    guildStats[guildId] = {
      messagesCount: 0,
      papersShared: 0,
      qualityScore: 0,
    };
  }
}

// Notify Portal API when bot is added to a new server
client.on(Events.GuildCreate, async (guild: Guild) => {
  console.log(`Bot added to a new guild: ${guild.name} (${guild.id})`);

  try {
    const response = await axios.post(`${PORTAL_API_URL}/discord/bot-installed`, {
      guildId: guild.id,
      guildName: guild.name,
      memberCount: guild.memberCount,
      apiKey: PORTAL_API_KEY,
    });

    console.log('Notified Portal API of bot installation:', response.data);

    // Initialize stats tracking for this guild
    initGuildStats(guild.id);
  } catch (error) {
    console.error('Failed to notify Portal API:', error);
  }
});

// Scientific paper domains used for paper detection
const SCIENTIFIC_DOMAINS = [
  'arxiv.org',
  'biorxiv.org',
  'medrxiv.org',
  'nature.com',
  'science.org',
  'cell.com',
  'pnas.org',
  'ncbi.nlm.nih.gov',
  'pubmed.gov',
];

/**
 * More strict paper detection that only identifies actual scientific papers
 * Returns true if the message contains a PDF attachment or a verified paper source
 */
function detectPaper(content: string, hasAttachments: boolean): boolean {
  // Check for PDF attachments
  if (hasAttachments && content.match(/\b\w+\.(pdf)\b/i)) {
    return true;
  }

  // Check for DOI patterns (strong evidence)
  if (content.match(/\b(doi:|doi\.org\/|10\.\d{4,}\/[\w\.\-\/]+)\b/i)) {
    return true;
  }

  // Check for specific scientific domain URLs with full URL pattern
  for (const domain of SCIENTIFIC_DOMAINS) {
    if (
      content.match(
        new RegExp(`https?:\/\/([\\w-]+\\.)*${domain.replace(/\./g, '\\.')}[\\/\\w\\.-]*`, 'i')
      )
    ) {
      return true;
    }
  }

  // Otherwise don't count as a paper
  return false;
}

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

// Track messages and detect papers
client.on(Events.MessageCreate, async (message) => {
  // Ignore bot messages
  if (message.author.bot) return;

  const guildId = message.guild?.id;
  if (!guildId) return;

  // If this is a command (starts with ! or / or similar), log but don't respond
  if (message.content.startsWith('!') || message.content.startsWith('/')) {
    console.log(`Command received but not processed (commands disabled): ${message.content}`);
    return;
  }

  // Initialize stats if needed
  initGuildStats(guildId);

  // Check if this is a low-value message that shouldn't count
  const isLowValue = isLowValueMessage(message.content);

  // Only count non-low-value messages
  if (!isLowValue) {
    // Count message
    guildStats[guildId].messagesCount++;

    // Calculate quality score (simple example based on message length)
    const quality = Math.min(message.content.length / 20, 5); // Max 5 points per message
    guildStats[guildId].qualityScore += quality;
  } else {
    console.log(
      `Low-value message ignored: "${message.content.substring(0, 30)}${message.content.length > 30 ? '...' : ''}"`
    );
  }

  // Check for paper with stricter detection logic
  const hasPaperAttachment = message.attachments.some((a) =>
    a.name?.toLowerCase().endsWith('.pdf')
  );

  if (detectPaper(message.content, hasPaperAttachment)) {
    guildStats[guildId].papersShared++;
    console.log(
      `Scientific paper detected in guild ${guildId}. Total papers: ${guildStats[guildId].papersShared}`
    );
  }

  // Log message count milestones for non-low-value messages
  if (!isLowValue) {
    const messageCount = guildStats[guildId].messagesCount;
    if (messageCount <= 5 || messageCount % 10 === 0) {
      console.log(`[Discord] Guild ${message.guild.name}: Message #${messageCount} received`);
    }

    // Real-time update to API for immediate stats update
    try {
      const response = await axios.post(`${PORTAL_API_URL}/discord/stats-update`, {
        guildId,
        messagesCount: guildStats[guildId].messagesCount,
        papersShared: guildStats[guildId].papersShared,
        qualityScore: guildStats[guildId].qualityScore,
        apiKey: PORTAL_API_KEY,
      });

      if (response?.data?.success) {
        // Only log on milestones to avoid too much console spam
        if (messageCount === 1 || messageCount % 10 === 0) {
          console.log(`[Discord] Real-time stats update successful for message #${messageCount}`);
        }
      }
    } catch (error) {
      console.error(`[Discord] Error updating stats in real-time:`, error);
      // Will be picked up by the regular hourly update
    }
  }
});

// Send updated statistics to Portal API periodically (every hour)
setInterval(
  async () => {
    for (const guildId in guildStats) {
      const guild = client.guilds.cache.get(guildId);
      if (!guild) continue;

      try {
        await axios.post(`${PORTAL_API_URL}/discord/stats-update`, {
          guildId,
          memberCount: guild.memberCount,
          messagesCount: guildStats[guildId].messagesCount,
          papersShared: guildStats[guildId].papersShared,
          qualityScore: guildStats[guildId].qualityScore,
          apiKey: PORTAL_API_KEY,
        });

        console.log(`Stats updated for guild ${guildId}`);
      } catch (error) {
        console.error(`Failed to update stats for guild ${guildId}:`, error);
      }
    }
  },
  60 * 60 * 1000
); // Every hour

// Log in to Discord
client
  .login(BOT_TOKEN)
  .then(() => {
    console.log('Bot is online!');

    // Initialize stats for all guilds the bot is already in
    client.guilds.cache.forEach((guild) => {
      initGuildStats(guild.id);
    });
  })
  .catch((error) => {
    console.error('Failed to log in:', error);
  });

// Handle process termination
process.on('SIGINT', () => {
  console.log('Bot is shutting down...');
  client.destroy();
  process.exit(0);
});
