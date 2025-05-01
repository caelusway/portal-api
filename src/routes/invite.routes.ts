import express from 'express';
import prisma, { BioUserService, ProjectService, ProjectInviteService, ProjectMemberService } from '../services/db.service';
import { EmailService } from '../services/email.service';

const router = express.Router();

/**
 * GET /api/invites/verify
 * Verify an invitation token
 */
router.get('/verify', async (req: any, res: any) => {
  try {
    const { token } = req.query;
    
    if (!token) {
      return res.status(400).json({ error: 'Token is required' });
    }
    
    // Verify the token
    const invite = await ProjectInviteService.verifyToken(token);
    
    if (!invite) {
      return res.status(400).json({ 
        valid: false,
        error: 'Invalid or expired invitation token'
      });
    }
    
    // Return the relevant project and inviter info
    return res.json({ 
      valid: true,
      projectName: invite.project.name,
      projectDescription: invite.project.description,
      inviterName: invite.inviter?.fullName || 'A BioDAO user',
      expiresAt: invite.expiresAt
    });
  } catch (error) {
    console.error('Error verifying invitation token:', error);
    return res.status(500).json({ 
      valid: false,
      error: 'Failed to verify invitation token'
    });
  }
});

/**
 * POST /api/invites/accept
 * Accept an invitation to join a project
 */
router.post('/accept', async (req: any, res: any) => {
  try {
    const { token, userId } = req.body; // Getting userId from body per current system
    
    if (!token || !userId) {
      return res.status(400).json({ error: 'Token and user ID are required' });
    }
    
    // Find and validate the invitation
    const invite = await ProjectInviteService.findByToken(token);
    
    if (!invite) {
      return res.status(404).json({ error: 'Invitation not found' });
    }
    
    if (invite.status !== 'pending') {
      return res.status(400).json({ error: 'Invitation has already been used or revoked' });
    }
    
    if (invite.expiresAt < new Date()) {
      return res.status(400).json({ error: 'Invitation has expired' });
    }
    
    // Accept the invitation - this adds the user as a project member
    const result = await ProjectInviteService.accept(token, userId);
    
    // Return the project details for the frontend to navigate
    return res.json({ 
      message: 'Project joined successfully',
      projectId: invite.projectId,
      projectMember: result.projectMember
    });
  } catch (error) {
    console.error('Error accepting invitation:', error);
    return res.status(500).json({ error: 'Failed to accept invitation' });
  }
});

export default router; 