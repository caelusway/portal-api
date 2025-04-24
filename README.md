# BioDAO CoreAgent API

The BioDAO CoreAgent API is a WebSocket-based backend that powers the BioDAO onboarding process. It features an AI agent that guides users through the onboarding journey, from minting Science NFTs to creating and growing their Discord community.

## Features

1. **Core Agent Integration**: Chat-based interaction with an AI agent that guides users through the BioDAO onboarding process.

2. **WebSocket Communication**: Real-time bidirectional communication between the client and server.

3. **Chat History**: Maintains a complete history of user-agent interactions including messages, responses, and actions taken.

4. **Discord Bot Integration**:

   1. **Server Setup**: Helps users create and set up Discord servers for their BioDAO community.
   2. **Server Verification**: Verifies Discord servers using invite links and extracts server information.
   3. **Real-time Message Tracking**: Every Discord message is counted, stored in the database, and evaluated for quality. Each new message triggers a check for level progression, and paper/research content is detected and counted. All changes are reflected in the user's progress in real-time.

   4. **Stats Checking**: Users can request and view their current Discord statistics at any time, including member counts, message totals, papers shared, and quality scores. Progress toward level requirements is calculated and displayed as percentages.

5. **NFT Minting**: Mints Idea and Hypothesis NFTs for users completing scientific tasks.

## Setup

1. Clone the repository
2. Install dependencies:
   ```bash
   npm install
   ```
3. Set up your environment variables:

   ```
   cp .env.example .env
   ```

   Edit the `.env` file with your database and OpenAI API credentials

4. Run database migrations:

   ```bash
   npx prisma migrate dev
   ```

5. Start the development server:
   ```bash
   npm run dev
   ```

## Architecture

The API is built with the following components:

- **WebSocket Server**: Handles real-time communication with clients
- **AI Processing**: Uses LangChain and OpenAI to process user messages
- **Database**: Stores user information, NFTs, Discord stats, and chat history
- **Action Detection**: Automatically detects and executes actions based on conversation context

## Database Schema

The database includes several models:

- **User**: Stores user information and their current level
- **NFT**: Tracks minted NFTs (Idea or Hypothesis types)
- **Discord**: Stores Discord server information and statistics
- **ChatSession**: Groups related messages in a conversation
- **ChatMessage**: Stores individual messages and system actions

## WebSocket API

The API supports the following message types:

### Authentication

```json
{
  "type": "auth",
  "wallet": "0x123456789abcdef",
  "privyId": "privy:user123"
}
```

### Sending a Message to the AI Agent

```json
{
  "type": "message",
  "content": "Can you help me mint an Idea NFT?",
  "userName": "User123"
}
```

### Directly Minting an NFT

```json
{
  "type": "mint_nft",
  "nftType": "idea" // or "hypothesis"
}
```

### Registering a Discord Server

```json
{
  "type": "discord_setup",
  "serverId": "discord.gg/abcde12345"
}
```

### Retrieving Discord Stats

```json
{
  "type": "get_discord_stats"
}
```

## Chat History

The system automatically maintains a complete history of all interactions between users and the CoreAgent. This includes:

- User messages
- AI responses
- System actions taken (NFT minting, Discord setup, etc.)
- Action results (success/failure)

Chat sessions are automatically created when a user sends their first message, and will continue for 24 hours before a new session is created.

## Testing

You can use the included test tools to verify the API functionality:

- `test-ws.js`: Command line tool for generating WebSocket commands
- `test-ws.html`: Browser-based WebSocket tester

To use the test tools:

1. Start the server with `npm run dev`
2. Open `test-ws.html` in a browser or run `node test-ws.js` to see available commands

## License

This project is licensed under the MIT License - see the LICENSE file for details.

## Discord Integration and Verification

The API includes a secure Discord server integration with a verification flow:

1. **Setup**: Users share their Discord invite link or server ID via WebSocket.
2. **Registration**: The system registers the Discord server and provides a bot installation URL with a verification token.
3. **Verification**: When the bot is added to the server, it reports back with the verification token, confirming server ownership.
4. **Monitoring**: Once verified, the bot tracks member count, paper sharing, and message activity.

The verification flow prevents users from claiming ownership of Discord servers they don't control.

### Discord Webhook API

- **URL**: `/api/webhooks/discord-bot`
- **Method**: `POST`
- **Body Parameters**:
  - `serverId`: Discord server ID
  - `event`: Type of event (`bot_added` or `stats_update`)
  - `verificationToken`: Token for verifying server ownership (for `bot_added` event)
  - Additional stats for `stats_update` event: `memberCount`, `papersShared`, `messagesCount`, `qualityScore`

### Discord Setup WebSocket Flow

1. User sends a Discord invite link in a message
2. System extracts server information and generates a verification token
3. System responds with a bot installation URL containing the verification token
4. User adds bot to their server
5. Bot calls webhook with verification token
6. System verifies token and marks server as verified
7. Level progression is now enabled based on Discord activity

## Real-time Discord Statistics

The system fetches real-time Discord statistics directly from the Discord API:

1. **Member Count**: When a user shares an invite link, the system queries the Discord API to retrieve the actual member count.
2. **Invite Resolution**: The system automatically extracts the server ID and member count from Discord invite links.
3. **Periodic Refresh**: During progress checks, the system refreshes Discord data using stored invite links.
4. **Accurate Metrics**: Level progression is based on actual Discord server metrics rather than self-reported numbers.

This integration ensures that:

- User level progress is based on actual, verifiable Discord server metrics
- The CoreAgent can provide accurate information about server growth
- Users cannot falsify their server metrics for progression

## Discord Bot Integration

The API includes a comprehensive Discord integration system:

1. **Bot Installation Flow**:

   - User provides a Discord invite link to CoreAgent
   - System extracts server details and saves them to the database
   - System generates a bot installation URL with verification token
   - User clicks the link to add the bot to their server
   - Bot notifies our API via webhook that it's been added
   - System marks the server as verified and updates progress

2. **Real-time Message Tracking**:

   - Each Discord message is immediately counted and stored in the database
   - Message quality is evaluated in real-time based on length and content
   - Level progression is checked with each new message
   - Papers and research content are detected and counted separately
   - All changes are immediately reflected in the user's progress

3. **Server Verification**:

   - The Discord bot verifies server ownership
   - Bot sends updates about member count, messages, and shared resources
   - System tracks metrics for level progression

4. **Silent Operation Mode**:

   - The Discord bot operates in silent mode - it tracks statistics but does not respond to commands
   - All bot commands are logged but not processed
   - This prevents the bot from interfering with normal server conversations
   - User interaction is directed through the CoreAgent UI instead of Discord commands

5. **Webhook Endpoints**:

   - `/api/discord/bot-events` - Receives events from the Discord bot (bot_added, stats_update)
   - `/api/discord/verify-bot` - Callback endpoint for OAuth bot installation flow
   - `/api/debug/discord-stats/:serverId` - Debugging endpoint to view and fix message counts

6. **Client Notifications**:
   - WebSocket messages inform the user about their Discord integration status
   - CoreAgent proactively guides users through the Discord setup process

## WebSocket API

The WebSocket API is the primary interface for the frontend to communicate with the CoreAgent.

### Message Types

| Type                          | Direction       | Description                          |
| ----------------------------- | --------------- | ------------------------------------ |
| `auth`                        | Client → Server | Authenticate with wallet and privyId |
| `message`                     | Client → Server | Send a message to CoreAgent          |
| `mint_nft`                    | Client → Server | Trigger NFT minting                  |
| `discord_setup`               | Client → Server | Set up Discord server integration    |
| `handle_discord_bot_callback` | Client → Server | Handle bot installation callback     |
| `discord_bot_installed`       | Server → Client | Confirm bot installation success     |
| `nft_minted`                  | Server → Client | Confirm NFT minting success          |
| `level_up`                    | Server → Client | Notify level advancement             |
| `error`                       | Server → Client | Indicate an error condition          |

## Chat History System

The system maintains a complete history of all interactions:

- User messages and CoreAgent responses are stored in the database
- System actions (NFT minting, Discord setup) are recorded
- Chat sessions track conversation context
- Success/failure status of actions is preserved for auditing

## Routes

- `GET /api/health` - Health check endpoint
- `POST /api/auth/privy` - Authenticate with Privy
- `GET /api/users/privy/:privyId` - Get user by Privy ID

## Development

For local testing of the WebSocket API, you can use:

1. The test HTML client: `test-ws.html`
2. The command-line test script: `node test-ws.js`

## Discord Bot Events Integration Guide

The Discord bot must send events to the API to keep the database updated. Here's how to integrate:

### Bot Added Event

When the bot is added to a server, the Discord.js client will emit a `guildCreate` event. Your bot should handle this by sending:

```json
POST /api/discord/bot-events
{
  "event": "guildCreate",
  "guildId": "discord-server-id",
  "token": "verification-token", // Optional but recommended
  "memberCount": 5 // Current member count
}
```

Example Discord.js implementation:

```typescript
// Event listener for when the bot is added to a new server
client.on('guildCreate', async (guild) => {
  console.log(`Bot added to a new server: ${guild.name} (ID: ${guild.id})`);

  // Get member count
  const memberCount = guild.memberCount;

  // Notify the portal API
  try {
    const response = await axios.post('https://your-api-url.com/api/discord/bot-events', {
      event: 'guildCreate',
      guildId: guild.id,
      memberCount,
    });

    if (response.data.success) {
      console.log('API successfully notified of bot installation');
    }
  } catch (error) {
    console.error('Failed to notify API:', error);
  }
});
```

### Stats Update Event

When server statistics change, the bot should send:

```json
POST /api/discord/bot-events
{
  "serverId": "discord-server-id", // or "guildId"
  "event": "stats_update",
  "memberCount": 12,
  "papersShared": 8,
  "messagesCount": 145,
  "qualityScore": 75
}
```

These updates will be reflected in the user's progression and the CoreAgent will notify users of their progress toward level completion.

## Message Quality and Filtering

The system includes sophisticated filtering to ensure only meaningful messages are counted:

### Low-Value Message Filtering

Messages that don't contribute meaningful content are detected and filtered out:

- Basic greetings (`hi`, `hello`, `gm`, etc.)
- Single-word responses (`ok`, `nice`, `cool`, etc.)
- Emoji-only messages
- Very short messages (less than 5 characters)
- Messages with only 1-2 words

These low-value messages:

- Are still visible in Discord
- Are logged in the system
- Don't count toward the message total for level progression
- Don't affect the server's quality score

### Quality Scoring System

Message quality is evaluated based on several factors:

1. **Length**: Longer messages receive higher base scores
2. **Formatting**: Messages with formatting (bold, lists, code blocks) receive bonuses
3. **Content**: Messages containing scientific terms or references receive bonuses
4. **Frequency Penalty**: Users sending too many messages too quickly receive quality penalties
5. **Similarity Penalty**: Repeated or very similar messages receive reduced scores

This system ensures that level progression is based on meaningful community interaction rather than simple message volume.

## Scientific Paper Detection

The system uses a robust and accurate method to detect scientific papers shared in Discord:

1. **Strict Paper Identification**:

   - Only counts actual PDFs and verified scientific sources
   - Prevents false positives from casual mentions of research
   - Ensures accurate tracking of scientific contribution

2. **Valid Paper Sources**:

   - PDF file attachments with proper extension
   - DOI links (Digital Object Identifiers)
   - URLs from verified scientific domains (arxiv.org, nature.com, etc.)
   - Properly formatted citations with title, authors, year, and journal

3. **Paper Sharing Guidelines**:

   - Upload PDFs of papers directly to Discord
   - Include DOI with papers (e.g., "doi:10.1038/s41586-021-03819-2")
   - Share links to papers from scientific repositories
   - Format citations properly with title in quotes, authors, and publication year

4. **Why This Matters**:
   - Ensures level progression is based on actual scientific contributions
   - Makes paper sharing metrics reliable and meaningful
   - Encourages proper academic citation practices
   - Prevents gaming the system with false paper counts

## Discord Stats Tracking Improvements

The Discord message tracking system has been enhanced to ensure messages are properly counted and saved to the database:

1. **Real-time Message Counting**

   - Each Discord message now immediately updates the database
   - No waiting for batch updates - stats are always current
   - Level progression checks run on every message

2. **More Frequent Database Updates**

   - Real-time updates for individual messages
   - Batch fallback updates every 10 messages (if real-time fails)
   - Periodic sync updates run every 15 minutes

3. **Proper Counter Initialization**

   - Message counters now initialize from database values when the bot starts
   - This prevents loss of message history on bot restarts

4. **Better Database Handling**

   - Added logic to never decrease message counts in the database
   - Fixed issues with data type handling for numeric fields
   - Enhanced logging for tracking message count changes
   - In-memory counts stay synchronized with database values

5. **Debugging Endpoint**

   - Added a debugging endpoint at `/api/debug/discord-stats/:serverId`
   - Helps diagnose message tracking issues and manually update counts
   - Requires API key authentication (add `?apiKey=YOUR_API_KEY&update=true` to update)

6. **Improved Error Handling & Logging**
   - Added more detailed logging with category prefixes
   - Better validation in API endpoints to prevent data loss
   - Clear error messages to diagnose specific issues
   - Fallback mechanisms if real-time updates fail

These improvements ensure that Discord messages are properly counted, stored in the database, and reflected in the user's level progression immediately after they occur.

## NFT Minting System

The API includes a blockchain-based NFT minting system for the BioDAO onboarding flow:

1. **On-Chain Minting**: When users reach appropriate stages in the onboarding process, the system mints NFTs directly to their wallet addresses on the Base Sepolia blockchain.

2. **NFT Types**:

   - **Idea NFT**: Represents the user's scientific idea or concept
   - **Hypothesis NFT**: Represents the user's scientific hypothesis

3. **Technical Implementation**:

   - Uses Zora Protocol SDK for minting ERC-1155 tokens
   - Mints are performed by a server-managed wallet
   - All transactions are recorded on-chain with confirmation validation
   - Transaction hashes are stored in the database for reference

4. **Configuration**:

   - Requires `NFT_MINTER_PRIVATE_KEY` in the environment variables
   - Uses Base Sepolia network for testnet deployment
   - Can be modified for mainnet deployment

5. **Usage via CoreAgent**:
   - Users can request NFT minting via the chat interface
   - The system detects intent and triggers minting automatically
   - Successful mints are recorded and contribute to level progression
   - Users receive confirmation with transaction details

This system ensures that all scientific contributions are properly recorded on-chain, allowing users to demonstrate ownership of their ideas and hypotheses in a verifiable, decentralized manner.

## NFT Functionality

The BioDAO Portal supports minting NFTs on the Base Sepolia testnet using the Zora protocol. There are two types of NFTs that can be minted:

1. **Idea NFT** - Represents the scientific idea or concept
2. **Hypothesis NFT** - Represents the scientific hypothesis or vision

### Automatic Image Generation

When a user mints an NFT, the system automatically generates a custom image based on:

- For Idea NFTs: The project description
- For Hypothesis NFTs: The project vision statement

The image generation is powered by DALL-E-3 via the OpenAI API and creates thematic visual representations:

- Idea NFTs feature abstract, minimalist science concept art with light blue and white colors
- Hypothesis NFTs feature forward-looking visualization with purple and gold accents

Images are stored locally in the `/public/images` directory and the URL is saved in the NFT record.

### NFT Minting Process

1. User initiates minting through the chat interface
2. The system mints the NFT on-chain using the Zora protocol
3. An AI-generated image is created based on the project details
4. The NFT is stored in the database with a link to the transaction and image
5. The user is notified of the successful minting

### Requirements

To use the NFT functionality, you need to set up:

- `NFT_MINTER_PRIVATE_KEY` - The private key for the wallet that will mint NFTs
- `OPENAI_API_KEY` - API key for generating NFT images

## Email Notifications

The BioDAO CoreAgent API includes an email notification system that sends emails to users when they level up and to the Bio team when a user reaches the sandbox level (Level 4).

### Configuration

To configure the email system, add the following variables to your `.env` file:

```
# Mailgun Configuration
MAILGUN_API_KEY="your_mailgun_api_key"
MAILGUN_DOMAIN="your_mailgun_domain.mailgun.org"
MAILGUN_REGION="us" # or "eu" for European region
FROM_EMAIL="BioDAO <noreply@your_domain.com>"
SANDBOX_NOTIFICATION_EMAIL="team@your_domain.com"
```

### Testing Emails

You can test the email functionality by running:

```bash
npx ts-node src/test-email.ts
```

### Email Types

1. **Level Up Emails**: Sent to users when they reach a new level in their BioDAO journey. These emails include congratulations and information about the next level's requirements.

2. **Sandbox Notification Emails**: Sent to the Bio team when a user reaches Level 4 (the sandbox level). These emails include the user's project details and community statistics.

### Implementation

The email functionality is implemented in `src/services/email.service.ts` using Mailgun.js. The service is integrated with the level-up process in the WebSocket handler.
