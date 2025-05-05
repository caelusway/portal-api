import dotenv from 'dotenv';
import path from 'path';

dotenv.config();

// Environment
const NODE_ENV = process.env.NODE_ENV || 'development';
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3001;

// API Keys
const API_KEY = process.env.API_KEY || 'dev_api_key';
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const PORTAL_API_KEY = process.env.PORTAL_API_KEY;

// Discord
const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
const DISCORD_CLIENT_ID = process.env.DISCORD_CLIENT_ID || '1361285493521907832';
const DISCORD_BOT_PERMISSIONS = '8'; // Administrator permissions
const DISCORD_BOT_SCOPE = 'bot';

// Paths
const PUBLIC_PATH = path.join(__dirname, '../../public');

// Validation
if (!OPENAI_API_KEY) {
  console.warn('Warning: OPENAI_API_KEY is not set. AI features will not work correctly.');
}

if (!DISCORD_BOT_TOKEN) {
  console.warn(
    'Warning: DISCORD_BOT_TOKEN is not set. Discord bot features will not work correctly.'
  );
}

export default {
  env: NODE_ENV,
  port: PORT,
  publicPath: PUBLIC_PATH,
  api: {
    key: API_KEY,
  },
  openai: {
    apiKey: OPENAI_API_KEY,
  },
  security: {
    apiKey: PORTAL_API_KEY,
  },
  discord: {
    botToken: DISCORD_BOT_TOKEN,
    clientId: DISCORD_CLIENT_ID,
    permissions: DISCORD_BOT_PERMISSIONS,
    scope: DISCORD_BOT_SCOPE,
  },
  isProduction: NODE_ENV === 'production',
  isDevelopment: NODE_ENV === 'development',
};
