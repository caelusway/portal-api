import { Server } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import * as coachingHandler from './websocket-handler';
import { parse } from 'url';

/**
 * FRONTEND INTEGRATION DOCUMENTATION
 * ---------------------------------
 * To communicate with the coaching agent WebSocket, follow these rules:
 * 
 * 1. Connect to: ws://your-server-url/api/coaching/ws
 * 
 * 2. Authentication:
 *    Send: { type: "auth", projectId: "your-project-id" }
 * 
 * 3. All message types must be prefixed with "coaching_":
 *    - Send messages as: { type: "coaching_message", content: "your message" }
 *    - You'll receive: { type: "coaching_message", content: "response", isFromAgent: true }
 * 
 * 4. Typing indicators:
 *    - You'll receive: { type: "coaching_typing", isTyping: true/false }
 * 
 * 5. Errors:
 *    - You'll receive: { type: "coaching_error", message: "error description" }
 * 
 * This prefix system ensures no conflicts with the main chat agent.
 */

// Path for coaching agent WebSocket
const COACHING_WS_PATH = '/api/coaching/ws';

/**
 * Initialize WebSocket server for the coaching agent
 * @param server HTTP server instance
 */
export function initCoachingWebSocket(server: Server): void {
  // Create WebSocketServer with noServer: true
  const wss = new WebSocketServer({ 
    noServer: true 
  });
  
  // Store existing upgrade listeners before modifying them
  const existingListeners = server.listeners('upgrade');
  
  // Remove all existing upgrade listeners
  server.removeAllListeners('upgrade');
  
  // Add our own upgrade handler first
  server.on('upgrade', (request, socket, head) => {
    const { pathname } = parse(request.url || '');
    
    // Only handle connections to our specific coaching path
    if (pathname === COACHING_WS_PATH) {
      console.log(`[Coaching WebSocket] Handling connection to ${COACHING_WS_PATH}`);
      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit('connection', ws, request);
      });
      return; // Stop here - don't let other handlers process this connection
    }
    
    // For all other paths, delegate to original listeners
    console.log(`[Coaching WebSocket] Delegating connection to ${pathname || 'unknown path'} to other handlers`);
    for (const listener of existingListeners) {
      listener.call(server, request, socket, head);
    }
  });
  
  // Handle connections to our WebSocket server
  wss.on('connection', async (ws: WebSocket, request) => {
    try {
      // Extract projectId from query string
      const { searchParams } = new URL(request.url || '', `http://${request.headers.host}`);
      const projectIdFromUrl = searchParams.get('projectId');
      
      if (projectIdFromUrl) {
        // If projectId is in URL, use it immediately
        console.log(`[Coaching WebSocket] New connection for project ${projectIdFromUrl} (from URL)`);
        await coachingHandler.handleConnection(ws, projectIdFromUrl);
      } else {
        // If no projectId in URL, wait for auth message
        console.log(`[Coaching WebSocket] Connection established, waiting for auth message with projectId`);
        
        // Set up one-time message handler for auth
        const authHandler = async (message: any) => {
          try {
            const data = JSON.parse(message.toString());
            
            // Only handle coaching_ prefixed messages or auth messages
            if (data.type && !data.type.startsWith('coaching_') && data.type !== 'auth') {
              // This message is not meant for the coaching agent
              console.log(`[Coaching WebSocket] Ignoring non-coaching message type: ${data.type}`);
              return;
            }
            
            if (data.type === 'auth' && data.projectId) {
              // Remove this one-time handler
              ws.removeListener('message', authHandler);
              
              console.log(`[Coaching WebSocket] Received auth with projectId: ${data.projectId}`);
              await coachingHandler.handleConnection(ws, data.projectId);
            } else if (data.type === 'auth') {
              console.warn(`[Coaching WebSocket] Auth message received but missing projectId`);
              ws.send(JSON.stringify({
                type: 'error',
                message: 'Auth message missing projectId'
              }));
            }
            // If not an auth message, ignore it (we're still waiting for auth)
          } catch (error) {
            console.error(`[Coaching WebSocket] Error handling auth message:`, error);
            ws.send(JSON.stringify({
              type: 'error',
              message: 'Failed to process auth message',
              error: (error as Error).message
            }));
          }
        };
        
        // Listen for the auth message
        ws.on('message', authHandler);
        
        // Set timeout for auth (30 seconds)
        setTimeout(() => {
          // Check if we still have the auth handler (if not, auth was successful)
          if (ws.listeners('message').includes(authHandler)) {
            console.warn(`[Coaching WebSocket] Auth timeout - no projectId received`);
            ws.send(JSON.stringify({
              type: 'error',
              message: 'Authentication timeout - no projectId received'
            }));
            ws.close();
          }
        }, 30000);
      }
    } catch (error) {
      console.error(`[Coaching WebSocket] Error handling connection:`, error);
      ws.send(JSON.stringify({
        type: 'error',
        message: 'Failed to initialize coaching agent connection',
        error: (error as Error).message
      }));
      ws.close();
    }
  });
  
  console.log(`Coaching agent WebSocket server initialized at ${COACHING_WS_PATH}`);
} 