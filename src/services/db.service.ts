import { PrismaClient, Prisma } from '@prisma/client';
import { v4 as uuidv4 } from 'uuid';
import crypto from 'crypto';

// Instantiate and export Prisma client
const prisma = new PrismaClient();

// Export type Project as-is from Prisma
export type { Project } from '@prisma/client';

// ChatSession operations
export const ChatSessionService = {
  getOrCreateForUser: async (projectId: string): Promise<string> => {
    try {
      // Always check for any existing session, with no time restriction
      const existingSession = await prisma.chatSession.findFirst({
        where: {
          projectId,
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
        console.log(`Using existing chat session ${existingSession.id} for project ${projectId}`);
        return existingSession.id;
      }

      // Create a new session only if no previous sessions exist
      const newSession = await prisma.chatSession.create({
        data: {
          projectId,
          updatedAt: new Date(),
        },
      });

      console.log(`Created new chat session ${newSession.id} for project ${projectId} (first-time project)`);
      return newSession.id;
    } catch (error) {
      console.error('Error managing chat session:', error);
      throw error;
    }
  },

  getSessionsByProjectId: async (projectId: string) => {
    return prisma.chatSession.findMany({
      where: {
        projectId,
      },
      orderBy: {
        updatedAt: 'desc',
      },
    });
  },

  getAllSessions: async () => {
    return prisma.chatSession.findMany({
      orderBy: {
        updatedAt: 'desc',
      },
    });
  },
};

// ChatMessage operations
export const ChatMessageService = {
  saveMessage: async (
    sessionId: string,
    content: string | { content: string },
    isFromAgent: boolean,
    actionTaken?: string,
    actionSuccess?: boolean,
    bioUserId?: string
  ): Promise<void> => {
    try {
      const messageContent = typeof content === 'string' ? content : content.content;

      await prisma.chatMessage.create({
        data: {
          sessionId,
          content: messageContent,
          isFromAgent,
          actionTaken,
          actionSuccess,
          bioUserId,
        },
      });
    } catch (error) {
      console.error('Error saving chat message:', error);
      // Don't throw - we don't want to interrupt the user experience if message saving fails
    }
  },

  getMessagesBySessionId: async (sessionId: string) => {
    return prisma.chatMessage.findMany({
      where: {
        sessionId,
      },
      orderBy: {
        timestamp: 'asc',
      },
      include: {
        bioUser: {
          select: {
            id: true,
            fullName: true,
            avatarUrl: true,
          },
        },
      },
    });
  },
};

// Project operations
export const ProjectService = {
  getById: async (id: string) => {
    return prisma.project.findUnique({
      where: { id },
      include: {
        members: {
          include: {
            bioUser: true,
          },
        },
        Discord: true,
        NFTs: true,
      },
    });
  },

  getByWallet: async (wallet: string) => {
    return prisma.project.findFirst({
      where: { members: { some: { bioUser: { wallet } } } },
      include: {
        Discord: true,
        NFTs: true,
      },
    });
  },

  getByPrivyId: async (privyId: string) => {
    return prisma.project.findFirst({
      where: { members: { some: { bioUser: { privyId } } } },
      include: {
        Discord: true,
        NFTs: true,
      },
    });
  },

  updateLevel: async (id: string, level: number) => {
    return prisma.project.update({
      where: { id },
      data: { level },
    });
  },

  create: async (data: any) => {
    return prisma.project.create({
      data,
    });
  },

  update: async (id: string, data: any) => {
    return prisma.project.update({
      where: { id },
      data,
    });
  },

  getProjectsForUser: async (userId: string) => {
    return prisma.projectMember.findMany({
      where: { bioUserId: userId },
      include: {
        project: true,
      },
    });
  },
};

// Discord operations
export const DiscordService = {
  getByProjectId: async (projectId: string) => {
    return prisma.discord.findUnique({
      where: { projectId },
    });
  },

  getByServerId: async (serverId: string) => {
    return prisma.discord.findFirst({
      where: { serverId },
    });
  },

  updateStats: async (id: string, data: any) => {
    return prisma.discord.update({
      where: { id },
      data,
    });
  },

  markBotAsInstalled: async (projectId: string) => {
    try {
      const result = await prisma.discord.updateMany({
        where: { projectId },
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
  },

  create: async (data: any) => {
    return prisma.discord.create({
      data,
    });
  },

  async createOrUpdate(data: {
    projectId: string;
    serverId: string;
    inviteLink?: string;
    memberCount?: number;
    serverName?: string;
    serverIcon?: string;
    verificationToken?: string;
    botAdded?: boolean;
    verified?: boolean;
  }): Promise<any> {
    const { projectId, ...updateData } = data;

    // Prepare data for creation, only including defined optional fields
    const createData: Prisma.DiscordCreateInput = {
        project: { connect: { id: projectId } },
        serverId: updateData.serverId,
        // Conditionally spread properties if they are defined
        ...(updateData.inviteLink !== undefined && { inviteLink: updateData.inviteLink }),
        ...(updateData.memberCount !== undefined && { memberCount: updateData.memberCount }),
        ...(updateData.serverName !== undefined && { serverName: updateData.serverName }),
        ...(updateData.serverIcon !== undefined && { serverIcon: updateData.serverIcon }),
        ...(updateData.verificationToken !== undefined && { verificationToken: updateData.verificationToken }),
        ...(updateData.botAdded !== undefined && { botAdded: updateData.botAdded }),
        ...(updateData.verified !== undefined && { verified: updateData.verified }),
    };

    // Use upsert for atomicity
    return prisma.discord.upsert({
      where: { projectId }, // Ensure projectId is unique as defined in schema
      update: { ...updateData, updatedAt: new Date() },
      create: createData,
    });
  },

  update: async (id: string, data: Prisma.DiscordUpdateInput) => {
    return prisma.discord.update({
      where: { id },
      data: { ...data, updatedAt: new Date() },
    });
  },
};

// NFT operations
export const NFTService = {
  getByProjectId: async (projectId: string) => {
    return prisma.nFT.findMany({
      where: { projectId },
    });
  },

  create: async (data: any) => {
    return prisma.nFT.create({
      data,
    });
  },

  update: async (id: string, data: any) => {
    return prisma.nFT.update({
      where: { id },
      data,
    });
  },
};

// BioUser operations
export const BioUserService = {
  findOrCreate: async (data: {
    privyId: string;
    wallet?: string;
    email?: string;
    fullName?: string;
  }): Promise<any> => {
    const { privyId, wallet, email, fullName } = data;

    let user = await prisma.bioUser.findUnique({
      where: { privyId },
    });

    if (!user && wallet) {
      user = await prisma.bioUser.findUnique({ where: { wallet } });
    }

    if (!user && email) {
      user = await prisma.bioUser.findUnique({ where: { email } });
    }

    if (user) {
      // Found user, potentially update missing info
      const updateData: Prisma.BioUserUpdateInput = {};
      if (!user.privyId) updateData.privyId = privyId;
      if (!user.wallet && wallet) updateData.wallet = wallet;
      if (!user.email && email) updateData.email = email;
      if (!user.fullName && fullName) updateData.fullName = fullName;

      if (Object.keys(updateData).length > 0) {
        user = await prisma.bioUser.update({
          where: { id: user.id },
          data: updateData,
        });
      }
      return user;
    } else {
      // Create new user
      return await prisma.bioUser.create({
        data: {
          privyId,
          wallet,
          email,
          fullName,
        },
      });
    }
  },

  getById: async (id: string) => {
    return prisma.bioUser.findUnique({ where: { id } });
  },

  getByPrivyId: async (privyId: string) => {
    return prisma.bioUser.findUnique({ where: { privyId } });
  },

  getByWallet: async (wallet: string) => {
    return prisma.bioUser.findUnique({ where: { wallet } });
  },
};

// ProjectMember operations
export const ProjectMemberService = {
  addMember: async (data: {
    projectId: string;
    bioUserId: string;
    role: string;
  }): Promise<any> => {
    // Check if membership already exists
    const existing = await prisma.projectMember.findUnique({
      where: {
        bioUserId_projectId: {
          bioUserId: data.bioUserId,
          projectId: data.projectId,
        },
      },
    });
    if (existing) {
      // Optionally update role or just return existing
      return existing;
    }
    return prisma.projectMember.create({ data });
  },

  findByUserAndProject: async (bioUserId: string, projectId: string) => {
    return prisma.projectMember.findUnique({
      where: {
        bioUserId_projectId: { bioUserId, projectId },
      },
    });
  },

  findByPrivyIdAndProjectId: async (privyId: string, projectId: string) => {
    return prisma.projectMember.findFirst({
      where: {
        projectId,
        bioUser: { privyId }
      }
    });
  },

  // Find all projects a user is a member of
  findMembershipsByUserId: async (bioUserId: string) => {
    return prisma.projectMember.findMany({
      where: { bioUserId },
      include: {
        project: true,
      },
    });
  },

  // Find all members of a project
  findMembersByProjectId: async (projectId: string) => {
    return prisma.projectMember.findMany({
      where: { projectId },
      include: {
        bioUser: true,
      },
    });
  },
};

// ProjectInvite operations
export const ProjectInviteService = {
  create: async (data: {
    projectId: string;
    inviterUserId: string;
    inviteeEmail: string;
    expiresInHours?: number;
  }): Promise<{ invite: any; token: string }> => {
    const token = crypto.randomBytes(32).toString('hex'); // Generate secure token
    const expiresInHours = data.expiresInHours || 7 * 24; // Default expiry: 7 days
    const expiresAt = new Date(Date.now() + expiresInHours * 60 * 60 * 1000);

    const invite = await prisma.projectInvite.create({
      data: {
        projectId: data.projectId,
        inviterUserId: data.inviterUserId,
        inviteeEmail: data.inviteeEmail,
        token: token,
        expiresAt: expiresAt,
        status: 'pending',
      },
    });
    return { invite, token };
  },

  findByToken: async (token: string) => {
    return prisma.projectInvite.findUnique({
      where: { token },
      include: {
        project: true,
        inviter: true,
      },
    });
  },

  verifyToken: async (token: string): Promise<any | null> => {
    const invite = await ProjectInviteService.findByToken(token);
    if (invite && invite.status === 'pending' && invite.expiresAt > new Date()) {
      return invite;
    }
    return null;
  },

  accept: async (token: string, acceptingUserId: string): Promise<any> => {
    return prisma.$transaction(async (tx) => {
      // 1. Find and validate the invite
      const invite = await tx.projectInvite.findUnique({
        where: { token },
      });

      if (!invite) throw new Error('Invite not found.');
      if (invite.status !== 'pending') throw new Error('Invite already used or revoked.');
      if (invite.expiresAt < new Date()) throw new Error('Invite has expired.');

      // 2. Check if user is already a member
      const existingMember = await tx.projectMember.findUnique({
        where: {
          bioUserId_projectId: {
            bioUserId: acceptingUserId,
            projectId: invite.projectId,
          },
        },
      });

      let projectMember;
      if (existingMember) {
        console.log(`User ${acceptingUserId} already a member of project ${invite.projectId}. Accepting invite.`);
        projectMember = existingMember;
      } else {
        // 3. Add user to project members
        projectMember = await tx.projectMember.create({
          data: {
            bioUserId: acceptingUserId,
            projectId: invite.projectId,
            role: 'founder', // Or determine role differently?
          },
        });
      }

      // 4. Update invite status
      await tx.projectInvite.update({
        where: { id: invite.id },
        data: { status: 'accepted' },
      });

      return { projectMember };
    });
  },
};

export default prisma;
