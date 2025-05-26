import { Client, Events, GatewayIntentBits, Guild, TextChannel, Message, Attachment, ChannelType } from 'discord.js';
import axios from 'axios';
import dotenv from 'dotenv';

// DKG SDK Imports
// @ts-ignore
import DKG, { ENVIRONMENTS } from "dkg.js"; // Assuming this is the correct import
import crypto from 'crypto';
import prisma from './services/db.service'; // Added Prisma client import

dotenv.config();

/**
 * Example Discord bot implementation for BioDAO
 *
 * This bot demonstrates how to integrate with the BioDAO Portal API
 * to report guild creation events and statistics updates.
 * It also includes DKG PDF upload functionality.
 */

// Configuration
const BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
const PORTAL_API_URL = process.env.PORTAL_API_URL || 'http://localhost:3001';
const PORTAL_API_KEY = process.env.PORTAL_API_KEY; // For API authentication

// DKG Configuration
const DKG_NODE_ENDPOINT = process.env.DKG_NODE_ENDPOINT || 'http://localhost';
const DKG_NODE_PORT = parseInt(process.env.DKG_NODE_PORT || '8900', 10);
const DKG_ENVIRONMENT_NAME = process.env.DKG_ENVIRONMENT_NAME || 'development'; // e.g. 'development', 'testnet', 'mainnet'
const DKG_BLOCKCHAIN_NAME = process.env.DKG_BLOCKCHAIN_NAME || 'base:84532'; // Base Sepolia Testnet
const DKG_BLOCKCHAIN_PUBLIC_KEY = process.env.DKG_BLOCKCHAIN_PUBLIC_KEY;
const DKG_BLOCKCHAIN_PRIVATE_KEY = process.env.DKG_BLOCKCHAIN_PRIVATE_KEY;

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

let dkgClient: DKG | null = null;

interface DKGNode {
  endpoint: string;
  token?: string;
}

// Function to initialize the DKG client (simplified)
// Ensure this is called and dkgClient is initialized before handlePdfUploadToDKG
async function initDKGClient() {
  const DKG_RPC_ENDPOINT = process.env.DKG_RPC_ENDPOINT;
  const DKG_NODE_TOKEN = process.env.DKG_NODE_TOKEN; // Optional: if your node requires a token

  if (!DKG_RPC_ENDPOINT) {
    console.error('DKG_RPC_ENDPOINT is not defined in .env');
    return null;
  }

  try {
    // Example initialization. Adjust based on actual dkg.js SDK usage
    dkgClient = new DKG({
      environment: process.env.NODE_ENV === 'production' ? ENVIRONMENTS.MAINNET : ENVIRONMENTS.TESTNET, // Or your specific environment
      endpoint: DKG_RPC_ENDPOINT,
      nodeToken: DKG_NODE_TOKEN, // Pass token if needed
      blockchain: {
        name: DKG_BLOCKCHAIN_NAME,
        publicKey: DKG_BLOCKCHAIN_PUBLIC_KEY,
        privateKey: DKG_BLOCKCHAIN_PRIVATE_KEY,
      }
    });
    console.log('DKG Client Initialized');
    return dkgClient;
  } catch (error) {
    console.error('Failed to initialize DKG Client:', error);
    return null;
  }
}

// Call initDKGClient during bot startup
// initDKGClient(); // This should be called appropriately in your bot's main startup sequence

// Mock DKG upload function - replace with your actual DKG upload logic
// This function should return the DKG hash (UAL) upon successful upload.
async function performDKGUpload(attachment: Attachment, dkg: DKG): Promise<string | null> {
  try {
    console.log(`[DKG] Starting upload for: ${attachment.name}`);
    const response = await fetch(attachment.url);
    if (!response.ok) {
      console.error(`[DKG] Failed to download attachment: ${response.statusText}`);
      return null;
    }
    const fileBuffer = await response.arrayBuffer();
    const fileContentBuffer = Buffer.from(fileBuffer);

    // Construct the content object based on DKG SDK documentation
    const content = {
      public: {
        // Using schema.org context as shown in the DKG SDK example for public assertions
        '@context': 'http://schema.org',
        // Generate a unique ID for this asset, e.g., based on filename or a UUID
        '@id': `urn:pdf:${attachment.id}:${attachment.name}`,
        '@type': 'DigitalDocument', // Or a more specific schema type for a PDF
        name: attachment.name,
        encodingFormat: attachment.contentType || 'application/pdf',
        size: attachment.size,
        sha256: crypto.createHash('sha256').update(fileContentBuffer).digest('hex'),
        // You could add more public metadata here if needed
        // e.g., uploaderDiscordId: message.author.id (if message object is available here or passed)
      },
      private: {
        // For the private part, you might include the actual file content
        // or a more detailed private description. The SDK docs show structured private data.
        // For this example, let's keep it simple. You might store the actual buffer if desired
        // but be mindful of size limitations and DKG best practices for private assertions.
        // The DKG SDK example shows structured data here as well.
        // If you intend to store the raw PDF as a private assertion, ensure your DKG node
        // and network configuration can handle potentially large private data.
        // For now, let's add a placeholder or a reference.
        '@context': 'http://schema.org',
        '@id': `urn:pdf:${attachment.id}:${attachment.name}:privateContent`,
        '@type': 'DigitalDocumentPrivateData',
        // Example of how you might reference the content if not storing directly:
        // contentReference: 'Stored internally, hash matches public sha256' 
        // OR if you were to store the buffer (ensure SDK supports Buffer type directly for private assertions):
        // rawContentBase64: fileContentBuffer.toString('base64'),
        description: `Private assertion for PDF: ${attachment.name}`
      },
    };

    console.log('[DKG] Attempting to create asset with content:', JSON.stringify(content, null, 2));

    // Call dkg.asset.create with the content and options
    // The SDK documentation shows: await DkgClient.asset.create(content, { epochsNum: 6 });
    // Assuming 'dkg' is your initialized DkgClient instance.
    const createResult = await dkg.asset.create(content, {
      epochsNum: 6, // Example: number of epochs, adjust as needed
      // Add other options like keywords, visibility, etc., if supported and desired.
      // keywords: ['pdf', 'document', attachment.name.split('.')[0]],
    });

    if (createResult && createResult.UAL) {
      console.log(`[DKG] Asset created successfully. UAL: ${createResult.UAL}`);
      return createResult.UAL;
    } else {
      console.error('[DKG] Asset creation failed or UAL not returned.', createResult);
      return null;
    }
  } catch (error) {
    console.error('[DKG] Error during DKG upload:', error);
    return null;
  }
}

async function handlePdfUploadToDKG(message: Message, attachment: Attachment) {
  if (!dkgClient) {
    console.error('DKG client is not initialized. Aborting PDF upload.');
    await message.reply('Sorry, the DKG service is not available right now. Please try again later.');
    return;
  }

  if (!message.guild || !message.guild.id) {
    console.error('[DKG Upload] Message is not from a guild or guild ID is missing.');
    await message.reply('This command can only be used in a server.');
    return;
  }
  const guildId = message.guild.id;

  let projectId: string | null = null;
  try {
    const discordRecord = await prisma.discord.findUnique({
      where: { serverId: guildId },
      select: { projectId: true }
    });

    if (discordRecord && discordRecord.projectId) {
      projectId = discordRecord.projectId;
    } else {
      console.error(`[DKG Upload] Could not find project associated with Discord server ID: ${guildId}.`);
      await message.reply('This Discord server is not linked to a project. Please contact an admin.');
      return;
    }
  } catch (dbError) {
    console.error(`[DKG Upload] Database error while fetching project ID for guild ${guildId}:`, dbError);
    await message.reply('There was an issue accessing project data. Please try again.');
    return;
  }

  if (!projectId) { // Should be caught by previous checks, but as a safeguard
      console.error(`[DKG Upload] Project ID is null for guild ${guildId} after DB check.`);
      await message.reply('Could not determine the project for this upload. Please contact an admin.');
      return;
  }
  

  try {
    await message.reply(`Processing PDF: ${attachment.name} for DKG upload. This might take a moment...`);

    // const dkgHash = await mockDkgUpload(attachment); // Use your actual DKG upload function
    // Ensure your DKG client is initialized and passed to performDKGUpload if it's an instance method
    const dkgHash = await performDKGUpload(attachment, dkgClient);


    if (dkgHash) {
      // Save the DKG hash to the database
      await prisma.dKGFile.create({
        data: {
          hash: dkgHash,
          filename: attachment.name,
          projectId: projectId, // Use the projectId found via guildId
        },
      });

      console.log(`[DKG Upload] Successfully uploaded ${attachment.name} to DKG. Hash: ${dkgHash}. Saved to DB for project ${projectId}.`);
      await message.reply(`Successfully uploaded \`${attachment.name}\` to DKG! Asset UAL: \`${dkgHash}\``);
      
      // You might want to notify the portal API or perform other actions here
      // e.g., await notifyPortalAPIOfNewDKGAsset(projectId, dkgHash, attachment.name);

    } else {
      console.error(`[DKG Upload] Failed to upload ${attachment.name} to DKG or hash was null.`);
      await message.reply(`Failed to upload \`${attachment.name}\` to DKG. Please check the logs or try again.`);
    }
  } catch (error) {
    console.error(`[DKG Upload] Error handling PDF upload for ${attachment.name}:`, error);
    await message.reply(`An error occurred while processing your PDF: ${attachment.name}.`);
  }
}

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

  // Get Discord record for paper storage
  const discordRecord = await prisma.discord.findFirst({
    where: { serverId: guildId }
  });

  // --- Enhanced PDF and Paper Detection ---
  let paperDetected = false;
  const detectedPapers: PaperMetadata[] = [];
  
  // Check attachments for PDFs
  if (message.attachments.size > 0) {
    for (const attachment of message.attachments.values()) {
      if (attachment.contentType?.startsWith('application/pdf') || attachment.name?.toLowerCase().endsWith('.pdf')) {
        console.log(`[PDF_DETECT] PDF detected: ${attachment.name} in guild ${guildId}`);
        paperDetected = true;
        
        // Extract metadata for PDF attachment
        const pdfMetadata = await extractPaperMetadata(attachment.url, message.content);
        pdfMetadata.title = pdfMetadata.title || attachment.name?.replace('.pdf', '') || 'Untitled PDF';
        pdfMetadata.platform = 'pdf';
        detectedPapers.push(pdfMetadata);

        // --- DKG PDF Upload Handling ---
        if (dkgClient && attachment.url) {
          handlePdfUploadToDKG(message, attachment)
            .then(() => console.log(`[DKG] Finished background processing PDF: ${attachment.name} from guild ${guildId}`))
            .catch(err => console.error(`[DKG] Background PDF processing error for ${attachment.name} from guild ${guildId}:`, err));
        } else {
          console.warn(`[DKG] PDF attachment \"${attachment.name}\" in guild ${guildId} has no URL or DKG client not initialized.`);
        }
      }
    }
  }
  
  // Check for paper links in message content
  const paperUrls = extractPaperUrls(message.content);
  for (const url of paperUrls) {
    paperDetected = true;
    const paperMetadata = await extractPaperMetadata(url, message.content);
    detectedPapers.push(paperMetadata);
  }
  
  // Save all detected papers to database
  if (detectedPapers.length > 0 && discordRecord) {
    for (const paperMetadata of detectedPapers) {
      await savePaperToDatabase(paperMetadata, message, discordRecord);
    }
  }

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
      `Low-value message ignored example: "${message.content.substring(0, 30)}${message.content.length > 30 ? '...' : ''}"`
    );
  }

  // Update paper count if any papers were detected
  if (paperDetected) {
    guildStats[guildId].papersShared += detectedPapers.length;
    console.log(`[PAPER_TRACK] Paper count increased by ${detectedPapers.length} to ${guildStats[guildId].papersShared} in guild ${guildId}`);
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
  .then(async () => {
    console.log('Bot is online!');

    // Initialize DKG Client
    dkgClient = await initDKGClient();

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

// Paper metadata interface
interface PaperMetadata {
  url: string;
  title?: string;
  authors?: string;
  doi?: string;
  platform?: string;
}

/**
 * Extract paper URLs from message content
 */
function extractPaperUrls(content: string): string[] {
  const urls: string[] = [];
  
  // DOI patterns
  const doiMatches = content.match(/(?:https?:\/\/)?(?:www\.)?doi\.org\/10\.\d{4,}\/[\w\.\-\/\(\)]+/gi);
  if (doiMatches) {
    urls.push(...doiMatches.map(url => url.startsWith('http') ? url : `https://doi.org/${url.replace(/^doi\.org\//, '')}`));
  }
  
  // Scientific domain URLs
  for (const domain of SCIENTIFIC_DOMAINS) {
    const regex = new RegExp(`https?:\\/\\/([\\w-]+\\.)*${domain.replace(/\./g, '\\.')}[\\/\\w\\.-]*`, 'gi');
    const matches = content.match(regex);
    if (matches) {
      urls.push(...matches);
    }
  }
  
  // Generic URL pattern for potential papers
  const genericUrls = content.match(/https?:\/\/[^\s]+\.pdf/gi);
  if (genericUrls) {
    urls.push(...genericUrls);
  }
  
  return [...new Set(urls)]; // Remove duplicates
}

/**
 * Extract paper metadata from URL and content
 */
async function extractPaperMetadata(url: string, content?: string): Promise<PaperMetadata> {
  const metadata: PaperMetadata = { url };
  
  // Detect platform based on URL
  if (url.includes('arxiv.org')) {
    metadata.platform = 'arxiv';
    // Extract arXiv ID and try to get title
    const arxivMatch = url.match(/arxiv\.org\/(?:abs|pdf)\/(\d{4}\.\d{4,5})/);
    if (arxivMatch) {
      metadata.doi = `arXiv:${arxivMatch[1]}`;
    }
  } else if (url.includes('nature.com')) {
    metadata.platform = 'nature';
  } else if (url.includes('science.org')) {
    metadata.platform = 'science';
  } else if (url.includes('cell.com')) {
    metadata.platform = 'cell';
  } else if (url.includes('biorxiv.org')) {
    metadata.platform = 'biorxiv';
  } else if (url.includes('medrxiv.org')) {
    metadata.platform = 'medrxiv';
  } else if (url.includes('pubmed') || url.includes('ncbi.nlm.nih.gov')) {
    metadata.platform = 'pubmed';
  } else if (url.includes('researchgate.net')) {
    metadata.platform = 'researchgate';
  } else if (url.toLowerCase().endsWith('.pdf')) {
    metadata.platform = 'pdf';
  }
  
  // Extract DOI from URL or content
  const doiMatch = (url + ' ' + (content || '')).match(/(?:doi:|doi\.org\/|10\.\d{4,}\/)(10\.\d{4,}\/[\w\.\-\/\(\)]+)/i);
  if (doiMatch) {
    metadata.doi = doiMatch[1];
  }
  
  // Try to extract title from content if available
  if (content) {
    // Look for common title patterns in Discord messages
    const titlePatterns = [
      /"([^"]{10,200})"/,  // Quoted titles
      /title:\s*([^\n]{10,200})/i,  // "title: ..."
      /paper:\s*([^\n]{10,200})/i,  // "paper: ..."
    ];
    
    for (const pattern of titlePatterns) {
      const match = content.match(pattern);
      if (match && match[1]) {
        metadata.title = match[1].trim();
        break;
      }
    }
  }
  
  return metadata;
}

/**
 * Save detected paper to database
 */
async function savePaperToDatabase(
  paperMetadata: PaperMetadata,
  message: Message,
  discordRecord: any
): Promise<void> {
  try {
    console.log(`[PAPER_SAVE] Saving paper to database: ${paperMetadata.url}`);
    
    // Check if this paper URL was already shared in this Discord server
    const existingPaper = await prisma.discordPaper.findFirst({
      where: {
        url: paperMetadata.url,
        discordId: discordRecord.id
      }
    });
    
    if (existingPaper) {
      console.log(`[PAPER_SAVE] Paper already exists in database: ${paperMetadata.url}`);
      return;
    }
    
    // Create new paper record
    await prisma.discordPaper.create({
      data: {
        url: paperMetadata.url,
        title: paperMetadata.title,
        authors: paperMetadata.authors,
        doi: paperMetadata.doi,
        platform: paperMetadata.platform,
        messageId: message.id,
        channelId: message.channel.id,
        userId: message.author.id,
        username: message.author.tag,
        discordId: discordRecord.id,
      }
    });
    
    console.log(`[PAPER_SAVE] Successfully saved paper: ${paperMetadata.url} by ${message.author.tag}`);
  } catch (error) {
    console.error(`[PAPER_SAVE] Error saving paper to database:`, error);
  }
}
