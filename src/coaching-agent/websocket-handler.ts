import { WebSocket } from 'ws';
import { 
  getCoachingChatHistory, 
  processCoachingMessage, 
  registerConnection, 
  sendMessage,
  SESSION_TYPES
} from './coachingChatService';

// Prefix for all coaching agent message types to prevent conflicts
const COACHING_PREFIX = 'coaching_';

/**
 * Handle a new WebSocket connection for the coaching agent
 * @param ws WebSocket connection
 * @param projectId Project ID
 */
export async function handleConnection(ws: WebSocket, projectId: string): Promise<void> {
  try {
    // Register this connection
    registerConnection(ws, projectId);
    
    // Send a welcome message
    ws.send(JSON.stringify({
      type: `${COACHING_PREFIX}connected`,
      message: 'Connected to coaching agent',
      projectId,
      timestamp: new Date().toISOString()
    }));
    
    // Send chat history
    await sendChatHistory(ws, projectId);
    
    // Setup message handler
    ws.on('message', async (message) => {
      await handleMessage(ws, projectId, message);
    });
    
  } catch (error) {
    console.error(`Error handling coaching agent connection for project ${projectId}:`, error);
    ws.send(JSON.stringify({
      type: `${COACHING_PREFIX}error`,
      message: 'Failed to establish coaching agent connection',
      error: error
    }));
  }
}

/**
 * Send chat history to the client
 * @param ws WebSocket connection
 * @param projectId Project ID
 */
async function sendChatHistory(ws: WebSocket, projectId: string): Promise<void> {
  try {
    // Get chat history
    const messages = await getCoachingChatHistory(projectId);
    
    // Send to client
    ws.send(JSON.stringify({
      type: `${COACHING_PREFIX}chat_history`,
      messages,
      timestamp: new Date().toISOString()
    }));
    
  } catch (error) {
    console.error(`Error sending coaching chat history for project ${projectId}:`, error);
    ws.send(JSON.stringify({
      type: `${COACHING_PREFIX}error`,
      message: 'Failed to retrieve chat history',
      error: error
    }));
  }
}

/**
 * Handle a message from the client
 * @param ws WebSocket connection
 * @param projectId Project ID
 * @param messageData Message data from the client
 */
async function handleMessage(ws: WebSocket, projectId: string, messageData: any): Promise<void> {
  try {
    // Parse message
    const message = JSON.parse(messageData.toString());
    
    // Skip messages not meant for the coaching agent
    if (!message.type || !message.type.startsWith(COACHING_PREFIX)) {
      // Message is not prefixed for coaching agent, ignore it
      return;
    }
    
    // Strip prefix for internal processing
    const baseType = message.type.replace(COACHING_PREFIX, '');
    
    // Handle message based on the base type
    if (baseType === 'message') {
      if (!message.content) {
        ws.send(JSON.stringify({
          type: `${COACHING_PREFIX}error`,
          message: 'Invalid message format',
          details: 'Message must have type "coaching_message" and a content field'
        }));
        return;
      }
      
      // Send typing indicator
      ws.send(JSON.stringify({
        type: `${COACHING_PREFIX}typing`,
        isTyping: true,
        timestamp: new Date().toISOString()
      }));
      
      // Also send with agent_typing for backwards compatibility
      ws.send(JSON.stringify({
        type: `${COACHING_PREFIX}agent_typing`,
        isTyping: true,
        timestamp: new Date().toISOString()
      }));
      
      // Process the message
      const response = await processCoachingMessage(projectId, message.content);
      
      // Send the response
      ws.send(JSON.stringify({
        type: `${COACHING_PREFIX}message`,
        content: response,
        isFromAgent: true,
        timestamp: new Date().toISOString()
      }));
      
      // Turn off typing indicator
      ws.send(JSON.stringify({
        type: `${COACHING_PREFIX}typing`,
        isTyping: false,
        timestamp: new Date().toISOString()
      }));
      
      // Also turn off agent_typing indicator
      ws.send(JSON.stringify({
        type: `${COACHING_PREFIX}agent_typing`,
        isTyping: false,
        timestamp: new Date().toISOString()
      }));
    } else if (baseType === 'auth') {
      // Handle auth message - acknowledge receipt
      ws.send(JSON.stringify({
        type: `${COACHING_PREFIX}auth_success`,
        message: 'Authentication with coaching agent successful',
        timestamp: new Date().toISOString()
      }));
    } else if (baseType === 'ping') {
      // Handle ping message - respond with pong
      ws.send(JSON.stringify({
        type: `${COACHING_PREFIX}pong`,
        timestamp: new Date().toISOString()
      }));
    } else {
      // Unknown message type
      ws.send(JSON.stringify({
        type: `${COACHING_PREFIX}error`,
        message: 'Unknown message type',
        details: `Message type "${message.type}" is not supported by the coaching agent`
      }));
    }
    
  } catch (error) {
    console.error(`Error handling coaching message for project ${projectId}:`, error);
    ws.send(JSON.stringify({
      type: `${COACHING_PREFIX}error`,
      message: 'Failed to process message',
      error: error
    }));
    
    // Turn off typing indicator in case of error
    ws.send(JSON.stringify({
      type: `${COACHING_PREFIX}typing`,
      isTyping: false,
      timestamp: new Date().toISOString()
    }));
    
    // Also turn off agent_typing indicator
    ws.send(JSON.stringify({
      type: `${COACHING_PREFIX}agent_typing`,
      isTyping: false,
      timestamp: new Date().toISOString()
    }));
  }
}

/**
 * Broadcast a message to all connected coaching agent clients
 * @param message Message to broadcast
 */
export function broadcastMessage(message: any): void {
  // Import here to avoid circular dependency
  const { activeConnections } = require('./coachingChatService');
  
  // Add prefix to message type if it doesn't have one
  if (message.type && !message.type.startsWith(COACHING_PREFIX)) {
    message.type = `${COACHING_PREFIX}${message.type}`;
  }
  
  Object.entries(activeConnections).forEach(([projectId, ws]) => {
    if ((ws as WebSocket).readyState === WebSocket.OPEN) {
      sendMessage(projectId, message);
    }
  });
} 