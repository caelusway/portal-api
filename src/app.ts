import express from 'express';
import http from 'http';
import cors from 'cors';
import bodyParser from 'body-parser';
import path from 'path';
import rateLimit from 'express-rate-limit';
import apiRoutes from './routes';
import config from './config';
import { initWebSocketServer } from './websocket/ws.service';
import { initDiscordBot } from './discord-bot';
import { initCoachingWebSocket } from './coaching-agent/init-websocket';
import { validateApiKey } from './middleware/apiKey.middleware';

// Create express app
const app = express();

// Create HTTP server
const server = http.createServer(app);

// Configure rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: config.isProduction ? 800 : 1000, // Stricter limits in production
  message: {
    error: 'Too many requests from this IP, please try again later.',
    retryAfter: '15 minutes'
  },
  standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
  legacyHeaders: false, // Disable the `X-RateLimit-*` headers
  // Skip rate limiting for health checks
  skip: (req) => req.path === '/api/health',
});

// Set up middleware
app.use(cors({
  origin: [
    'https://portal-demo-app.up.railway.app',
    'http://localhost:3000',
    'https://portal.bio.xyz',
  ],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-api-key'],
}));

app.use(express.json());
app.use(bodyParser.json());

// Apply rate limiting to all routes
app.use(limiter);

// Initialize WebSocket server
const wss = initWebSocketServer(server);

// Initialize Coaching Agent WebSocket server
initCoachingWebSocket(server);

// Initialize Discord bot if token is available
if (config.discord.botToken) {
  initDiscordBot();
}

// Register API routes
app.use('/api', validateApiKey, apiRoutes);

// Catch-all route for the client app
app.get('*', (req, res) => {
  res.sendFile(path.join(config.publicPath, 'index.html'));
});

export default server;
