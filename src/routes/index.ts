import express from 'express';
import authRoutes from './auth.routes';
import projectRoutes from './project.routes';
import chatRoutes from './chat.routes';
import discordRoutes from './discord.routes';
import nftRoutes from './nft.routes';

const router = express.Router();

// Health check endpoint
router.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Register all routes
router.use('/auth', authRoutes);
router.use('/projects', projectRoutes);
router.use('/chat', chatRoutes);
router.use('/discord', discordRoutes);
router.use('/nfts', nftRoutes);

export default router;
