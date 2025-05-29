import express from 'express';
import authRoutes from './auth.routes';
import projectRoutes from './project.routes';
import chatRoutes from './chat.routes';
import discordRoutes from './discord.routes';
import nftRoutes from './nft.routes';
import referralRoutes from './referral';
import inviteRoutes from './invite.routes';
import userRoutes from './user.routes';
import twitterRoutes from './twitter.routes';
import coachingRoutes from './coaching.routes';
import poiRoutes from './poi.routes';

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
router.use('/referral', referralRoutes);
router.use('/invites', inviteRoutes);
router.use('/users', userRoutes);
router.use('/twitter', twitterRoutes);
router.use('/coaching', coachingRoutes);
router.use('/v1', poiRoutes); // POI API v1 routes

export default router;
