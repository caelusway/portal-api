import axios from 'axios';
import config from '../config';

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
