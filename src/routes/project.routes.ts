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
        Discord: true,
        NFTs: true,
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
      projectName,
      projectDescription,
      projectVision,
      scientificReferences,
      credentialLinks,
      teamDescription,
      motivation,
      progress,
      wallet,
      projectLinks,
      referralSource,
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
      where: { members: { some: { bioUser: { privyId } } } },
    });

    // First check if bioUser exists, if not, create one
    let bioUser = await prisma.bioUser.findUnique({
      where: { privyId },
    });

    if (!bioUser) {
      bioUser = await prisma.bioUser.create({
        data: {
          privyId,
          wallet,
        },
      });
    } else if (wallet && bioUser.wallet !== wallet) {
      // Update wallet if it changed
      bioUser = await prisma.bioUser.update({
        where: { id: bioUser.id },
        data: { wallet },
      });
    }

    if (project) {
      // Update existing project
      project = await prisma.project.update({
        where: { id: project.id },
        data: {
          projectName: projectName || project.projectName,
          projectDescription: projectDescription || project.projectDescription,
          projectVision: projectVision || project.projectVision,
          scientificReferences: scientificReferences || project.scientificReferences,
          credentialLinks: credentialLinks || project.credentialLinks,
          teamDescription: teamDescription || project.teamDescription,
          motivation: motivation || project.motivation,
          progress: progress || project.progress,
          projectLinks: projectLinks || project.projectLinks,
          referralSource: referralSource || project.referralSource,
        },
      });
    } else {
      // Create new project
      project = await prisma.project.create({
        data: {
          projectName,
          projectDescription,
          projectVision,
          scientificReferences,
          credentialLinks,
          teamDescription,
          motivation,
          progress,
          projectLinks,
          referralSource,
          level: 1, // Default level for new projects
          members: {
            create: {
              role: "founder",
              bioUser: {
                connect: {
                  id: bioUser.id,
                },
              },
            },
          },
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
        NFTs: true,
        Discord: true,
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
      teamMembers,
      motivation,
      progress,
    } = req.body;

    // Require either privyId or wallet
    if (!privyId && !wallet) {
      return res.status(400).json({
        error: 'Either privyId or wallet is required',
      });
    }

    // First, find or create BioUser
    let bioUser;
    if (privyId) {
      bioUser = await prisma.bioUser.findUnique({ where: { privyId } });
    } else if (wallet) {
      bioUser = await prisma.bioUser.findUnique({ where: { wallet } });
    }

    if (!bioUser) {
      // Create new BioUser
      bioUser = await prisma.bioUser.create({
        data: {
          privyId: privyId || undefined,
          wallet: wallet || undefined,
        },
      });
    } else if ((privyId && bioUser.privyId !== privyId) || (wallet && bioUser.wallet !== wallet)) {
      // Update BioUser if privyId or wallet changed
      bioUser = await prisma.bioUser.update({
        where: { id: bioUser.id },
        data: {
          ...(privyId && { privyId }),
          ...(wallet && { wallet }),
          ...(email && { email }),
          ...(fullName && { fullName }),
        },
      });
    }

    // Check if project exists with this user
    const existingProject = await prisma.project.findFirst({
      where: { members: { some: { bioUserId: bioUser.id } } },
      include: { members: true },
    });

    let project;
    if (existingProject) {
      // Update existing project
      project = await prisma.project.update({
        where: { id: existingProject.id },
        data: {
          privyId,
          projectName,
          projectDescription,
          projectVision,
          scientificReferences,
          credentialLinks,
          teamDescription,
          teamMembers,
          motivation,
          progress,
          projectLinks,
          referralSource,
          updatedAt: new Date(),
        },
      });
    } else {
      // Create new project with member relationship
      project = await prisma.project.create({
        data: {
          projectName,
          projectDescription,
          projectVision,
          scientificReferences,
          credentialLinks,
          teamDescription,
          teamMembers,
          projectLinks,
          referralSource,
          motivation,
          progress,
          level: 1, // Default to level 1
          members: {
            create: {
              role: "founder",
              bioUser: {
                connect: {
                  id: bioUser.id,
                },
              },
            },
          },
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
      projectName,
      projectDescription,
      projectVision,
      scientificReferences,
      credentialLinks,
      teamDescription,
      teamMembers,
      motivation,
      progress,
      projectLinks,
      referralSource,
    } = req.body;

    const project = await prisma.project.update({
      where: { id },
      data: {
        projectName,
        projectDescription,
        projectVision,
        scientificReferences,
        credentialLinks,
        teamDescription,
        teamMembers,
        motivation,
        progress,
        projectLinks,
        referralSource,
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
router.post('/:projectId/invites/:privyId', async (req: any, res: any) => {
  try {
    const { projectId, privyId } = req.params;
    const {  inviteeEmail } = req.body; // Using userId from body per current system
    
    if (!projectId || !inviteeEmail || !privyId) {
      return res.status(400).json({ error: 'Project ID, invitee email, and privyId are required' });
    }
    
    // Verify the project exists
    const project = await ProjectService.getById(projectId);
    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }
    
    // Verify the user is a member of this project
    const membership = await ProjectMemberService.findByPrivyIdAndProjectId(privyId, projectId);
    if (!membership) {
      return res.status(403).json({ error: 'You are not a member of this project' });
    }
    
    // Get the user details for email
    const inviter = await BioUserService.getById(membership.bioUserId);
    if (!inviter) {
      return res.status(404).json({ error: 'Inviter user not found' });
    }
    
    // Create the invitation
    const { invite, token } = await ProjectInviteService.create({
      projectId,
      inviterUserId: membership.bioUserId,
      inviteeEmail,
      expiresInHours: 7 * 24, // Default: 7 days
    });
    
    // Send the invitation email
    await EmailService.sendCoFounderInvite(
      inviteeEmail,
      token,
      inviter.fullName || 'A BioDAO user',
      project.projectName || 'a BioDAO project'
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

/**
 * GET /api/projects/:projectId/invites
 * Get all invitations for a project
 */
router.get('/:projectId/invites', async (req: any, res: any) => {
  try {
    const { projectId } = req.params;
    
    if (!projectId) {
      return res.status(400).json({ error: 'Project ID is required' });
    }
    
    // Verify the project exists
    const project = await ProjectService.getById(projectId);
    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }
    
    // Get all invites for this project
    const invites = await prisma.projectInvite.findMany({
      where: { projectId },
      include: {
        inviter: {
          select: {
            id: true,
            fullName: true,
            email: true,
          }
        }
      },
      orderBy: {
        createdAt: 'desc'
      }
    });
    
    return res.json(invites);
  } catch (error) {
    console.error('Error fetching project invitations:', error);
    return res.status(500).json({ error: 'Failed to fetch invitations' });
  }
});

/**
 * GET /api/projects/:projectId/members
 * Get all members of a project
 */
router.get('/:projectId/members', async (req: any, res: any) => {
  try {
    const { projectId } = req.params;
    
    if (!projectId) {
      return res.status(400).json({ error: 'Project ID is required' });
    }
    
    // Verify the project exists
    const project = await ProjectService.getById(projectId);
    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }
    
    // Get all members for this project
    const members = await ProjectMemberService.findMembersByProjectId(projectId);
    
    return res.json(members);
  } catch (error) {
    console.error('Error fetching project members:', error);
    return res.status(500).json({ error: 'Failed to fetch project members' });
  }
});

/**
 * DELETE /api/members/:id
 * Remove a member from a project
 */
router.delete('/members/:id', async (req: any, res: any) => {
  try {
    const { id } = req.params;
    
    if (!id) {
      return res.status(400).json({ error: 'Member ID is required' });
    }
    
    // Find the member to get associated project
    const member = await prisma.projectMember.findUnique({
      where: { id },
      include: {
        project: true,
        bioUser: true
      }
    });
    
    if (!member) {
      return res.status(404).json({ error: 'Project member not found' });
    }
    
    // Delete the member
    await prisma.projectMember.delete({
      where: { id }
    });
    
    return res.json({ 
      success: true, 
      message: 'Project member removed successfully',
      projectId: member.projectId
    });
  } catch (error) {
    console.error('Error removing project member:', error);
    return res.status(500).json({ error: 'Failed to remove project member', success: false });
  }
});

/**
 * PUT /api/members/:id
 * Update a project member's role
 */
router.put('/members/:id', async (req: any, res: any) => {
  try {
    const { id } = req.params;
    const { role } = req.body;
    
    if (!id) {
      return res.status(400).json({ error: 'Member ID is required' });
    }
    
    if (!role) {
      return res.status(400).json({ error: 'Role is required' });
    }
    
    // Find the member to ensure it exists
    const member = await prisma.projectMember.findUnique({
      where: { id },
      include: {
        project: true,
        bioUser: true
      }
    });
    
    if (!member) {
      return res.status(404).json({ error: 'Project member not found' });
    }
    
    // Update the member's role
    const updatedMember = await prisma.projectMember.update({
      where: { id },
      data: { role },
      include: {
        project: {
          select: {
            id: true,
            projectName: true
          }
        },
        bioUser: {
          select: {
            id: true,
            fullName: true,
            email: true,
            avatarUrl: true
          }
        }
      }
    });
    
    return res.json(updatedMember);
  } catch (error) {
    console.error('Error updating project member role:', error);
    return res.status(500).json({ error: 'Failed to update project member role' });
  }
});

export default router;
