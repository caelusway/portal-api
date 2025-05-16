import express from 'express';
import prisma from '../services/db.service';

const router = express.Router();

/**
 * POST /api/users
 * Create a new BioUser
 */
router.post('/', async (req: any, res: any) => {
  try {
    const { privyId, wallet, email, fullName, avatarUrl } = req.body;

    if (!privyId && !wallet) {
      return res.status(400).json({
        error: 'Either privyId or wallet is required',
      });
    }

    // Check if user already exists with this privyId or wallet
    let existingUser = null;
    if (privyId) {
      existingUser = await prisma.bioUser.findUnique({ where: { privyId } });
    }
    if (!existingUser && wallet) {
      existingUser = await prisma.bioUser.findUnique({ where: { wallet } });
    }
    // Also check if a user with this email already exists
    if (!existingUser && email) {
      existingUser = await prisma.bioUser.findUnique({ where: { email } });
    }

    if (existingUser) {
      return res.status(400).json({
        error: 'User already exists with this privyId, wallet, or email',
      });
    }

    const user = await prisma.bioUser.create({
      data: {
        privyId,
        wallet,
        email,
        fullName,
        avatarUrl,
      },
    });

    return res.status(201).json(user);
  } catch (error) {
    console.error('Error creating BioUser:', error);
    return res.status(500).json({
      error: 'Failed to create BioUser',
    });
  }
});

/**
 * GET /api/users/:id
 * Get a BioUser by ID
 */
router.get('/:id', async (req: any, res: any) => {
  try {
    const { id } = req.params;

    const user = await prisma.bioUser.findUnique({
      where: { id },
      include: {
        memberships: {
          include: {
            project: true,
          },
        },
      },
    });

    if (!user) {
      return res.status(404).json({
        error: 'BioUser not found',
      });
    }

    return res.json(user);
  } catch (error) {
    console.error('Error fetching BioUser:', error);
    return res.status(500).json({
      error: 'Failed to fetch BioUser',
    });
  }
});

/**
 * GET /api/users/privy/:privyId
 * Get a BioUser by Privy ID
 */
router.get('/privy/:privyId', async (req: any, res: any) => {
  try {
    const { privyId } = req.params;

    console.log('privyId', privyId);

    const user = await prisma.bioUser.findUnique({
      where: { privyId }
    });

    if (!user) {
      return res.status(404).json({
        error: 'BioUser not found',
      });
    }

    return res.json(user);
  } catch (error) {
    console.error('Error fetching BioUser by Privy ID:', error);
    return res.status(500).json({
      error: 'Failed to fetch BioUser',
    });
  }
});

/**
 * GET /api/users/wallet/:wallet
 * Get a BioUser by wallet address
 */
router.get('/wallet/:wallet', async (req: any, res: any) => {
  try {
    const { wallet } = req.params;

    const user = await prisma.bioUser.findUnique({
      where: { wallet },
      include: {
        memberships: {
          include: {
            project: true,
          },
        },
      },
    });

    if (!user) {
      return res.status(404).json({
        error: 'BioUser not found',
      });
    }

    return res.json(user);
  } catch (error) {
    console.error('Error fetching BioUser by wallet:', error);
    return res.status(500).json({
      error: 'Failed to fetch BioUser',
    });
  }
});

/**
 * PUT /api/users/:id
 * Update a BioUser by ID
 */
router.put('/:id', async (req: any, res: any) => {
  try {
    const { id } = req.params;
    const { email, fullName, avatarUrl, wallet } = req.body;

    const user = await prisma.bioUser.findUnique({
      where: { id },
    });

    if (!user) {
      return res.status(404).json({
        error: 'BioUser not found',
      });
    }

    const updatedUser = await prisma.bioUser.update({
      where: { id },
      data: {
        email,
        fullName,
        avatarUrl,
        wallet,
      },
    });

    return res.json(updatedUser);
  } catch (error) {
    console.error('Error updating BioUser:', error);
    return res.status(500).json({
      error: 'Failed to update BioUser',
    });
  }
});

/**
 * PUT /api/users/privy/:privyId
 * Update a BioUser by Privy ID
 */
router.put('/privy/:privyId', async (req: any, res: any) => {
  try {
    const { privyId } = req.params;
    const { email, fullName, avatarUrl, wallet } = req.body;

    const user = await prisma.bioUser.findUnique({
      where: { privyId },
    });

    if (!user) {
      return res.status(404).json({
        error: 'BioUser not found',
      });
    }

    const updatedUser = await prisma.bioUser.update({
      where: { privyId },
      data: {
        email,
        fullName,
        avatarUrl,
        wallet,
      },
    });

    return res.json(updatedUser);
  } catch (error) {
    console.error('Error updating BioUser by Privy ID:', error);
    return res.status(500).json({
      error: 'Failed to update BioUser',
    });
  }
});

/**
 * DELETE /api/users/:id
 * Delete a BioUser by ID
 */
router.delete('/:id', async (req: any, res: any) => {
  try {
    const { id } = req.params;

    const user = await prisma.bioUser.findUnique({
      where: { id },
    });

    if (!user) {
      return res.status(404).json({
        error: 'BioUser not found',
      });
    }

    // First delete related memberships
    await prisma.projectMember.deleteMany({
      where: { bioUserId: id },
    });

    // Delete the user
    await prisma.bioUser.delete({
      where: { id },
    });

    return res.json({ success: true });
  } catch (error) {
    console.error('Error deleting BioUser:', error);
    return res.status(500).json({
      error: 'Failed to delete BioUser',
    });
  }
});

/**
 * GET /api/users/:id/memberships
 * Get all project memberships for a BioUser
 */
router.get('/:id/memberships', async (req: any, res: any) => {
  try {
    const { id } = req.params;

    const user = await prisma.bioUser.findUnique({
      where: { id },
    });

    if (!user) {
      return res.status(404).json({
        error: 'BioUser not found',
      });
    }

    const memberships = await prisma.projectMember.findMany({
      where: { bioUserId: id },
      include: {
        project: true,
      },
    });

    return res.json(memberships);
  } catch (error) {
    console.error('Error fetching BioUser memberships:', error);
    return res.status(500).json({
      error: 'Failed to fetch memberships',
    });
  }
});

/**
 * POST /api/users/:id/memberships
 * Add a project membership for a BioUser
 */
router.post('/:id/memberships', async (req: any, res: any) => {
  try {
    const { id } = req.params;
    const { projectId, role } = req.body;

    if (!projectId || !role) {
      return res.status(400).json({
        error: 'Project ID and role are required',
      });
    }

    // Check if user exists
    const user = await prisma.bioUser.findUnique({
      where: { id },
    });

    if (!user) {
      return res.status(404).json({
        error: 'BioUser not found',
      });
    }

    // Check if project exists
    const project = await prisma.project.findUnique({
      where: { id: projectId },
    });

    if (!project) {
      return res.status(404).json({
        error: 'Project not found',
      });
    }

    // Check if membership already exists
    const existingMembership = await prisma.projectMember.findFirst({
      where: {
        bioUserId: id,
        projectId,
      },
    });

    if (existingMembership) {
      return res.status(400).json({
        error: 'User is already a member of this project',
      });
    }

    // Create membership
    const membership = await prisma.projectMember.create({
      data: {
        bioUserId: id,
        projectId,
        role,
      },
    });

    return res.status(201).json(membership);
  } catch (error) {
    console.error('Error adding BioUser membership:', error);
    return res.status(500).json({
      error: 'Failed to add membership',
    });
  }
});

/**
 * PUT /api/users/:id/memberships/:membershipId
 * Update a project membership role for a BioUser
 */
router.put('/:id/memberships/:membershipId', async (req: any, res: any) => {
  try {
    const { id, membershipId } = req.params;
    const { role } = req.body;

    if (!role) {
      return res.status(400).json({
        error: 'Role is required',
      });
    }

    // Check if user exists
    const user = await prisma.bioUser.findUnique({
      where: { id },
    });

    if (!user) {
      return res.status(404).json({
        error: 'BioUser not found',
      });
    }

    // Check if membership exists and belongs to this user
    const membership = await prisma.projectMember.findFirst({
      where: {
        id: membershipId,
        bioUserId: id,
      },
    });

    if (!membership) {
      return res.status(404).json({
        error: 'Membership not found or does not belong to this user',
      });
    }

    // Update membership role
    const updatedMembership = await prisma.projectMember.update({
      where: { id: membershipId },
      data: { role },
    });

    return res.json(updatedMembership);
  } catch (error) {
    console.error('Error updating BioUser membership:', error);
    return res.status(500).json({
      error: 'Failed to update membership',
    });
  }
});

/**
 * DELETE /api/users/:id/memberships/:membershipId
 * Remove a project membership for a BioUser
 */
router.delete('/:id/memberships/:membershipId', async (req: any, res: any) => {
  try {
    const { id, membershipId } = req.params;

    // Check if user exists
    const user = await prisma.bioUser.findUnique({
      where: { id },
    });

    if (!user) {
      return res.status(404).json({
        error: 'BioUser not found',
      });
    }

    // Check if membership exists and belongs to this user
    const membership = await prisma.projectMember.findFirst({
      where: {
        id: membershipId,
        bioUserId: id,
      },
    });

    if (!membership) {
      return res.status(404).json({
        error: 'Membership not found or does not belong to this user',
      });
    }

    // Delete membership
    await prisma.projectMember.delete({
      where: { id: membershipId },
    });

    return res.json({ success: true });
  } catch (error) {
    console.error('Error removing BioUser membership:', error);
    return res.status(500).json({
      error: 'Failed to remove membership',
    });
  }
});

/**
 * GET /api/users/:id/referrals
 * Get all referrals made by a BioUser
 */
router.get('/:id/referrals', async (req: any, res: any) => {
  try {
    const { id } = req.params;

    const user = await prisma.bioUser.findUnique({
      where: { id },
    });

    if (!user) {
      return res.status(404).json({
        error: 'BioUser not found',
      });
    }

    const referrals = await prisma.bioUser.findMany({
      where: { referredById: id },
    });

    return res.json(referrals);
  } catch (error) {
    console.error('Error fetching BioUser referrals:', error);
    return res.status(500).json({
      error: 'Failed to fetch referrals',
    });
  }
});

/**
 * GET /api/users/:id/referral-code
 * Get the referral code for a BioUser
 */
router.get('/:id/referral-code', async (req: any, res: any) => {
  try {
    const { id } = req.params;

    const user = await prisma.bioUser.findUnique({
      where: { id },
    });

    if (!user) {
      return res.status(404).json({
        error: 'BioUser not found',
      });
    }

    if (!user.referralCode) {
      // Generate a new referral code if one doesn't exist
      const referralCode = await generateReferralCode();
      
      await prisma.bioUser.update({
        where: { id },
        data: { referralCode },
      });

      return res.json({ referralCode });
    }

    return res.json({ referralCode: user.referralCode });
  } catch (error) {
    console.error('Error fetching BioUser referral code:', error);
    return res.status(500).json({
      error: 'Failed to fetch referral code',
    });
  }
});

/**
 * POST /api/users/:id/referral-code
 * Generate a new referral code for a BioUser
 */
router.post('/:id/referral-code', async (req: any, res: any) => {
  try {
    const { id } = req.params;

    const user = await prisma.bioUser.findUnique({
      where: { id },
    });

    if (!user) {
      return res.status(404).json({
        error: 'BioUser not found',
      });
    }

    // Generate a new referral code
    const referralCode = await generateReferralCode();
    
    await prisma.bioUser.update({
      where: { id },
      data: { referralCode },
    });

    return res.json({ referralCode });
  } catch (error) {
    console.error('Error generating BioUser referral code:', error);
    return res.status(500).json({
      error: 'Failed to generate referral code',
    });
  }
});

/**
 * POST /api/users/:id/apply-referral
 * Apply a referral code to a BioUser
 */
router.post('/:id/apply-referral', async (req: any, res: any) => {
  try {
    const { id } = req.params;
    const { referralCode } = req.body;

    if (!referralCode) {
      return res.status(400).json({
        error: 'Referral code is required',
      });
    }

    const user = await prisma.bioUser.findUnique({
      where: { id },
    });

    if (!user) {
      return res.status(404).json({
        error: 'BioUser not found',
      });
    }

    // Check if user already has a referrer
    if (user.referredById) {
      return res.status(400).json({
        error: 'User already has a referrer',
      });
    }

    // Find the referrer by their referral code
    const referrer = await prisma.bioUser.findFirst({
      where: { referralCode },
    });

    if (!referrer) {
      return res.status(404).json({
        error: 'Invalid referral code',
      });
    }

    // Cannot refer yourself
    if (referrer.id === id) {
      return res.status(400).json({
        error: 'Cannot refer yourself',
      });
    }

    // Update the user with the referrer
    await prisma.bioUser.update({
      where: { id },
      data: { referredById: referrer.id },
    });

    return res.json({
      success: true,
      referrer: {
        id: referrer.id,
        fullName: referrer.fullName,
      },
    });
  } catch (error) {
    console.error('Error applying referral code:', error);
    return res.status(500).json({
      error: 'Failed to apply referral code',
    });
  }
});

/**
 * POST /api/users/:id/connect-discord
 * Connect Discord account to a BioUser
 */
router.post('/:id/connect-discord', async (req: any, res: any) => {
  try {
    const { id } = req.params;
    const { 
      discordId, 
      discordUsername, 
      discordAvatar, 
      discordAccessToken, 
      discordRefreshToken 
    } = req.body;

    if (!discordId || !discordUsername) {
      return res.status(400).json({
        error: 'Discord ID and username are required',
      });
    }

    const user = await prisma.bioUser.findUnique({
      where: { id },
    });

    if (!user) {
      return res.status(404).json({
        error: 'BioUser not found',
      });
    }

    // Check if another user already has this Discord ID connected
    const existingDiscordUser = await prisma.bioUser.findUnique({
      where: { discordId },
    });

    if (existingDiscordUser && existingDiscordUser.id !== id) {
      return res.status(400).json({
        error: 'This Discord account is already connected to another user',
      });
    }

    // Update the user with Discord info
    const updatedUser = await prisma.bioUser.update({
      where: { id },
      data: {
        discordId,
        discordUsername,
        discordAvatar,
        discordAccessToken,
        discordRefreshToken,
        discordConnectedAt: new Date(),
      },
    });

    // Remove sensitive info from response
    const { discordAccessToken: _, discordRefreshToken: __, ...userResponse } = updatedUser;

    return res.json(userResponse);
  } catch (error) {
    console.error('Error connecting Discord account:', error);
    return res.status(500).json({
      error: 'Failed to connect Discord account',
    });
  }
});

/**
 * GET /api/users/:id/discord
 * Get Discord connection information for a BioUser
 */
router.get('/:id/discord', async (req: any, res: any) => {
  try {
    const { id } = req.params;

    const user = await prisma.bioUser.findUnique({
      where: { id },
      select: {
        discordId: true,
        discordUsername: true,
        discordAvatar: true,
        discordConnectedAt: true,
      },
    });

    if (!user) {
      return res.status(404).json({
        error: 'BioUser not found',
      });
    }

    if (!user.discordId) {
      return res.status(404).json({
        error: 'User has not connected Discord',
      });
    }

    return res.json(user);
  } catch (error) {
    console.error('Error fetching Discord information:', error);
    return res.status(500).json({
      error: 'Failed to fetch Discord information',
    });
  }
});

/**
 * DELETE /api/users/:id/disconnect-discord
 * Disconnect Discord account from a BioUser
 */
router.delete('/:id/disconnect-discord', async (req: any, res: any) => {
  try {
    const { id } = req.params;

    const user = await prisma.bioUser.findUnique({
      where: { id },
    });

    if (!user) {
      return res.status(404).json({
        error: 'BioUser not found',
      });
    }

    if (!user.discordId) {
      return res.status(400).json({
        error: 'User has no connected Discord account',
      });
    }

    // Update the user, removing Discord info
    await prisma.bioUser.update({
      where: { id },
      data: {
        discordId: null,
        discordUsername: null,
        discordAvatar: null,
        discordAccessToken: null,
        discordRefreshToken: null,
        discordConnectedAt: null,
      },
    });

    return res.json({ success: true });
  } catch (error) {
    console.error('Error disconnecting Discord account:', error);
    return res.status(500).json({
      error: 'Failed to disconnect Discord account',
    });
  }
});

/**
 * PUT /api/users/:id/refresh-discord
 * Refresh Discord tokens for a BioUser
 */
router.put('/:id/refresh-discord', async (req: any, res: any) => {
  try {
    const { id } = req.params;
    const { discordAccessToken, discordRefreshToken } = req.body;

    if (!discordAccessToken || !discordRefreshToken) {
      return res.status(400).json({
        error: 'Discord access token and refresh token are required',
      });
    }

    const user = await prisma.bioUser.findUnique({
      where: { id },
    });

    if (!user) {
      return res.status(404).json({
        error: 'BioUser not found',
      });
    }

    if (!user.discordId) {
      return res.status(400).json({
        error: 'User has no connected Discord account',
      });
    }

    // Update the user with new tokens
    await prisma.bioUser.update({
      where: { id },
      data: {
        discordAccessToken,
        discordRefreshToken,
      },
    });

    return res.json({ success: true });
  } catch (error) {
    console.error('Error refreshing Discord tokens:', error);
    return res.status(500).json({
      error: 'Failed to refresh Discord tokens',
    });
  }
});

/**
 * POST /api/users/:id/connect-twitter
 * Connect Twitter account to a BioUser
 */
router.post('/:id/connect-twitter', async (req: any, res: any) => {
  try {
    const { id } = req.params;
    const { 
      twitterId, 
      twitterUsername, 
      twitterName,
      twitterAvatar, 
      twitterAccessToken, 
      twitterRefreshToken 
    } = req.body;

    if (!twitterId || !twitterUsername) {
      return res.status(400).json({
        error: 'Twitter ID and username are required',
      });
    }

    const user = await prisma.bioUser.findUnique({
      where: { id },
    });

    if (!user) {
      return res.status(404).json({
        error: 'BioUser not found',
      });
    }

    // Check if another user already has this Twitter ID connected
    const existingTwitterUser = await prisma.bioUser.findUnique({
      where: { twitterId },
    });

    if (existingTwitterUser && existingTwitterUser.id !== id) {
      return res.status(400).json({
        error: 'This Twitter account is already connected to another user',
      });
    }

    // Update the user with Twitter info
    const updatedUser = await prisma.bioUser.update({
      where: { id },
      data: {
        twitterId,
        twitterUsername,
        twitterName,
        twitterAvatar,
        twitterAccessToken,
        twitterRefreshToken,
        twitterConnectedAt: new Date(),
      },
    });

    // Remove sensitive info from response
    const { 
      twitterAccessToken: _, 
      twitterRefreshToken: __, 
      discordAccessToken: ___, 
      discordRefreshToken: ____, 
      ...userResponse 
    } = updatedUser;

    return res.json(userResponse);
  } catch (error) {
    console.error('Error connecting Twitter account:', error);
    return res.status(500).json({
      error: 'Failed to connect Twitter account',
    });
  }
});

/**
 * GET /api/users/:id/twitter
 * Get Twitter connection information for a BioUser
 */
router.get('/:id/twitter', async (req: any, res: any) => {
  try {
    const { id } = req.params;

    const user = await prisma.bioUser.findUnique({
      where: { id },
      select: {
        twitterId: true,
        twitterUsername: true,
        twitterName: true,
        twitterAvatar: true,
        twitterConnectedAt: true,
      },
    });

    if (!user) {
      return res.status(404).json({
        error: 'BioUser not found',
      });
    }

    if (!user.twitterId) {
      return res.status(404).json({
        error: 'User has not connected Twitter',
      });
    }

    return res.json(user);
  } catch (error) {
    console.error('Error fetching Twitter information:', error);
    return res.status(500).json({
      error: 'Failed to fetch Twitter information',
    });
  }
});

/**
 * DELETE /api/users/:id/disconnect-twitter
 * Disconnect Twitter account from a BioUser
 */
router.delete('/:id/disconnect-twitter', async (req: any, res: any) => {
  try {
    const { id } = req.params;

    const user = await prisma.bioUser.findUnique({
      where: { id },
    });

    if (!user) {
      return res.status(404).json({
        error: 'BioUser not found',
      });
    }

    if (!user.twitterId) {
      return res.status(400).json({
        error: 'User has no connected Twitter account',
      });
    }

    // Update the user, removing Twitter info
    await prisma.bioUser.update({
      where: { id },
      data: {
        twitterId: null,
        twitterUsername: null,
        twitterName: null,
        twitterAvatar: null,
        twitterAccessToken: null,
        twitterRefreshToken: null,
        twitterConnectedAt: null,
      },
    });

    return res.json({ success: true });
  } catch (error) {
    console.error('Error disconnecting Twitter account:', error);
    return res.status(500).json({
      error: 'Failed to disconnect Twitter account',
    });
  }
});

/**
 * PUT /api/users/:id/refresh-twitter
 * Refresh Twitter tokens for a BioUser
 */
router.put('/:id/refresh-twitter', async (req: any, res: any) => {
  try {
    const { id } = req.params;
    const { twitterAccessToken, twitterRefreshToken } = req.body;

    if (!twitterAccessToken || !twitterRefreshToken) {
      return res.status(400).json({
        error: 'Twitter access token and refresh token are required',
      });
    }

    const user = await prisma.bioUser.findUnique({
      where: { id },
    });

    if (!user) {
      return res.status(404).json({
        error: 'BioUser not found',
      });
    }

    if (!user.twitterId) {
      return res.status(400).json({
        error: 'User has no connected Twitter account',
      });
    }

    // Update the user with new tokens
    await prisma.bioUser.update({
      where: { id },
      data: {
        twitterAccessToken,
        twitterRefreshToken,
      },
    });

    return res.json({ success: true });
  } catch (error) {
    console.error('Error refreshing Twitter tokens:', error);
    return res.status(500).json({
      error: 'Failed to refresh Twitter tokens',
    });
  }
});

/**
 * PUT /api/users/:id/social-connections
 * Update a user's social connections (Discord or Twitter)
 * Can also disconnect by passing platformId as null, "null", or "none"
 */
router.put('/:id/social-connections', async (req: any, res: any) => {
  try {
    const { id } = req.params;
    const { 
      platform, 
      platformId, 
      username, 
      email, 
      avatarUrl,
      name,
      accessToken,
      refreshToken 
    } = req.body;

    if (!id) {
      return res.status(400).json({
        error: 'User ID is required',
      });
    }

    if (!platform) {
      return res.status(400).json({
        error: 'Platform is required',
      });
    }

    // Verify platform is supported
    if (platform !== 'discord' && platform !== 'twitter') {
      return res.status(400).json({
        error: 'Platform must be either "discord" or "twitter"',
      });
    }

    // Find the user
    const user = await prisma.bioUser.findUnique({
      where: { id },
    });

    if (!user) {
      return res.status(404).json({
        error: 'BioUser not found',
      });
    }

    // Check if this is a disconnection request
    const isDisconnecting = !platformId || platformId === "null" || platformId === "none";

    // Prepare update data based on platform
    let updateData: any = {};
    
    if (isDisconnecting) {
      // Handle disconnection - set all relevant fields to null
      if (platform === 'discord') {
        updateData = {
          discordId: null,
          discordUsername: null,
          discordAvatar: null,
          discordAccessToken: null,
          discordRefreshToken: null,
          discordConnectedAt: null,
        };
      } else if (platform === 'twitter') {
        updateData = {
          twitterId: null,
          twitterUsername: null,
          twitterName: null,
          twitterAvatar: null,
          twitterAccessToken: null,
          twitterRefreshToken: null,
          twitterConnectedAt: null,
        };
      }
    } else {
      // This is a connection update
      if (!username || !platformId) {
        return res.status(400).json({
          error: 'Username and Platform ID are required for connection',
        });
      }
      
      // Check if another user already has this platform ID connected
      const existingUserWithPlatformId = platform === 'discord'
        ? await prisma.bioUser.findUnique({ where: { discordId: platformId } })
        : await prisma.bioUser.findUnique({ where: { twitterId: platformId } });

      if (existingUserWithPlatformId && existingUserWithPlatformId.id !== id) {
        return res.status(409).json({
          error: `Another user is already connected to this ${platform} account`,
        });
      }

      if (platform === 'discord') {
        updateData = {
          discordId: platformId,
          discordUsername: username,
          discordAvatar: avatarUrl,
          discordConnectedAt: new Date(),
          discordAccessToken: accessToken,
          discordRefreshToken: refreshToken,
        };
      } else if (platform === 'twitter') {
        updateData = {
          twitterId: platformId,
          twitterUsername: username,
          twitterName: name,
          twitterAvatar: avatarUrl,
          twitterConnectedAt: new Date(),
          twitterAccessToken: accessToken,
          twitterRefreshToken: refreshToken,
        };
      }
    }

    // Update the user
    const updatedUser = await prisma.bioUser.update({
      where: { id },
      data: updateData,
    });

    // If this was a Twitter connection, also update or create Twitter record for the user's project
    if (platform === 'twitter' && !isDisconnecting) {
      try {
        // Find the user's project
        console.log(`[Social Connections] Attempting to find project for BioUser ID: ${id}`);
        const projectMember = await prisma.projectMember.findFirst({
          where: { bioUserId: id },
          include: { project: true }
        });

        console.log(`[Social Connections] projectMember result for BioUser ID ${id}:`, JSON.stringify(projectMember, null, 2));
        
        if (projectMember && projectMember.project) {
          console.log(`[Social Connections] Found project (${projectMember.projectId}) for BioUser ID: ${id}. Syncing Twitter record.`);
          // Check if Twitter record already exists
          const existingTwitter = await prisma.twitter.findUnique({
            where: { projectId: projectMember.projectId }
          });

          
          
          if (existingTwitter) {
            // Update existing Twitter record
            await prisma.twitter.update({
              where: { id: existingTwitter.id },
              data: {
                connected: true,
                twitterUsername: username,
                twitterId: platformId,
                updatedAt: new Date()
              }
            });
          } else {
            // Create new Twitter record for project
            await prisma.twitter.create({
              data: {
                projectId: projectMember.projectId,
                connected: true,
                twitterUsername: username,
                twitterId: platformId,
              }
            });
          }
        } else {
          console.log(`[Social Connections] No project found for BioUser ID: ${id} OR projectMember.project is null. Skipping project Twitter record sync.`);
        }
      } catch (err) {
        console.error('Error syncing project Twitter record:', err);
        // Don't fail the user update if project record update fails
      }
    }

    return res.json({
      success: true,
      user: updatedUser,
      action: isDisconnecting ? 'disconnected' : 'connected',
      platform
    });
  } catch (error) {
    console.error('Error updating user social connections:', error);
    return res.status(500).json({
      error: 'Failed to update user social connections',
    });
  }
});

// Helper function to generate a unique referral code
async function generateReferralCode() {
  const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let referralCode = '';
  let unique = false;

  while (!unique) {
    // Generate a random 8-character code
    referralCode = '';
    for (let i = 0; i < 8; i++) {
      referralCode += characters.charAt(Math.floor(Math.random() * characters.length));
    }

    // Check if this code is already in use
    const existingUser = await prisma.bioUser.findUnique({
      where: { referralCode },
    });

    if (!existingUser) {
      unique = true;
    }
  }

  return referralCode;
}

export default router; 