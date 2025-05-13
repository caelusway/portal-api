import { WebSocketServer, WebSocket } from 'ws';
import http from 'http';
import prisma, { ChatSessionService, ChatMessageService, ProjectService } from '../services/db.service';
import { processAgentMessage } from '../langchain/agent'; // Assuming agent.ts is in langchain directory

// Map to store active WebSocket connections by user ID (projectId)
const activeConnections: Record<string, WebSocket> = {};

interface WebSocketMessage {
  type: string;
  payload: any;
}

// Helper to send a standardized message to a WebSocket client
function sendSocketMessage(ws: WebSocket, type: string, payload: any) {
  try {
    ws.send(JSON.stringify({ type, payload }));
  } catch (error) {
    console.error('[Agent WS] Error sending message to client:', error);
  }
}

// Helper to send an error message to a WebSocket client
function sendErrorMessage(ws: WebSocket, message: string) {
  try {
    sendSocketMessage(ws, 'error', { message });
  } catch (error) {
    console.error('[Agent WS] Error sending error message to client:', error);
  }
}

/**
 * Initialize LangChain Agent WebSocket server
 * @param server HTTP server instance
 * @returns WebSocket server instance
 */
export function initAgentWebSocketServer(server: http.Server): WebSocketServer {
  console.log('[Agent WS] Initializing Agent WebSocket server on path /ws/agent');
  
  const wss = new WebSocketServer({ 
    server, 
    path: '/ws/agent',
    // Add a custom verifyClient function for debugging
    verifyClient: (info, callback) => {
      console.log(`[Agent WS] Verifying connection from ${info.origin || 'unknown origin'} to ${info.req.url}`);
      // Always accept clients for testing
      callback(true);
    }
  });

  // Add special debugging for connection events
  wss.on('headers', (headers, request) => {
    console.log(`[Agent WS] WebSocket headers being sent for ${request.url}`);
    console.log('[Agent WS] Headers:', headers);
  });

  wss.on('connection', (ws, request) => {
    const clientAddress = request.socket.remoteAddress;
    const clientUrl = request.url;
    console.log(`[Agent WS] Client connected from ${clientAddress} to path ${clientUrl}`);
    
    // Parse potential query parameters
    try {
      const url = new URL(request.url || '', `http://${request.headers.host}`);
      const userId = url.searchParams.get('userId');
      if (userId) {
        console.log(`[Agent WS] Connection has userId query parameter: ${userId}`);
      }
    } catch (e) {
      console.error('[Agent WS] Error parsing URL:', e);
    }
    
    let projectId: string | null = null;

    ws.on('message', async (rawMessage) => {
      try {
        console.log('[Agent WS] Received message:', rawMessage.toString());
        
        // Parse the message
        let parsedMessage: any;
        try {
          parsedMessage = JSON.parse(rawMessage.toString());
        } catch (parseError) {
          console.error('[Agent WS] Error parsing message:', parseError);
          sendErrorMessage(ws, 'Invalid message format');
          return;
        }

        // Handle different message types with improved logging and error handling
        if (parsedMessage.type === 'auth') {
          console.log('[Agent WS] Processing auth message');
          projectId = await handleAuthentication(ws, parsedMessage.payload || parsedMessage);
          
          if (projectId) {
            await handleInitialConnection(ws, projectId);
          }
        } 
        // Handle both 'message' type and messages with no type but with content
        else if (parsedMessage.type === 'message' || parsedMessage.content || (parsedMessage.payload && parsedMessage.payload.content)) {
          console.log('[Agent WS] Processing chat message');
          
          if (!projectId) {
            console.error('[Agent WS] Not authenticated');
            sendErrorMessage(ws, 'Not authenticated');
            return;
          }
          
          await handleChatMessage(ws, projectId, parsedMessage);
        }
        else {
          console.warn('[Agent WS] Unhandled message type:', parsedMessage.type || 'unknown');
          sendErrorMessage(ws, 'Unsupported message type');
        }
      } catch (error) {
        console.error('[Agent WS] Error processing message:', error);
        sendErrorMessage(ws, 'Error processing your request');
      }
    });

    ws.on('close', (code, reason) => {
      console.log(`[Agent WS] Client disconnected with code ${code} and reason: ${reason || 'No reason provided'}`);
      if (projectId && activeConnections[projectId] === ws) {
        console.log(`[Agent WS] Removing connection for project ${projectId}`);
        delete activeConnections[projectId];
      }
    });

    ws.on('error', (error) => {
      console.error('[Agent WS] WebSocket error:', error);
      // Consider removing connection if projectId is known and connection matches
      if (projectId && activeConnections[projectId] === ws) {
        delete activeConnections[projectId];
      }
    });
    
    // Send a welcome message to confirm connection
    sendSocketMessage(ws, 'connection_established', { 
      message: 'Connected to BioDAO Agent WebSocket server',
      timestamp: new Date().toISOString(),
      path: '/ws/agent'
    });
  });

  // Log all active connections periodically
  setInterval(() => {
    const connectionCount = Object.keys(activeConnections).length;
    console.log(`[Agent WS] Active connections: ${connectionCount}`);
    if (connectionCount > 0) {
      console.log('[Agent WS] Active project IDs:', Object.keys(activeConnections));
    }
  }, 60000); // Every minute

  console.log('[Agent WS] LangChain Agent WebSocket server initialized on /ws/agent');
  return wss;
}

/**
 * Handle authentication messages
 * @param ws WebSocket connection
 * @param payload Authentication data (e.g., { privyId: string, wallet?: string })
 * @returns Project ID if authentication is successful, otherwise null
 */
async function handleAuthentication(ws: WebSocket, payload: any): Promise<string | null> {
  try {
    console.log('[Agent WS] Authentication attempt with payload:', payload);
    
    // Extract authentication info - support both direct properties and nested payload
    // This handles cases where the auth data might be in different formats
    const wallet = payload.wallet || (payload.payload && payload.payload.wallet);
    const privyId = payload.privyId || (payload.payload && payload.payload.privyId);
    
    console.log('[Agent WS] Extracted auth info:', { wallet, privyId });

    if (!wallet && !privyId) {
      sendErrorMessage(ws, 'Wallet address or Privy ID is required');
      return null;
    }

    // First try to find user by privyId if provided
    let project = null;
    if (privyId) {
      project = await ProjectService.getByPrivyId(privyId);
    }

    // If not found by privyId, try wallet
    if (!project && wallet) {
      project = await ProjectService.getByWallet(wallet);

      if (project && privyId) {
        // Update existing user with privyId
        project = await ProjectService.update(project.id, { privyId });
      }
    }

    // If still not found, create a new user
    if (!project && (wallet || privyId)) {
      const data: any = {};
      if (wallet) data.wallet = wallet;
      if (privyId) data.privyId = privyId;
      data.level = 1;

      project = await ProjectService.create(data);
      console.log('[Agent WS] Created new project:', project.id);
    }

    if (!project) {
      sendErrorMessage(ws, 'Authentication failed');
      return null;
    }

    // Authentication successful
    console.log('[Agent WS] Authentication successful for project:', project.id);
    sendSocketMessage(ws, 'auth_success', {
      userId: project.id,
      level: project.level
    });

    return project.id;
  } catch (error) {
    console.error('[Agent WS] Authentication error:', error);
    sendErrorMessage(ws, 'Authentication failed');
    return null;
  }
}

/**
 * Handle initial connection setup after successful authentication
 * @param ws WebSocket connection
 * @param projectId User's project ID
 */
async function handleInitialConnection(ws: WebSocket, projectId: string): Promise<void> {
  try {
    const project = await ProjectService.getById(projectId);
    if (!project) {
      sendErrorMessage(ws, 'Project not found after auth.');
      return;
    }

    const sessionId = await ChatSessionService.getOrCreateForUser(projectId);
    const messages = await ChatMessageService.getMessagesBySessionId(sessionId);

    sendSocketMessage(ws, 'initial_data', {
      level: project.level,
      projectName: project.projectName,
      chatHistory: messages.map(msg => ({
        content: msg.content,
        isFromAgent: msg.isFromAgent,
        timestamp: msg.timestamp,
      })),
      // You might want to send current level requirements or other relevant initial data
    });

    // Send a welcome/guidance message from the agent
    const agentWelcome = await processAgentMessage(projectId, "User has connected.", project.level);
    if (agentWelcome) {
        sendSocketMessage(ws, 'agent_message', { content: agentWelcome });
        await ChatMessageService.saveMessage(sessionId, agentWelcome, true, 'AGENT_WELCOME');
    }


  } catch (error) {
    console.error('[Agent WS] Error handling initial connection:', error);
    sendErrorMessage(ws, 'Error setting up initial connection data.');
  }
}

/**
 * Handle incoming chat messages from the user
 * @param ws WebSocket connection
 * @param projectId User's project ID
 * @param payload Message data (e.g., { content: string })
 */
async function handleChatMessage(ws: WebSocket, projectId: string, payload: any): Promise<void> {
  try {
    console.log('[Agent WS] Chat message received:', payload);
    
    // Extract content - handle different message formats
    // Allow content to be either directly in the payload or in payload.content
    const content = typeof payload === 'string' 
      ? payload 
      : (payload.content || (payload.payload && payload.payload.content));

    if (!content) {
      console.error('[Agent WS] No content found in message payload:', payload);
      sendErrorMessage(ws, 'Invalid message format');
      return;
    }

    console.log(`[Agent WS] Processing message for ${projectId}: ${content}`);

    // Get or create chat session
    const sessionId = await ChatSessionService.getOrCreateForUser(projectId);

    // Save user message to chat history
    await ChatMessageService.saveMessage(sessionId, content, false);

    // Send typing indicator
    sendSocketMessage(ws, 'agent_typing', { isTyping: true });

    try {
      // Get project data for context
      const project = await ProjectService.getById(projectId);
      
      if (!project) {
        throw new Error(`Project not found: ${projectId}`);
      }

      // Process message with agent
      const response = await processAgentMessage(projectId, content, project.level);
      
      // Save agent response to chat history
      await ChatMessageService.saveMessage(sessionId, response, true);
      
      // Send response to client
      sendSocketMessage(ws, 'agent_message', { content: response });
      
      // Turn off typing indicator
      sendSocketMessage(ws, 'agent_typing', { isTyping: false });
      
      // Check if project leveled up after this interaction
      const updatedProject = await ProjectService.getById(projectId);
      
      if (updatedProject && updatedProject.level > project.level) {
        console.log(`[Agent WS] Project ${projectId} leveled up from ${project.level} to ${updatedProject.level}`);
        sendSocketMessage(ws, 'level_up', {
          previousLevel: project.level,
          newLevel: updatedProject.level,
          // You might want to include a congratulatory message or next steps here
        });
        // Optionally, trigger an agent message about the level up
         const levelUpConfirmation = await processAgentMessage(projectId, `I have just leveled up to ${updatedProject.level}.`, updatedProject.level);
         if(levelUpConfirmation){
              sendSocketMessage(ws, 'agent_message', { content: levelUpConfirmation });
              await ChatMessageService.saveMessage(sessionId, levelUpConfirmation, true, 'LEVEL_UP_CONFIRMATION');
         }
      }
    } catch (agentError) {
      console.error('[Agent WS] Error in processAgentMessage:', agentError);
      sendSocketMessage(ws, 'agent_typing', { isTyping: false }); // Ensure typing indicator is turned off
      
      // Send a fallback error response
      const errorMessage = `I apologize, but I encountered an error processing your message. Error details: ${agentError instanceof Error ? agentError.message : 'Unknown error'}`;
      sendSocketMessage(ws, 'agent_message', { content: errorMessage });
      await ChatMessageService.saveMessage(sessionId, errorMessage, true, 'ERROR');
    }

  } catch (error) {
    console.error('[Agent WS] Error handling chat message:', error);
    sendSocketMessage(ws, 'agent_typing', { isTyping: false }); // Ensure typing indicator is turned off
    sendErrorMessage(ws, 'Error processing your message.');
  }
}

// Potentially add other handlers here, e.g., for specific tool requests from client if needed
// or for broadcasting updates if multiple clients for the same project are supported.

/**
 * Periodically pings clients to keep connections alive and detect broken ones.
 */
export function startKeepAlive(wss: WebSocketServer, interval = 30000) {
  const keepAliveTimer = setInterval(() => {
    wss.clients.forEach((ws) => {
      if ((ws as any).isAlive === false) {
        console.log('[Agent WS] Terminating inactive connection');
        return ws.terminate();
      }
      
      (ws as any).isAlive = false;
      try {
        ws.ping('', false, (err) => {
          if (err) {
            console.error('[Agent WS] Ping error:', err);
          } else {
            (ws as any).isAlive = true;
          }
        });
      } catch (e) {
        console.error('[Agent WS] Error during ping:', e);
        ws.terminate();
      }
    });
  }, interval);

  wss.on('close', () => {
    clearInterval(keepAliveTimer);
  });
  
  // Set initial isAlive
  wss.on('connection', (ws) => {
    (ws as any).isAlive = true;
    ws.on('pong', () => {
      (ws as any).isAlive = true;
    });
  });
  
  console.log(`[Agent WS] Keep-alive pings started with ${interval}ms interval`);
} 