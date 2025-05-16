import { PrismaClient } from '@prisma/client';
import { getCoachingResponse } from './coachingAgentService';
import { WebSocket } from 'ws';

const prisma = new PrismaClient();

// Active WebSocket connections by project ID
export const activeConnections: Record<string, WebSocket> = {};

// Session type constants
export const SESSION_TYPES = {
  CORE_AGENT: 'coreagent',
  COACHING_AGENT: 'coachingagent'
};

/**
 * Get or create a chat session for the coaching agent
 * @param projectId Project ID
 * @returns Chat session ID
 */
export async function getOrCreateCoachingSession(projectId: string): Promise<string> {
  try {
    // Check for an existing coaching session
    const existingSession = await prisma.chatSession.findFirst({
      where: {
        projectId,
        sessionType: SESSION_TYPES.COACHING_AGENT
      },
      orderBy: {
        updatedAt: 'desc'
      }
    });
    
    if (existingSession) {
      // Update the timestamp to keep the session active
      await prisma.chatSession.update({
        where: { id: existingSession.id },
        data: { updatedAt: new Date() }
      });
      
      return existingSession.id;
    }
    
    // Create a new coaching session
    const newSession = await prisma.chatSession.create({
      data: {
        projectId,
        sessionType: SESSION_TYPES.COACHING_AGENT,
        updatedAt: new Date()
      }
    });
    
    console.log(`Created new coaching chat session ${newSession.id} for project ${projectId}`);
    return newSession.id;
  } catch (error) {
    console.error(`Error managing coaching chat session for project ${projectId}:`, error);
    throw error;
  }
}

/**
 * Save a chat message in the coaching session
 * @param sessionId Chat session ID
 * @param content Message content
 * @param isFromAgent Whether the message is from the agent
 * @param actionTaken Optional action that was taken
 * @param actionSuccess Optional success status of the action
 */
export async function saveCoachingMessage(
  sessionId: string,
  content: string,
  isFromAgent: boolean,
  actionTaken?: string,
  actionSuccess?: boolean
): Promise<void> {
  try {
    await prisma.chatMessage.create({
      data: {
        sessionId,
        content,
        isFromAgent,
        actionTaken,
        actionSuccess
      }
    });
  } catch (error) {
    console.error(`Error saving coaching chat message:`, error);
    // Don't throw - we don't want to interrupt the user experience
  }
}

/**
 * Get chat history for a coaching session
 * @param projectId Project ID
 * @returns Array of chat messages
 */
export async function getCoachingChatHistory(projectId: string): Promise<any[]> {
  try {
    // Get the coaching session
    const session = await prisma.chatSession.findFirst({
      where: {
        projectId,
        sessionType: SESSION_TYPES.COACHING_AGENT
      },
      orderBy: {
        updatedAt: 'desc'
      }
    });
    
    if (!session) {
      return []; // No history yet
    }
    
    // Get messages for this session
    const messages = await prisma.chatMessage.findMany({
      where: {
        sessionId: session.id
      },
      orderBy: {
        timestamp: 'asc'
      }
    });
    
    return messages.map(msg => ({
      id: msg.id,
      content: msg.content,
      isFromAgent: msg.isFromAgent,
      timestamp: msg.timestamp.toISOString(),
      actionTaken: msg.actionTaken,
      actionSuccess: msg.actionSuccess
    }));
  } catch (error) {
    console.error(`Error getting coaching chat history for project ${projectId}:`, error);
    return [];
  }
}

/**
 * Process a user message and get a coaching response
 * @param projectId Project ID
 * @param userMessage User's message
 * @returns The agent's response
 */
export async function processCoachingMessage(projectId: string, userMessage: string): Promise<string> {
  try {
    // Get or create a session
    const sessionId = await getOrCreateCoachingSession(projectId);
    
    // Save the user's message
    await saveCoachingMessage(sessionId, userMessage, false);
    
    // Process with the coaching agent
    const response = await getCoachingResponse(userMessage);
    
    // Save the agent's response
    await saveCoachingMessage(sessionId, response, true);
    
    return response;
  } catch (error) {
    console.error(`Error processing coaching message for project ${projectId}:`, error);
    throw error;
  }
}

/**
 * Register a new WebSocket connection for a project
 * @param ws WebSocket connection
 * @param projectId Project ID
 */
export function registerConnection(ws: WebSocket, projectId: string): void {
  activeConnections[projectId] = ws;
  
  // Setup disconnect handler
  ws.on('close', () => {
    if (activeConnections[projectId] === ws) {
      delete activeConnections[projectId];
      console.log(`Coaching WebSocket for project ${projectId} disconnected`);
    }
  });
  
  console.log(`Registered coaching WebSocket for project ${projectId}`);
}

/**
 * Send a message to a specific project's WebSocket
 * @param projectId Project ID
 * @param message Message to send
 */
export function sendMessage(projectId: string, message: any): void {
  const ws = activeConnections[projectId];
  
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(message));
  }
} 