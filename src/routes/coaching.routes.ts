import { Router } from 'express';
import { getCoachingResponse } from '../coaching-agent/coachingAgentService';
import { 
  getCoachingChatHistory, 
  processCoachingMessage 
} from '../coaching-agent/coachingChatService';
import { getDatabaseStats } from '../coaching-agent/vectorStoreService';

const router = Router();

/**
 * @api {post} /api/coaching/query Send a query to the coaching agent
 * @apiName QueryCoachingAgent
 * @apiGroup Coaching
 * @apiVersion 1.0.0
 * 
 * @apiDescription Get a response from the coaching agent (stateless)
 * 
 * @apiBody {String} query The user's question or query
 * 
 * @apiSuccess {String} response The coaching agent's response
 * 
 * @apiError {String} error Error message
 */
router.post('/query', async (req, res) => {
  try {
    const { query } = req.body;
    
    if (!query || typeof query !== 'string' || query.trim() === '') {
      return res.status(400).json({ error: 'A valid query string is required' });
    }
    
    console.log(`[Coaching API] Processing query: ${query}`);
    
    const response = await getCoachingResponse(query);
    
    return res.json({ response });
  } catch (error) {
    console.error('[Coaching API] Error generating response:', error);
    return res.status(500).json({ error: 'Failed to process coaching request' });
  }
});

/**
 * @api {post} /api/coaching/chat Send a message to the coaching agent (with chat history)
 * @apiName ChatWithCoachingAgent
 * @apiGroup Coaching
 * @apiVersion 1.0.0
 * 
 * @apiDescription Send a message to the coaching agent and get a response (stateful with chat history)
 * 
 * @apiBody {String} projectId The project ID
 * @apiBody {String} message The user's message
 * 
 * @apiSuccess {String} response The coaching agent's response
 * @apiSuccess {Array} messages Updated chat history
 * 
 * @apiError {String} error Error message
 */
router.post('/chat', async (req, res) => {
  try {
    const { projectId, message } = req.body;
    
    if (!projectId) {
      return res.status(400).json({ error: 'Project ID is required' });
    }
    
    if (!message || typeof message !== 'string' || message.trim() === '') {
      return res.status(400).json({ error: 'A valid message is required' });
    }
    
    console.log(`[Coaching API] Processing chat message for project ${projectId}: ${message}`);
    
    // Process the message
    await processCoachingMessage(projectId, message);
    
    // Get updated chat history
    const chatHistory = await getCoachingChatHistory(projectId);
    
    return res.json({
      success: true,
      messages: chatHistory
    });
  } catch (error) {
    console.error('[Coaching API] Error processing chat message:', error);
    return res.status(500).json({ error: 'Failed to process chat message' });
  }
});

/**
 * @api {get} /api/coaching/chat/:projectId Get chat history for a project
 * @apiName GetCoachingChatHistory
 * @apiGroup Coaching
 * @apiVersion 1.0.0
 * 
 * @apiDescription Get the coaching agent chat history for a project
 * 
 * @apiParam {String} projectId The project ID
 * 
 * @apiSuccess {Array} messages Chat history messages
 * 
 * @apiError {String} error Error message
 */
router.get('/chat/:projectId', async (req, res) => {
  try {
    const { projectId } = req.params;
    
    if (!projectId) {
      return res.status(400).json({ error: 'Project ID is required' });
    }
    
    const chatHistory = await getCoachingChatHistory(projectId);
    
    return res.json({
      messages: chatHistory
    });
  } catch (error) {
    console.error('[Coaching API] Error retrieving chat history:', error);
    return res.status(500).json({ error: 'Failed to retrieve chat history' });
  }
});

/**
 * @api {get} /api/coaching/health Check coaching agent health
 * @apiName CheckCoachingHealth
 * @apiGroup Coaching
 * @apiVersion 1.0.0
 * 
 * @apiDescription Check the health of the coaching agent system
 * 
 * @apiSuccess {Boolean} healthy Whether the system is healthy
 * @apiSuccess {Object} status Status details
 * 
 * @apiError {String} error Error message
 */
router.get('/health', async (req, res) => {
  try {
    const apiKey = process.env.OPENAI_API_KEY;
    const pgvectorUrl = process.env.PGVECTOR_URL || 
      (process.env.PGVECTOR_HOST ? 'Configured via individual parameters' : null);
    
    const status = {
      openai: {
        available: !!apiKey,
        message: apiKey ? 'API key is available' : 'API key is missing'
      },
      vectordb: {
        available: !!pgvectorUrl,
        message: pgvectorUrl ? 'Vector database config is available' : 'Vector database config is missing'
      }
    };
    
    return res.json({
      healthy: status.openai.available && status.vectordb.available,
      status
    });
  } catch (error) {
    console.error('[Coaching API] Health check error:', error);
    return res.status(500).json({ error: 'Failed to perform health check' });
  }
});

/**
 * @api {get} /api/coaching/stats Get database statistics
 * @apiName GetCoachingStats
 * @apiGroup Coaching
 * @apiVersion 1.0.0
 * 
 * @apiDescription Get statistics about the coaching agent's vector database
 * 
 * @apiSuccess {Object} stats Database statistics
 * 
 * @apiError {String} error Error message
 */
router.get('/stats', async (req, res) => {
  try {
    const stats = await getDatabaseStats();
    
    return res.json({ stats });
  } catch (error) {
    console.error('[Coaching API] Stats error:', error);
    return res.status(500).json({ error: 'Failed to retrieve database statistics' });
  }
});

export default router; 