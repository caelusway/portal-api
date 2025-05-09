import express from 'express';
import TwitterService from '../services/twitter.service';


const router = express.Router();

/**
 * @route GET /api/twitter
 * @desc Get Twitter information for the current user
 * @access Private
 */
router.get('/:projectId', async (req, res) => {
  try {
    const projectId = req.params.projectId;
    const twitterData = await TwitterService.getByProjectId(projectId);
    res.json(twitterData || { connected: false });
  } catch (error) {
    console.error('Error getting Twitter data:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

/**
 * @route POST /api/twitter/connect
 * @desc Connect a Twitter account to the user's project
 * @access Private
 */
router.post('/:projectId/connect', async (req, res) => {
  try {
    const { twitterId, twitterUsername } = req.body;
    const projectId = req.params.projectId;

    if (!twitterId || !twitterUsername) {
      return res.status(400).json({ message: 'Twitter ID and username are required' });
    }

    const twitterData = await TwitterService.connectAccount(projectId, twitterId, twitterUsername);
    res.json(twitterData);
  } catch (error) {
    console.error('Error connecting Twitter account:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

/**
 * @route GET /api/twitter/verify-tweets
 * @desc Verify introductory tweets for the user's project
 * @access Private
 */
router.get('/:projectId/verify-tweets', async (req, res) => {
  try {
    const projectId = req.params.projectId;
    const tweetCount = await TwitterService.verifyIntroTweets(projectId);
    
    // Get updated Twitter data
    const twitterData = await TwitterService.getByProjectId(projectId);
    
    res.json({ 
      tweetCount, 
      verified: tweetCount >= 3,
      twitterData
    });
  } catch (error) {
    console.error('Error verifying tweets:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

/**
 * @route POST /api/twitter/:projectId/submit-tweets
 * @desc Submit and verify specific tweets by URL
 * @access Private
 */
router.post('/:projectId/submit-tweets', async (req, res) => {
  try {
    const { tweetUrls } = req.body;
    const projectId = req.params.projectId;

    if (!tweetUrls || !Array.isArray(tweetUrls) || tweetUrls.length === 0) {
      return res.status(400).json({ 
        success: false,
        message: 'Please provide an array of tweet URLs' 
      });
    }

    // Verify the submitted tweets
    const result = await TwitterService.verifySubmittedTweets(projectId, tweetUrls);
    res.json(result);
  } catch (error: any) {
    console.error('Error verifying submitted tweets:', error);
    res.status(500).json({ 
      success: false,
      message: 'Server error',
      error: error.message 
    });
  }
});

export default router; 