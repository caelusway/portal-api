import express from 'express';
import TwitterService from '../services/twitter.service';
import { ProjectService } from '../services/db.service';


const router = express.Router();

/**
 * @route GET /api/twitter/:projectId
 * @desc Get all Twitter information for the current project
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
 * @route GET /api/twitter/:projectId/profile-info
 * @desc Get Twitter profile info (connected, username, introTweetsCount)
 * @access Private
 */
router.get('/:projectId/profile-info', async (req, res) => {
  try {
    const projectId = req.params.projectId;
    const twitterData = await TwitterService.getByProjectId(projectId);

    if (!twitterData) {
      return res.json({
        connected: false,
        username: '',
        introTweetsCount: 0,
      });
    }

    res.json({
      connected: twitterData.connected || false,
      username: twitterData.twitterUsername || '',
      introTweetsCount: twitterData.introTweetsCount || 0,
    });
  } catch (error) {
    console.error('Error getting Twitter profile info:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

/**
 * @route GET /api/twitter/:projectId/community-progress
 * @desc Get community progress stats (verifiedScientists, twitterSpaceHosted, twitterSpaceUrl)
 * @access Private
 */
router.get('/:projectId/community-progress', async (req, res) => {
  try {
    const projectId = req.params.projectId;
    const twitterData = await TwitterService.getByProjectId(projectId);
    const projectData = await ProjectService.getById(projectId);

    const twitterSpaceUrl = twitterData?.twitterSpaceUrl || '';
    const twitterSpaceHosted = !!twitterSpaceUrl;
    // Assuming 'verifiedScientistCount' is a field on the project model, might need casting or safe access
    const verifiedScientists = (projectData as any)?.verifiedScientistCount || 0;


    res.json({
      verifiedScientists: verifiedScientists,
      twitterSpaceHosted: twitterSpaceHosted,
      twitterSpaceUrl: twitterSpaceUrl,
    });
  } catch (error) {
    console.error('Error getting community progress info:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

/**
 * @route GET /api/twitter/:projectId/vision-content
 * @desc Get vision content URLs (blogpostUrl, twitterThreadUrl)
 * @access Private
 */
router.get('/:projectId/vision-content', async (req, res) => {
  try {
    const projectId = req.params.projectId;
    const twitterData = await TwitterService.getByProjectId(projectId);

    if (!twitterData) {
      return res.json({
        blogpostUrl: '',
        twitterThreadUrl: '',
      });
    }

    res.json({
      blogpostUrl: twitterData.blogpostUrl || '',
      twitterThreadUrl: twitterData.twitterThreadUrl || '',
    });
  } catch (error) {
    console.error('Error getting vision content info:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

/**
 * @route GET /api/twitter/:projectId/completion-data
 * @desc Get completion data (loomVideoUrl)
 * @access Private
 */
router.get('/:projectId/completion-data', async (req, res) => {
  try {
    const projectId = req.params.projectId;
    const twitterData = await TwitterService.getByProjectId(projectId);

    if (!twitterData) {
      return res.json({
        loomVideoUrl: '',
      });
    }

    res.json({
      loomVideoUrl: twitterData.loomVideoUrl || '',
    });
  } catch (error) {
    console.error('Error getting completion data:', error);
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