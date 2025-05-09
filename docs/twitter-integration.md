# Twitter Integration for BioDAO

This document explains how the Twitter integration works for BioDAO projects, which is a requirement for progression from Level 4 to Level 5.

## Overview

Users need to complete two steps to fulfill the Twitter requirement:

1. Connect their Twitter account to their BioDAO project
2. Publish at least 3 introductory tweets about their DAO and its mission

## Twitter Connection Flow

### 1. Connection Process

1. Users connect their Twitter account through the settings page or via a prompt in the CoreAgent chat
2. The connection is stored in the `Twitter` table with a reference to the user's project
3. The system sets `connected: true` and stores the user's Twitter ID and username

### 2. Tweet Verification

There are two methods for verifying tweets:

#### Automatic Verification
The system automatically checks the user's recent tweets for relevant content about their BioDAO:

1. The system uses the Twitter API to fetch the user's recent tweets
2. Tweets are filtered using keywords related to BioDAO and DeSci
3. Matching tweets are counted toward the requirement of 3 tweets

#### Manual Submission
Users can directly share tweet URLs with CoreAgent:

1. Users create tweets about their BioDAO and copy the tweet URLs
2. Users share these URLs with CoreAgent via chat
3. The system extracts tweet IDs and verifies:
   - The tweets belong to the connected Twitter account
   - The tweets contain relevant BioDAO-related content
4. Verified tweets are stored in the database and counted toward the requirement

## Implementation Details

### Database Structure

The Twitter connection and verification status are stored in the `Twitter` table:

```prisma
// Twitter model in schema.prisma
model Twitter {
  id                String   @id @default(uuid())
  projectId         String   @unique // One-to-one relation with Project
  connected         Boolean  @default(false)
  twitterUsername   String?  
  twitterId         String?
  introTweetsCount  Int      @default(0)
  tweetIds          String?  // Comma-separated list of tweet IDs
  createdAt         DateTime @default(now())
  updatedAt         DateTime @updatedAt
  
  // Relation to Project
  project           Project  @relation(fields: [projectId], references: [id], onDelete: Cascade)
}
```

### API Endpoints

#### Twitter Connection

- **POST** `/api/twitter/:projectId/connect` - Connect Twitter account to a project
  ```json
  // Request body
  {
    "twitterId": "1234567890",
    "twitterUsername": "scienceDAO"
  }
  ```

#### Tweet Verification

- **GET** `/api/twitter/:projectId/verify-tweets` - Automatically verify recent tweets
- **POST** `/api/twitter/:projectId/submit-tweets` - Verify specific tweets by URL
  ```json
  // Request body
  {
    "tweetUrls": [
      "https://twitter.com/scienceDAO/status/1234567890",
      "https://twitter.com/scienceDAO/status/9876543210",
      "https://x.com/scienceDAO/status/5678901234"
    ]
  }
  ```

### WebSocket Events

For real-time interaction, the following WebSocket events are available:

#### Twitter Connection

- `twitter_connect` - Connect Twitter account
  ```json
  {
    "type": "twitter_connect",
    "userId": "project-id-here",
    "twitterId": "1234567890",
    "twitterUsername": "scienceDAO"
  }
  ```

#### Tweet Verification

- `verify_twitter_tweets` - Automatically verify user's recent tweets
  ```json
  {
    "type": "verify_twitter_tweets",
    "userId": "project-id-here"
  }
  ```

- `submit_twitter_tweets` - Verify specific tweet URLs
  ```json
  {
    "type": "submit_twitter_tweets",
    "userId": "project-id-here",
    "tweetUrls": [
      "https://twitter.com/scienceDAO/status/1234567890",
      "https://x.com/scienceDAO/status/5678901234"
    ]
  }
  ```

## CoreAgent Integration

CoreAgent guides users through the Twitter connection and verification process:

1. If Twitter is not connected, CoreAgent suggests connecting first
2. After connection, CoreAgent explains the tweet requirements
3. CoreAgent can verify tweets automatically or accept tweet URLs directly
4. After 3 tweets are verified, CoreAgent congratulates the user and checks for level-up conditions

## Example Chat Interactions

### Connecting Twitter

**User**: How do I connect my Twitter account?

**CoreAgent**: To complete the Twitter requirement for Level 5, you need to connect your Twitter account. Follow these steps:

1. Click on the Twitter Connect button in the dashboard
2. Authorize the BioDAO app to access your Twitter
3. Once connected, I'll guide you to create your introductory tweets

Would you like me to help you connect your Twitter account now?

### Verifying Tweets

**User**: I've posted some tweets about my BioDAO

**CoreAgent**: Great! You can either:

1. Share the URLs of your tweets with me so I can verify them, or
2. Simply ask me to "verify my tweets" and I'll check your recent posts

Remember, you need 3 tweets that mention your BioDAO, its scientific mission, or invite others to join.

### Submitting Tweet URLs

**User**: Here are my tweets: https://twitter.com/scienceDAO/status/1234567890 and https://twitter.com/scienceDAO/status/9876543210

**CoreAgent**: I've verified your tweets! You now have 2 verified tweets about your BioDAO. You need 1 more to complete this requirement.

Remember to include keywords like biodao, desci, dao, research, or science in your tweets.

## Testing in Development

When testing in development without actual Twitter API access:

1. The system uses simulated tweet data when `TWITTER_BEARER_TOKEN` is not set
2. Tweet verification can be tested using any numeric ID as a tweet ID
3. The system will count tweets as verified if they contain relevant keywords

## Troubleshooting

Common issues and solutions:

- **Tweets not being verified**: Ensure tweets contain relevant keywords and are public
- **Connection issues**: Check that the correct Twitter credentials are being used
- **API rate limiting**: The system handles API failures by falling back to simulated data

For any technical issues, please contact the development team. 