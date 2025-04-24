import express from 'express';
import { mintIdeaNft, mintVisionNft } from '../nft-service';
import { NFTService, ProjectService } from '../services/db.service';
import type { Hex } from 'viem';

const router = express.Router();

/**
 * GET /api/nfts/:projectId
 * Get NFTs for a project
 */
router.get('/:projectId', async (req: any, res: any) => {
  try {
    const { projectId } = req.params;

    if (!projectId) {
      return res.status(400).json({ error: 'Project ID is required' });
    }

    const nfts = await NFTService.getByProjectId(projectId);

    return res.json(nfts);
  } catch (error) {
    console.error('Error fetching NFTs:', error);
    return res.status(500).json({ error: 'Failed to fetch NFTs' });
  }
});

/**
 * POST /api/nfts/mint
 * Mint a new NFT
 */
router.post('/mint', async (req: any, res: any) => {
  try {
    const { projectId, walletAddress, nftType } = req.body;

    if (!projectId) {
      return res.status(400).json({ error: 'Project ID is required' });
    }

    if (!walletAddress) {
      return res.status(400).json({ error: 'Wallet address is required' });
    }

    if (!nftType || (nftType !== 'idea' && nftType !== 'vision')) {
      return res.status(400).json({ error: 'Valid NFT type is required (idea or vision)' });
    }

    // Verify project exists
    const project = await ProjectService.getById(projectId);
    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }

    let transactionHash: Hex;

    // Call appropriate minting function based on NFT type
    if (nftType === 'idea') {
      transactionHash = await mintIdeaNft(walletAddress as Hex);
    } else {
      transactionHash = await mintVisionNft(walletAddress as Hex);
    }

    // Create NFT record in database
    const nft = await NFTService.create({
      type: nftType,
      projectId,
      mintedAt: new Date(),
      transactionHash: transactionHash.toString(),
    });

    return res.json(nft);
  } catch (error) {
    console.error('Error minting NFT:', error);
    return res.status(500).json({ error: 'Failed to mint NFT' });
  }
});

export default router;
