import express from 'express';
import { ProjectService } from '../services/db.service';
import prisma from '../services/db.service';

const router = express.Router();

/**
 * POST /api/auth/privy
 * Authenticate user via Privy ID and wallet address
 */
router.post('/privy', async (req: any, res: any) => {
  try {
    const { wallet, privyId } = req.body;

    if (!wallet && !privyId) {
      return res.status(400).json({
        error: 'Wallet address or Privy ID is required',
      });
    }

    // First try to find user by privyId
    let project = null;
    if (privyId) {
      project = await ProjectService.getByPrivyId(privyId);
    }

    // If not found by privyId, try wallet
    if (!project && wallet) {
      project = await ProjectService.getByWallet(wallet);

      if (project) {
        // Update existing user with privyId
        project = await ProjectService.update(project.id, { privyId });
      } else {
        // Create new user with BioUser and Project
        const bioUser = await prisma.bioUser.create({
          data: {
            privyId,
            wallet,
          }
        });

        project = await ProjectService.create({
          level: 1,
          members: {
            create: {
              role: "founder",
              bioUserId: bioUser.id
            }
          }
        });
      }
    } else if (project && project.members?.[0]?.bioUser?.wallet !== wallet && wallet) {
      // Update wallet if it changed - need to update BioUser
      const bioUserId = project.members?.[0]?.bioUser?.id;
      if (bioUserId) {
        await prisma.bioUser.update({
          where: { id: bioUserId },
          data: { wallet }
        });
        // Refresh project data
        project = await ProjectService.getById(project.id);
      }
    }

    if (!project) {
      return res.status(500).json({
        error: 'Failed to authenticate user',
      });
    }

    return res.json({
      userId: project.id,
      privyId: project.privyId,
      level: project.level,
    });
  } catch (error) {
    console.error('Authentication error:', error);
    return res.status(500).json({
      error: 'Authentication failed',
    });
  }
});

/**
 * GET /api/auth/user/:privyId
 * Get user by Privy ID
 */
router.get('/user/:privyId', async (req: any, res: any) => {
  try {
    const { privyId } = req.params;

    if (!privyId) {
      return res.status(400).json({
        error: 'Privy ID is required',
      });
    }

    const project = await ProjectService.getByPrivyId(privyId);

    if (!project) {
      return res.status(404).json({
        error: 'User not found',
      });
    }

    return res.json(project);
  } catch (error) {
    console.error('Error fetching user:', error);
    return res.status(500).json({
      error: 'Failed to fetch user',
    });
  }
});

export default router;

