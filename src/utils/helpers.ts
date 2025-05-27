/**
 * Generates a verification token for a Discord server
 * @param userId User ID
 * @param serverId Discord server ID
 * @returns Verification token string
 */
export function generateVerificationToken(userId: string, serverId: string): string {
  const combinedString = `${userId}:${serverId}:${Date.now()}`;
  return Buffer.from(combinedString).toString('base64');
}

/**
 * Simple hash code function for strings
 * @param str Input string to hash
 * @returns Numeric hash code
 */
export function hashCode(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return hash;
}

/**
 * Extracts Discord information from a message
 * @param message The message containing Discord information
 * @returns Object with serverId, inviteLink, and inviteCode
 */
export function extractDiscordInfo(message: string): {
  serverId: string | null;
  inviteLink: string | null;
  inviteCode: string | null;
} {
  // Initialize the return object
  const result: {
    serverId: string | null;
    inviteLink: string | null;
    inviteCode: string | null;
  } = {
    serverId: null,
    inviteLink: null,
    inviteCode: null,
  };

  if (!message) return result;

  // Look for Discord invite links in various formats
  const invitePatterns = [
    /discord\.gg\/([a-zA-Z0-9]+)/i,
    /discord\.com\/invite\/([a-zA-Z0-9]+)/i,
    /discordapp\.com\/invite\/([a-zA-Z0-9]+)/i,
  ];

  // Extract invite link
  for (const pattern of invitePatterns) {
    const match = message.match(pattern);
    if (match && match[0] && match[1]) {
      result.inviteLink = match[0];
      result.inviteCode = match[1];
      break;
    }
  }

  // Look for server ID format (typically 18-digit number)
  const serverIdMatch = message.match(/\b(\d{17,20})\b/);
  if (serverIdMatch && serverIdMatch[1]) {
    result.serverId = serverIdMatch[1];
  }

  return result;
}

/**
 * Checks if a message is likely low-value (spam, short, etc.)
 * @param content Message content
 * @returns True if the message is low value
 */
export function isLowValueMessage(content: string): boolean {
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

/**
 * Returns the requirements for the next level
 * @param currentLevel The user's current level
 * @returns Array of requirement strings
 */
export function getNextLevelRequirements(currentLevel: number): string[] {
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

/**
 * Generates a message for the next level requirements
 * @param currentLevel The user's current level
 * @param project Project data with Discord stats
 * @returns Formatted message explaining level requirements
 */
export function generateNextLevelRequirementsMessage(currentLevel: number, project: any): string {
  // Default message for connect wallet
  if (currentLevel === 0) {
    return `To begin your BioDAO journey, you'll need to connect your wallet first. This is the first step in building your decentralized research community.`;
  }

  // Level 1: Wallet connected, need to mint NFTs
  if (currentLevel === 1) {
    // Check if they have any NFTs already
    const ideaNft = project?.NFTs?.find((nft: any) => nft.type === 'idea');
    const visionNft = project?.NFTs?.find((nft: any) => nft.type === 'vision');

    const ideaStatus = ideaNft ? '✅' : '⬜';
    const visionStatus = visionNft ? '✅' : '⬜';

    return `## Level 1: Science NFTs
To reach Level 2, you need to mint both of your Science NFTs:

${ideaStatus} Mint your Idea NFT
${visionStatus} Mint your Vision NFT

These NFTs represent the foundation of your research and will be associated with your BioDAO. Would you like to mint one now?`;
  }

  // Level 2: Both NFTs minted, need to set up Discord
  if (currentLevel === 2) {
    const discord = project?.Discord;
    const botStatus = discord?.botAdded ? '✅' : '⬜';
    const memberCount = discord?.memberCount || 0;
    const memberStatus = memberCount >= 4 ? '✅' : '⬜';
    const discordStatus = discord ? '✅' : '⬜';

    const memberProgress = discord ? `(${memberCount}/4 members)` : '';

    return `## Level 2: Community Setup
To reach Level 3, you need to set up your community:

${discordStatus} Create a Discord server
${botStatus} Add our verification bot to your server
${memberStatus} Reach 4+ Discord members ${memberProgress}

A Discord server will be the hub for your research community, allowing members to collaborate and share papers.`;
  }

  // Level 3: Discord set up with 4+ members, growing community
  if (currentLevel === 3) {
    const discord = project?.Discord;
    if (!discord) {
      return `Your Discord server setup appears to be incomplete. Please check your Discord settings and verification status.`;
    }

    const memberCount = discord.memberCount || 0;
    const papersShared = discord.papersShared || 0;
    const messagesCount = discord.messagesCount || 0;

    const memberStatus = memberCount >= 10 ? '✅' : '⬜';
    const papersStatus = papersShared >= 25 ? '✅' : '⬜';
    const messagesStatus = messagesCount >= 100 ? '✅' : '⬜';

    return `## Level 3: Community Growth
To reach Level 4 and gain sandbox access, grow your community through:

${memberStatus} 10+ Discord members (currently: ${memberCount}/10)
${papersStatus} 25+ scientific papers shared (currently: ${papersShared}/25)
${messagesStatus} 100+ quality messages (currently: ${messagesCount}/100)

Your community's activity and knowledge sharing are key metrics for progression to sandbox access.`;
  }

  // Level 4: Max level reached
  if (currentLevel === 4) {
    return `## Level 4: Sandbox Access
Congratulations! You've reached the highest level and have full sandbox access.

The Bio team will contact you shortly to discuss:
- Your research goals and vision
- Potential funding opportunities
- Advanced resources and support available to you

Is there anything specific you'd like to know about your sandbox access?`;
  }

  // Fallback for any unexpected level
  return `You're currently at Level ${currentLevel}. Contact support for more information about your next steps.`;
}
