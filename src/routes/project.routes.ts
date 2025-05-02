import express from 'express';
import prisma, { ProjectService, ProjectMemberService, BioUserService, ProjectInviteService } from '../services/db.service';
import { EmailService } from '../services/email.service';

const router = express.Router();


/**
 * GET /api/projects/:id
 * Get project by ID
 */
router.get('/:id', async (req: any, res: any) => {
  try {
    const { id } = req.params;

    if (!id) {
      return res.status(400).json({ error: 'Project ID is required' });
    }

    const project = await ProjectService.getById(id);

    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }

    return res.json(project);
  } catch (error) {
    console.error('Error fetching project:', error);
    return res.status(500).json({ error: 'Failed to fetch project' });
  }
});

/**
 * PUT /api/projects/:id
 * Update project details
 */
router.put('/:id', async (req: any, res: any) => {
  try {
    const { id } = req.params;
    const updateData = req.body;

    if (!id) {
      return res.status(400).json({ error: 'Project ID is required' });
    }

    const updatedProject = await ProjectService.update(id, updateData);

    if (!updatedProject) {
      return res.status(404).json({ error: 'Project not found' });
    }

    return res.json(updatedProject);
  } catch (error) {
    console.error('Error updating project:', error);
    return res.status(500).json({ error: 'Failed to update project' });
  }
});

// GET project by privyId
router.get('/privy/:privyId', async (req: any, res: any) => {
  const { privyId } = req.params;

  if (!privyId) {
    return res.status(400).json({ error: 'Missing privyId parameter' });
  }

  try {
    const project = await prisma.project.findFirst({
      where: { members: { some: { bioUser: { privyId } } } },
      include: {
        discord: true,
        nfts: true,
      },
    });

    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }

    return res.status(200).json(project);
  } catch (error) {
    console.error('Error fetching project by privyId:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// POST to update or create a project by privyId
router.post('/privy/:privyId', async (req: any, res: any) => {
  try {
    const { privyId } = req.params;
    const {
      name,
      description,
      vision,
      scientificReferences,
      credentialLinks,
      teamDescription,
      motivation,
      progress,
      wallet,
    } = req.body;

    if (!privyId) {
      return res.status(400).json({
        error: 'Privy ID is required',
      });
    }

    // Check if wallet is provided when creating a new project
    if (!wallet) {
      return res.status(400).json({
        error: 'Wallet address is required when creating a new project',
      });
    }

    // Check if project already exists
    let project = await prisma.project.findFirst({
      where: { members: { some: { bioUser: { privyId } } } 
    },
    });

    if (project) {
      // Update existing project
      project = await prisma.project.update({
        where: { id: project.id },
        data: {
          name: name || project.name,
          description: description || project.description,
          vision: vision || project.vision,
          scientificReferences: scientificReferences || project.scientificReferences,
          credentialLinks: credentialLinks || project.credentialLinks,
          teamDescription: teamDescription || project.teamDescription,
          motivation: motivation || project.motivation,
          progress: progress || project.progress,
        },
      });
    } else {
      // Create new project
      project = await prisma.project.create({
        data: {
          name,
          description,
          vision,
          scientificReferences,
          credentialLinks,
          teamDescription,
          motivation,
          progress,
          level: 1, // Default level for new projects
        },
      });
    }

    return res.json(project);
  } catch (error) {
    console.error('Error creating/updating project by Privy ID:', error);
    return res.status(500).json({
      error: 'Failed to create/update project',
    });
  }
});

// Delete a project by privyId
router.delete('/privy/:privyId', async (req: any, res: any) => {
  try {
    const { privyId } = req.params;

    if (!privyId) {
      return res.status(400).json({
        error: 'Missing privyId parameter',
      });
    }

    // Find the project by privyId
    const project = await prisma.project.findFirst({
      where: { members: { some: { bioUser: { privyId } } } },
    });

    if (!project) {
      return res.status(404).json({
        error: 'Project not found',
      });
    }

    // First delete related records (NFTs and Discord)
    await prisma.nFT.deleteMany({ where: { projectId: project.id } });
    await prisma.discord.deleteMany({ where: { projectId: project.id } });

    // Then delete chat messages and sessions
    const sessions = await prisma.chatSession.findMany({ where: { projectId: project.id } });
    for (const session of sessions) {
      await prisma.chatMessage.deleteMany({ where: { sessionId: session.id } });
    }
    await prisma.chatSession.deleteMany({ where: { projectId: project.id } });

    // Finally delete the project
    await prisma.project.delete({ where: { id: project.id } });

    return res.json({ success: true });
  } catch (error) {
    console.error('Error deleting project by privyId:', error);
    return res.status(500).json({
      error: 'Failed to delete project',
    });
  }
});

// Get NFTs by project ID
router.get('/:projectId/nfts', async (req: any, res: any) => {
  try {
    const { projectId } = req.params;

    if (!projectId) {
      return res.status(400).json({ error: 'Project ID is required' });
    }

    const nfts = await prisma.nFT.findMany({
      where: { projectId },
      orderBy: { mintedAt: 'desc' },
    });

    return res.json(nfts);
  } catch (error) {
    console.error('Error fetching NFTs by project ID:', error);
    return res.status(500).json({ error: 'Failed to fetch NFTs' });
  }
});

// Get Discord info by project ID
router.get('/:projectId/discord', async (req: any, res: any) => {
  try {
    const { projectId } = req.params;

    if (!projectId) {
      return res.status(400).json({ error: 'Project ID is required' });
    }

    const discord = await prisma.discord.findUnique({
      where: { projectId },
    });

    if (!discord) {
      return res.status(404).json({ error: 'Discord info not found' });
    }

    return res.json(discord);
  } catch (error) {
    console.error('Error fetching Discord info by project ID:', error);
    return res.status(500).json({ error: 'Failed to fetch Discord info' });
  }
});

// Get project by wallet address
router.get('/wallet/:wallet', async (req: any, res: any) => {
  try {
    const { wallet } = req.params;

    const project = await prisma.project.findFirst({
      where: { members: { some: { bioUser: { wallet } } } },
      include: {
        nfts: true,
        discord: true,
      },
    });

    if (!project) {
      return res.status(404).json({
        error: 'Project not found',
      });
    }

    return res.json(project);
  } catch (error) {
    console.error('Error fetching project by wallet:', error);
    return res.status(500).json({
      error: 'Failed to fetch project by wallet',
    });
  }
});

// Create or update a project
router.post('/', async (req: any, res: any) => {
  try {
    const {
      privyId,
      wallet,
      fullName,
      email,
      projectName,
      projectLinks,
      referralSource,
      projectDescription,
      projectVision,
      scientificReferences,
      credentialLinks,
      teamDescription,
      motivation,
      progress,

    } = req.body;

    // Require either privyId or wallet
    if (!privyId && !wallet) {
      return res.status(400).json({
        error: 'Either privyId or wallet is required',
      });
    }

    // Check if project exists with this privyId or wallet
    const existingProject = privyId
      ? await prisma.project.findFirst({ where: { members: { some: { bioUser: { privyId } } } } })
      : wallet
        ? await prisma.project.findFirst({ where: { members: { some: { bioUser: { wallet } } } } })
        : null;

    let project;
    if (existingProject) {
      // Update existing project
      project = await prisma.project.update({
        where: { id: existingProject.id },
        data: {
          name,
          description,
          vision,
          scientificReferences,
          credentialLinks,
          teamDescription,
          motivation,
          progress,
          projectLinks,
          referralSource,
          // Only update these if provided
          ...(privyId && { privyId }),
          ...(wallet && { wallet }),
          updatedAt: new Date(),
        },
      });
    } else {
      // Create new project - must have either privyId or wallet
      project = await prisma.project.create({
        data: {
          name,
          description,
          vision,
          scientificReferences,
          credentialLinks,
          teamDescription,
          motivation,
          progress,
          level: 1, // Default to level 1
        },
      });
    }

    return res.status(existingProject ? 200 : 201).json(project);
  } catch (error) {
    console.error('Error creating/updating project:', error);
    return res.status(500).json({
      error: 'Failed to create/update project',
    });
  }
});

// Update a project
router.patch('/:id', async (req: any, res: any) => {
  try {
    const { id } = req.params;
    const {
      name,
      description,
      vision,
      scientificReferences,
      credentialLinks,
      teamDescription,
      motivation,
      progress,
    } = req.body;

    const project = await prisma.project.update({
      where: { id },
      data: {
        name,
        description,
        vision,
        scientificReferences,
        credentialLinks,
        teamDescription,
        motivation,
        progress,
        updatedAt: new Date(),
      },
    });

    return res.json(project);
  } catch (error) {
    console.error('Error updating project:', error);
    return res.status(500).json({
      error: 'Failed to update project',
    });
  }
});

// Delete a project
router.delete('/:id', async (req: any, res: any) => {
  try {
    const { id } = req.params;

    // First delete related records (NFTs and Discord)
    await prisma.nFT.deleteMany({ where: { projectId: id } });
    await prisma.discord.deleteMany({ where: { projectId: id } });

    // Then delete chat messages and sessions
    const sessions = await prisma.chatSession.findMany({ where: { projectId: id } });
    for (const session of sessions) {
      await prisma.chatMessage.deleteMany({ where: { sessionId: session.id } });
    }
    await prisma.chatSession.deleteMany({ where: { projectId: id } });

    // Finally delete the project
    await prisma.project.delete({ where: { id } });

    return res.json({ success: true });
  } catch (error) {
    console.error('Error deleting project:', error);
    return res.status(500).json({
      error: 'Failed to delete project',
    });
  }
});

/**
 * POST /api/projects/:projectId/invites
 * Send an invitation to collaborate on a project
 */
router.post('/:projectId/invites', async (req: any, res: any) => {
  try {
    const { projectId } = req.params;
    const { userId, inviteeEmail } = req.body; // Using userId from body per current system
    
    if (!projectId || !userId || !inviteeEmail) {
      return res.status(400).json({ error: 'Project ID, user ID, and invitee email are required' });
    }
    
    // Verify the project exists
    const project = await ProjectService.getById(projectId);
    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }
    
    // Verify the user is a member of this project
    const membership = await ProjectMemberService.findByUserAndProject(userId, projectId);
    if (!membership) {
      return res.status(403).json({ error: 'You are not a member of this project' });
    }
    
    // Get the user details for email
    const inviter = await BioUserService.getById(userId);
    if (!inviter) {
      return res.status(404).json({ error: 'Inviter user not found' });
    }
    
    // Create the invitation
    const { invite, token } = await ProjectInviteService.create({
      projectId,
      inviterUserId: userId,
      inviteeEmail,
      expiresInHours: 7 * 24, // Default: 7 days
    });
    
    // Send the invitation email
    await EmailService.sendCoFounderInvite(
      inviteeEmail,
      token,
      inviter.fullName || 'A BioDAO user',
      project.name || 'a BioDAO project'
    );
    
    return res.status(201).json({ 
      message: 'Invitation sent successfully',
      invite: {
        id: invite.id,
        inviteeEmail: invite.inviteeEmail,
        status: invite.status,
        expiresAt: invite.expiresAt
      }
    });
  } catch (error) {
    console.error('Error sending project invitation:', error);
    return res.status(500).json({ error: 'Failed to send invitation' });
  }
});

export default router;
