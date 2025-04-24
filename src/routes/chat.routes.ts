import express from 'express';
import prisma, { ChatSessionService, ChatMessageService } from '../services/db.service';

const router = express.Router();

/**
 * GET /api/chat/sessions/:userId
 * Get chat sessions for a user
 */
router.get('/sessions/:userId', async (req: any, res: any) => {
  try {
    const { userId } = req.params;

    if (!userId) {
      return res.status(400).json({ error: 'User ID is required' });
    }

    const sessions = await ChatSessionService.getSessionsByProjectId(userId);

    return res.json({ sessions });
  } catch (error) {
    console.error('Error fetching chat sessions:', error);
    return res.status(500).json({ error: 'Failed to fetch chat sessions' });
  }
});

/**
 * GET /api/chat/messages/:sessionId
 * Get messages for a chat session
 */
router.get('/messages/:sessionId', async (req: any, res: any) => {
  try {
    const { sessionId } = req.params;

    if (!sessionId) {
      return res.status(400).json({ error: 'Session ID is required' });
    }

    const messages = await ChatMessageService.getMessagesBySessionId(sessionId);

    return res.json({ messages });
  } catch (error) {
    console.error('Error fetching chat messages:', error);
    return res.status(500).json({ error: 'Failed to fetch chat messages' });
  }
});

router.get('/messages/session/:sessionId', async (req: any, res: any) => {
  try {
    const { sessionId } = req.params;
    const messages = await prisma.chatMessage.findMany({
      where: { sessionId },
      orderBy: { timestamp: 'asc' },
    });
    return res.json(messages);
  } catch (error) {
    console.error('Error fetching chat messages:', error);
    return res.status(500).json({ error: 'Failed to fetch chat messages' });
  }
});

router.get('/sessions/project/:projectId', async (req: any, res: any) => {
  try {
    const { projectId } = req.params;

    // Verify project exists
    const project = await prisma.project.findUnique({
      where: { id: projectId },
    });

    if (!project) {
      return res.status(404).json({
        error: 'Project not found',
      });
    }

    // Get chat sessions
    const chatSessions = await prisma.chatSession.findMany({
      where: { projectId },
      include: {
        messages: {
          orderBy: {
            timestamp: 'asc',
          },
        },
      },
      orderBy: {
        updatedAt: 'desc',
      },
    });

    return res.json(chatSessions);
  } catch (error) {
    console.error('Error fetching chat sessions:', error);
    return res.status(500).json({
      error: 'Failed to fetch chat sessions',
    });
  }
});

/**
 * POST /api/chat/messages/:sessionId
 * Save a new chat message
 */
router.post('/messages/:sessionId', async (req: any, res: any) => {
  try {
    const { sessionId } = req.params;
    const { content, isFromAgent, actionTaken, actionSuccess } = req.body;

    if (!sessionId) {
      return res.status(400).json({ error: 'Session ID is required' });
    }

    if (!content) {
      return res.status(400).json({ error: 'Message content is required' });
    }

    await ChatMessageService.saveMessage(
      sessionId,
      content,
      isFromAgent || false,
      actionTaken,
      actionSuccess
    );

    // Get the newly created message (approximation since we can't easily get the last message)
    const messages = await ChatMessageService.getMessagesBySessionId(sessionId);
    const lastMessage = messages.length > 0 ? messages[messages.length - 1] : null;

    return res.json(lastMessage || { success: true });
  } catch (error) {
    console.error('Error saving chat message:', error);
    return res.status(500).json({ error: 'Failed to save chat message' });
  }
});

export default router;
