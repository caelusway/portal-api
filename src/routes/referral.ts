import express from 'express';
import { getOrCreateReferralCode, useReferralCode, getReferralStats } from '../services/referral.service';

const router = express.Router();

// GET /api/referral/code?projectId=xxx
router.get('/code', async (req, res) => {
  const { projectId } = req.query;
  if (!projectId) return res.status(400).json({ error: 'projectId required' });
  try {
    const code = await getOrCreateReferralCode(projectId as string);
    res.json({ code });
  } catch (e: any) {
    res.status(400).json({ error: e.message });
  }
});

// POST /api/referral/use { newProjectId, code }
router.post('/use', async (req, res) => {
  const { newProjectId, code } = req.body;
  if (!newProjectId || !code) return res.status(400).json({ error: 'newProjectId and code required' });
  const success = await useReferralCode(newProjectId, code);
  res.json({ success });
});

// GET /api/referral/stats?projectId=xxx
router.get('/stats', async (req, res) => {
  const { projectId } = req.query;
  if (!projectId) return res.status(400).json({ error: 'projectId required' });
  const stats = await getReferralStats(projectId as string);
  res.json(stats);
});

export default router; 