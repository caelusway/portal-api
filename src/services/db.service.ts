import { PrismaClient } from '@prisma/client';

// Instantiate and export Prisma client
const prisma = new PrismaClient();

// Export type Project as-is from Prisma
export type { Project } from '@prisma/client';

// ChatSession operations
export const ChatSessionService = {
  getOrCreateForUser: async (userId: string): Promise<string> => {
    try {
      // Always check for any existing session, with no time restriction
      const existingSession = await prisma.chatSession.findFirst({
        where: {
          projectId: userId,
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
        console.log(`Using existing chat session ${existingSession.id} for user ${userId}`);
        return existingSession.id;
      }

      // Create a new session only if no previous sessions exist
      const newSession = await prisma.chatSession.create({
        data: {
          projectId: userId,
          updatedAt: new Date(),
        },
      });

      console.log(`Created new chat session ${newSession.id} for user ${userId} (first-time user)`);
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
    actionSuccess?: boolean
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
    });
  },
};

// Project operations
export const ProjectService = {
  getById: async (id: string) => {
    return prisma.project.findUnique({
      where: { id },
      include: {
        Discord: true,
        NFTs: true,
      },
    });
  },

  getByWallet: async (wallet: string) => {
    return prisma.project.findUnique({
      where: { wallet },
      include: {
        Discord: true,
        NFTs: true,
      },
    });
  },

  getByPrivyId: async (privyId: string) => {
    return prisma.project.findUnique({
      where: { privyId },
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

export default prisma;
