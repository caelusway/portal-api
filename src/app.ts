import express from 'express';
import http from 'http';
import cors from 'cors';
import bodyParser from 'body-parser';
import path from 'path';
import apiRoutes from './routes';
import config from './config';
import { initWebSocketServer } from './websocket/ws.service';
import { initDiscordBot } from './discord-bot';
import { validateApiKey } from './middleware/apiKey.middleware';

// Create express app
const app = express();


// Create HTTP server
const server = http.createServer(app);

// Set up middleware
app.use(cors({
  origin: [
    'https://portal-demo-app.up.railway.app',
    'http://localhost:3000',
  ],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-api-key'],
}));

app.use(express.json());
app.use(bodyParser.json());

// Initialize WebSocket server
const wss = initWebSocketServer(server);

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
