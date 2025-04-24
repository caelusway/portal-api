import axios from 'axios';
import { Client, GatewayIntentBits } from 'discord.js';
import config from '../config';

// Create Discord client with necessary intents
let discordClient: Client | null = null;

/**
 * Initialize Discord client
 * @returns Discord client
 */
export function initDiscordClient(): Client | null {
  if (!config.discord.botToken) {
    console.warn('Discord bot token not provided. Discord bot will not be initialized.');
    return null;
  }

  try {
    const client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers,
      ],
    });

    // Log in to Discord
    client
      .login(config.discord.botToken)
      .then(() => {
        console.log('Discord bot is online!');
        discordClient = client;
      })
      .catch((error) => {
        console.error('Failed to log in to Discord:', error);
        discordClient = null;
      });

    return client;
  } catch (error) {
    console.error('Error initializing Discord client:', error);
    return null;
  }
}

/**
 * Get Discord client
 * @returns Discord client
 */
export function getDiscordClient(): Client | null {
  return discordClient;
}

/**
 * Fetch Discord server info from invite code
 * @param inviteCode Discord invite code
 * @returns Server info
 */
export async function fetchDiscordServerInfo(inviteCode: string): Promise<{
  serverId: string | null;
  error?: string;
  memberCount?: number;
  approximateMemberCount?: number;
  name?: string;
  icon?: string;
}> {
  try {
    // Try to fetch using Discord API
    const response = await axios.get(
      `https://discord.com/api/v10/invites/${inviteCode}?with_counts=true`,
      {
        headers: {
          'User-Agent': 'DiscordBot (https://bio.xyz, 1.0.0)',
        },
      }
    );

    const data = response.data;

    if (!data || !data.guild) {
      return {
        serverId: null,
        error: 'Invalid invite or unable to fetch server info',
      };
    }

    return {
      serverId: data.guild.id,
      name: data.guild.name,
      icon: data.guild.icon,
      memberCount: data.member_count,
      approximateMemberCount: data.approximate_member_count,
    };
  } catch (error) {
    console.error('Error fetching Discord server info:', error);
    return {
      serverId: null,
      error: 'Failed to fetch server info',
    };
  }
}
