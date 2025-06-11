import prisma from './db.service';
import { PrismaTransactionClient } from './db.service';

// Scoring configuration
export const SCORING_CONFIG = {
  POINTS: {
    // Base points for activities
    MESSAGE: 1,
    QUALITY_MESSAGE: 3,      // Messages above quality threshold
    PAPER_SHARE: 10,         // Sharing scientific papers
    ARXIV_PAPER: 15,         // arXiv papers get bonus
    PEER_REVIEWED: 20,       // Peer-reviewed papers get more
    FIRST_POST_OF_DAY: 5,    // Bonus for first post of the day
    LONG_MESSAGE: 2,         // Messages over 100 characters
    
    // Weekly/Monthly bonuses
    WEEKLY_STREAK: 10,       // Bonus for posting multiple days in a week
    MONTHLY_CONSISTENCY: 25, // Bonus for consistent monthly activity
  },
  
  MULTIPLIERS: {
    SCIENTIST_VERIFIED: 1.5,  // Verified scientists get 1.5x points
    EARLY_ADOPTER: 1.2,       // First 50 members get 1.2x points
    QUALITY_THRESHOLD: 70,    // Quality score threshold for bonus points
  },
  
  BADGES: {
    EARLY_ADOPTER: { requirement: 'first_50_members', points: 100 },
    PAPER_EXPERT: { requirement: 'shared_50_papers', points: 500 },
    DISCUSSION_LEADER: { requirement: '500_quality_messages', points: 300 },
    STREAK_MASTER: { requirement: '30_day_streak', points: 200 },
    ONBOARDING_CHAMPION: { requirement: 'completed_onboarding', points: 50 },
  }
};

export interface PointsCalculation {
  basePoints: number;
  qualityBonus: number;
  streakBonus: number;
  multiplier: number;
  totalPoints: number;
  badgeEarned?: string;
}

/**
 * Calculate points for a message activity
 */
export async function calculateMessagePoints(
  memberId: string,
  messageContent: string,
  messageQuality: number = 50
): Promise<PointsCalculation> {
  const member = await prisma.discordMember.findUnique({
    where: { id: memberId },
    include: { scientificProfiles: true }
  });

  if (!member) throw new Error('Member not found');

  let basePoints = SCORING_CONFIG.POINTS.MESSAGE;
  let qualityBonus = 0;
  let streakBonus = 0;

  // Quality bonus
  if (messageQuality >= SCORING_CONFIG.MULTIPLIERS.QUALITY_THRESHOLD) {
    basePoints = SCORING_CONFIG.POINTS.QUALITY_MESSAGE;
    qualityBonus = 2;
  }

  // Length bonus
  if (messageContent.length > 100) {
    basePoints += SCORING_CONFIG.POINTS.LONG_MESSAGE;
  }

  // Check if first post of the day
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  
  const todayActivity = await prisma.memberActivity.findFirst({
    where: {
      memberId,
      activityType: 'message',
      createdAt: { gte: today }
    }
  });

  if (!todayActivity) {
    basePoints += SCORING_CONFIG.POINTS.FIRST_POST_OF_DAY;
    streakBonus = SCORING_CONFIG.POINTS.FIRST_POST_OF_DAY;
  }

  // Calculate multiplier
  let multiplier = member.qualityMultiplier;
  
  // Scientist bonus
  if (member.scientificProfiles.length > 0) {
    multiplier *= SCORING_CONFIG.MULTIPLIERS.SCIENTIST_VERIFIED;
  }

  // Early adopter bonus
  const memberRank = await getMemberJoinRank(member.discordServerId, member.joinedAt);
  if (memberRank <= 50) {
    multiplier *= SCORING_CONFIG.MULTIPLIERS.EARLY_ADOPTER;
  }

  const totalPoints = Math.round((basePoints + qualityBonus) * multiplier + streakBonus);

  return {
    basePoints,
    qualityBonus,
    streakBonus,
    multiplier,
    totalPoints
  };
}

/**
 * Calculate points for paper sharing activity
 */
export async function calculatePaperPoints(
  memberId: string,
  paperUrl: string,
  paperPlatform: string = 'unknown'
): Promise<PointsCalculation> {
  const member = await prisma.discordMember.findUnique({
    where: { id: memberId },
    include: { scientificProfiles: true }
  });

  if (!member) throw new Error('Member not found');

  let basePoints = SCORING_CONFIG.POINTS.PAPER_SHARE;

  // Platform-specific bonuses
  if (paperPlatform === 'arxiv') {
    basePoints = SCORING_CONFIG.POINTS.ARXIV_PAPER;
  } else if (['nature', 'science', 'cell', 'plos', 'frontiers'].includes(paperPlatform)) {
    basePoints = SCORING_CONFIG.POINTS.PEER_REVIEWED;
  }

  // Multiplier for verified scientists
  let multiplier = member.qualityMultiplier;
  if (member.scientificProfiles.length > 0) {
    multiplier *= SCORING_CONFIG.MULTIPLIERS.SCIENTIST_VERIFIED;
  }

  const totalPoints = Math.round(basePoints * multiplier);

  return {
    basePoints,
    qualityBonus: 0,
    streakBonus: 0,
    multiplier,
    totalPoints
  };
}

/**
 * Award points to a member and update their score
 */
export async function awardPoints(
  memberId: string,
  activityType: string,
  points: number,
  description?: string,
  metadata?: any
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    // Record the activity
    await tx.memberActivity.create({
      data: {
        memberId,
        activityType,
        points,
        description,
        metadata
      }
    });

    // Update member's total points
    const member = await tx.discordMember.findUnique({
      where: { id: memberId }
    });

    if (!member) return;

    const newTotalPoints = member.totalPoints + points;
    const newMessagePoints = activityType.includes('message') 
      ? member.messagePoints + points 
      : member.messagePoints;
    const newPaperPoints = activityType.includes('paper') 
      ? member.paperPoints + points 
      : member.paperPoints;

    await tx.discordMember.update({
      where: { id: memberId },
      data: {
        totalPoints: newTotalPoints,
        messagePoints: newMessagePoints,
        paperPoints: newPaperPoints,
        lastActivityDate: new Date(),
        weeklyPoints: { increment: points },
        monthlyPoints: { increment: points }
      }
    });

    // Check for badge achievements
    await checkAndAwardBadges(tx, memberId);
  });
}

/**
 * Check and award badges based on member activities
 */
async function checkAndAwardBadges(
  tx: PrismaTransactionClient, 
  memberId: string
): Promise<void> {
  const member = await tx.discordMember.findUnique({
    where: { id: memberId },
    include: { 
      badges: true,
      activities: true,
      scientificProfiles: true
    }
  });

  if (!member) return;

  const existingBadges = member.badges.map(b => b.badgeType);

  // Early adopter badge
  if (!existingBadges.includes('early_adopter')) {
    const memberRank = await getMemberJoinRank(member.discordServerId, member.joinedAt);
    if (memberRank <= 50) {
      await awardBadge(tx, memberId, 'early_adopter', SCORING_CONFIG.BADGES.EARLY_ADOPTER.points);
    }
  }

  // Paper expert badge
  if (!existingBadges.includes('paper_expert')) {
    const paperActivities = member.activities.filter(a => a.activityType.includes('paper'));
    if (paperActivities.length >= 50) {
      await awardBadge(tx, memberId, 'paper_expert', SCORING_CONFIG.BADGES.PAPER_EXPERT.points);
    }
  }

  // Discussion leader badge
  if (!existingBadges.includes('discussion_leader')) {
    const qualityMessages = member.activities.filter(
      a => a.activityType === 'quality_message'
    );
    if (qualityMessages.length >= 500) {
      await awardBadge(tx, memberId, 'discussion_leader', SCORING_CONFIG.BADGES.DISCUSSION_LEADER.points);
    }
  }

  // Onboarding champion badge
  if (!existingBadges.includes('onboarding_champion') && member.isOnboarded) {
    await awardBadge(tx, memberId, 'onboarding_champion', SCORING_CONFIG.BADGES.ONBOARDING_CHAMPION.points);
  }
}

/**
 * Award a badge to a member
 */
async function awardBadge(
  tx: PrismaTransactionClient, 
  memberId: string, 
  badgeType: string, 
  bonusPoints: number
): Promise<void> {
  await tx.memberBadge.create({
    data: {
      memberId,
      badgeType
    }
  });

  // Award bonus points for the badge
  await tx.memberActivity.create({
    data: {
      memberId,
      activityType: 'badge_earned',
      points: bonusPoints,
      description: `Earned ${badgeType} badge`,
      metadata: { badgeType }
    }
  });

  await tx.discordMember.update({
    where: { id: memberId },
    data: {
      totalPoints: { increment: bonusPoints }
    }
  });

  console.log(`[BADGE_AWARDED] User ${memberId} earned ${badgeType} badge (+${bonusPoints} points)`);
}

/**
 * Get member's join rank in the server
 */
async function getMemberJoinRank(serverId: string, joinedAt: Date): Promise<number> {
  const earlierMembers = await prisma.discordMember.count({
    where: {
      discordServerId: serverId,
      joinedAt: { lt: joinedAt }
    }
  });
  return earlierMembers + 1;
}

/**
 * Get leaderboard for a Discord server
 */
export async function getServerLeaderboard(
  serverId: string,
  period: 'all' | 'weekly' | 'monthly' = 'all',
  limit: number = 50
): Promise<any[]> {
  let orderBy: any;
  let selectField: string;

  switch (period) {
    case 'weekly':
      orderBy = { weeklyPoints: 'desc' };
      selectField = 'weeklyPoints';
      break;
    case 'monthly':
      orderBy = { monthlyPoints: 'desc' };
      selectField = 'monthlyPoints';
      break;
    default:
      orderBy = { totalPoints: 'desc' };
      selectField = 'totalPoints';
  }

  const members = await prisma.discordMember.findMany({
    where: { discordServerId: serverId },
    orderBy,
    take: limit,
    include: {
      badges: true,
      scientificProfiles: true,
      activities: {
        take: 5,
        orderBy: { createdAt: 'desc' }
      }
    }
  });

  return members.map((member, index) => ({
    rank: index + 1,
    discordId: member.discordId,
    username: member.discordUsername,
    avatar: member.discordAvatar,
    points: (member as any)[selectField],
    totalPoints: member.totalPoints,
    messagePoints: member.messagePoints,
    paperPoints: member.paperPoints,
    isScientist: member.scientificProfiles.length > 0,
    badges: member.badges.map(b => b.badgeType),
    recentActivities: member.activities,
    streak: member.streak,
    joinedAt: member.joinedAt
  }));
}

/**
 * Get member stats by Discord ID
 */
export async function getMemberStats(
  serverId: string,
  discordId: string
): Promise<any | null> {
  const member = await prisma.discordMember.findFirst({
    where: {
      discordId,
      discordServerId: serverId
    },
    include: {
      badges: true,
      scientificProfiles: true,
      activities: {
        take: 20,
        orderBy: { createdAt: 'desc' }
      }
    }
  });

  if (!member) return null;

  // Get member's ranking
  const higherRankedCount = await prisma.discordMember.count({
    where: {
      discordServerId: serverId,
      totalPoints: { gt: member.totalPoints }
    }
  });

  return {
    rank: higherRankedCount + 1,
    discordId: member.discordId,
    username: member.discordUsername,
    avatar: member.discordAvatar,
    totalPoints: member.totalPoints,
    messagePoints: member.messagePoints,
    paperPoints: member.paperPoints,
    weeklyPoints: member.weeklyPoints,
    monthlyPoints: member.monthlyPoints,
    streak: member.streak,
    isScientist: member.scientificProfiles.length > 0,
    badges: member.badges,
    recentActivities: member.activities,
    joinedAt: member.joinedAt
  };
}

/**
 * Reset weekly/monthly points for all members
 */
export async function resetPeriodicPoints(period: 'weekly' | 'monthly'): Promise<void> {
  const resetField = period === 'weekly' ? 'weeklyPoints' : 'monthlyPoints';
  const lastResetField = period === 'weekly' ? 'lastWeeklyReset' : 'lastMonthlyReset';

  await prisma.discordMember.updateMany({
    data: {
      [resetField]: 0,
      [lastResetField]: new Date()
    }
  });

  console.log(`[POINTS_RESET] Reset ${period} points for all members`);
}

/**
 * Update member rankings for a server
 */
export async function updateMemberRankings(serverId: string): Promise<void> {
  const members = await prisma.discordMember.findMany({
    where: { discordServerId: serverId },
    orderBy: { totalPoints: 'desc' }
  });

  const updates = members.map((member, index) => 
    prisma.discordMember.update({
      where: { id: member.id },
      data: { rank: index + 1 }
    })
  );

  await prisma.$transaction(updates);
  console.log(`[RANKINGS_UPDATE] Updated rankings for ${members.length} members in server ${serverId}`);
}

/**
 * Get or create member by Discord ID
 */
export async function getOrCreateMember(
  discordId: string,
  discordUsername: string,
  discordServerId: string,
  discordAvatar?: string
): Promise<string> {
  const existingMember = await prisma.discordMember.findUnique({
    where: { discordId }
  });

  if (existingMember) {
    return existingMember.id;
  }

  const newMember = await prisma.discordMember.create({
    data: {
      discordId,
      discordUsername,
      discordServerId,
      discordAvatar
    }
  });

  return newMember.id;
}

/**
 * Calculate and update streaks for all members
 */
export async function updateMemberStreaks(): Promise<void> {
  const members = await prisma.discordMember.findMany({
    include: {
      activities: {
        where: {
          createdAt: {
            gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) // Last 30 days
          }
        },
        orderBy: { createdAt: 'desc' }
      }
    }
  });

  for (const member of members) {
    const streak = calculateMemberStreak(member.activities);
    
    if (streak !== member.streak) {
      await prisma.discordMember.update({
        where: { id: member.id },
        data: { streak }
      });
    }
  }

  console.log(`[STREAKS_UPDATE] Updated streaks for ${members.length} members`);
}

/**
 * Calculate streak based on daily activity
 */
function calculateMemberStreak(activities: any[]): number {
  if (activities.length === 0) return 0;

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  
  let streak = 0;
  let currentDay = new Date(today);
  
  for (let i = 0; i < 30; i++) { // Check last 30 days
    const dayStart = new Date(currentDay);
    const dayEnd = new Date(currentDay);
    dayEnd.setHours(23, 59, 59, 999);
    
    const hasActivity = activities.some(activity => {
      const activityDate = new Date(activity.createdAt);
      return activityDate >= dayStart && activityDate <= dayEnd;
    });
    
    if (hasActivity) {
      streak++;
    } else {
      break; // Streak broken
    }
    
    currentDay.setDate(currentDay.getDate() - 1);
  }
  
  return streak;
} 