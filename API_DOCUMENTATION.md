# BioDAO API Documentation

## Table of Contents
- [Authentication](#authentication)
- [Projects](#projects)
- [Users](#users)
- [Chat](#chat)
- [Discord](#discord)
- [NFTs](#nfts)
- [Invites](#invites)
- [Referrals](#referrals)

## Authentication

### Authenticate User
```
POST /api/auth/privy
```

**Request Body:**
```json
{
  "wallet": "0x...",
  "privyId": "privy_..."
}
```

**Response:**
```json
{
  "userId": "user-uuid",
  "privyId": "privy_...",
  "level": 1
}
```

### Get User by PrivyId
```
GET /api/auth/user/:privyId
```

**Response:**
```json
{
  "id": "user-uuid",
  "privyId": "privy_...",
  "level": 1,
  "wallet": "0x..."
}
```

## Projects

### Get Project
```
GET /api/projects/:id
```

**Response:**
```json
{
  "id": "project-uuid",
  "level": 1,
  "projectName": "Project Name",
  "projectDescription": "Description..."
}
```

### Update Project
```
PUT /api/projects/:id
```

**Request Body:**
```json
{
  "projectName": "Updated Name",
  "projectDescription": "Updated description"
}
```

### Get Project by PrivyId
```
GET /api/projects/privy/:privyId
```

**Response:**
```json
{
  "id": "project-uuid",
  "level": 1,
  "projectName": "Project Name",
  "Discord": {...},
  "NFTs": [...]
}
```

### Create/Update Project by PrivyId
```
POST /api/projects/privy/:privyId
```

**Request Body:**
```json
{
  "projectName": "Project Name",
  "projectDescription": "Description",
  "wallet": "0x..."
}
```

### Delete Project
```
DELETE /api/projects/privy/:privyId
```

### Get NFTs by Project ID
```
GET /api/projects/:projectId/nfts
```

### Get Discord Info by Project ID
```
GET /api/projects/:projectId/discord
```

### Get Project by Wallet
```
GET /api/projects/wallet/:wallet
```

### Create or Update Project
```
POST /api/projects
```

**Request Body:**
```json
{
  "privyId": "privy_...",
  "wallet": "0x...",
  "projectName": "Project Name",
  "projectDescription": "Description"
}
```

### Send Project Invitation
```
POST /api/projects/:projectId/invites
```

**Request Body:**
```json
{
  "userId": "user-uuid",
  "inviteeEmail": "email@example.com"
}
```

**Response:**
```json
{
  "message": "Invitation sent successfully",
  "invite": {
    "id": "invite-uuid",
    "inviteeEmail": "email@example.com",
    "status": "pending",
    "expiresAt": "2023-..."
  }
}
```

### Get Project Members
```
GET /api/projects/:projectId/members
```

**Response:**
```json
[
  {
    "id": "member-uuid",
    "role": "founder",
    "bioUser": {
      "id": "user-uuid",
      "fullName": "User Name",
      "email": "user@example.com"
    }
  }
]
```

### Remove Project Member
```
DELETE /api/members/:id
```

**Response:**
```json
{
  "success": true,
  "message": "Project member removed successfully",
  "projectId": "project-uuid"
}
```

### Update Project Member Role
```
PUT /api/members/:id
```

**Request Body:**
```json
{
  "role": "admin"
}
```

**Response:**
```json
{
  "id": "member-uuid",
  "projectId": "project-uuid",
  "bioUserId": "user-uuid",
  "role": "admin",
  "project": {
    "id": "project-uuid",
    "projectName": "Project Name"
  },
  "bioUser": {
    "id": "user-uuid",
    "fullName": "User Name",
    "email": "user@example.com",
    "avatarUrl": "https://example.com/avatar.jpg"
  }
}
```

## Users

### Create BioUser
```
POST /api/users
```

**Request Body:**
```json
{
  "privyId": "privy_...",
  "wallet": "0x...",
  "email": "email@example.com",
  "fullName": "User Name"
}
```

### Get BioUser
```
GET /api/users/:id
```

### Get BioUser by PrivyId
```
GET /api/users/privy/:privyId
```

### Get BioUser by Wallet
```
GET /api/users/wallet/:wallet
```

### Update BioUser
```
PUT /api/users/:id
```

**Request Body:**
```json
{
  "email": "newemail@example.com",
  "fullName": "New Name"
}
```

### Update BioUser by PrivyId
```
PUT /api/users/privy/:privyId
```

### Delete BioUser
```
DELETE /api/users/:id
```

### Get User Memberships
```
GET /api/users/:id/memberships
```

### Add User Membership
```
POST /api/users/:id/memberships
```

**Request Body:**
```json
{
  "projectId": "project-uuid",
  "role": "member"
}
```

### Update User Membership
```
PUT /api/users/:id/memberships/:membershipId
```

**Request Body:**
```json
{
  "role": "admin"
}
```

### Remove User Membership
```
DELETE /api/users/:id/memberships/:membershipId
```

### Get User Referrals
```
GET /api/users/:id/referrals
```

### Get User Referral Code
```
GET /api/users/:id/referral-code
```

### Generate New Referral Code
```
POST /api/users/:id/referral-code
```

### Apply Referral Code
```
POST /api/users/:id/apply-referral
```

**Request Body:**
```json
{
  "referralCode": "ABCD1234"
}
```

### Connect Discord Account
```
POST /api/users/:id/connect-discord
```

**Request Body:**
```json
{
  "discordId": "discord-user-id",
  "discordUsername": "username#1234",
  "discordAvatar": "avatar-url",
  "discordAccessToken": "access-token",
  "discordRefreshToken": "refresh-token"
}
```

**Response:**
```json
{
  "id": "user-uuid",
  "discordId": "discord-user-id",
  "discordUsername": "username#1234",
  "discordAvatar": "avatar-url",
  "discordConnectedAt": "2023-..."
}
```

### Get Discord Connection
```
GET /api/users/:id/discord
```

**Response:**
```json
{
  "discordId": "discord-user-id",
  "discordUsername": "username#1234",
  "discordAvatar": "avatar-url",
  "discordConnectedAt": "2023-..."
}
```

### Disconnect Discord Account
```
DELETE /api/users/:id/disconnect-discord
```

### Refresh Discord Tokens
```
PUT /api/users/:id/refresh-discord
```

**Request Body:**
```json
{
  "discordAccessToken": "new-access-token",
  "discordRefreshToken": "new-refresh-token"
}
```

### Connect Twitter Account
```
POST /api/users/:id/connect-twitter
```

**Request Body:**
```json
{
  "twitterId": "twitter-user-id",
  "twitterUsername": "username",
  "twitterName": "Display Name",
  "twitterAvatar": "avatar-url",
  "twitterAccessToken": "access-token",
  "twitterRefreshToken": "refresh-token"
}
```

**Response:**
```json
{
  "id": "user-uuid",
  "twitterId": "twitter-user-id",
  "twitterUsername": "username",
  "twitterName": "Display Name",
  "twitterAvatar": "avatar-url",
  "twitterConnectedAt": "2023-..."
}
```

### Get Twitter Connection
```
GET /api/users/:id/twitter
```

**Response:**
```json
{
  "twitterId": "twitter-user-id",
  "twitterUsername": "username",
  "twitterName": "Display Name",
  "twitterAvatar": "avatar-url",
  "twitterConnectedAt": "2023-..."
}
```

### Disconnect Twitter Account
```
DELETE /api/users/:id/disconnect-twitter
```

### Refresh Twitter Tokens
```
PUT /api/users/:id/refresh-twitter
```

**Request Body:**
```json
{
  "twitterAccessToken": "new-access-token",
  "twitterRefreshToken": "new-refresh-token"
}
```

## Chat

### Get Chat Sessions
```
GET /api/chat/sessions/:userId
```

### Get Chat Messages
```
GET /api/chat/messages/:sessionId
```

### Get Chat Messages (Alternative)
```
GET /api/chat/messages/session/:sessionId
```

### Get Project Chat Sessions
```
GET /api/chat/sessions/project/:projectId
```

### Save Chat Message
```
POST /api/chat/messages/:sessionId
```

**Request Body:**
```json
{
  "content": "Message content",
  "isFromAgent": true,
  "actionTaken": "ACTION_NAME",
  "actionSuccess": true
}
```

## Discord

### Get Discord Stats
```
GET /api/discord/:projectId
```

**Response:**
```json
{
  "success": true,
  "discord": {
    "serverId": "server-id",
    "serverName": "Server Name",
    "memberCount": 10,
    "messagesCount": 100,
    "papersShared": 5,
    "botAdded": true,
    "verified": true
  },
  "level": {
    "current": 2,
    "requirements": {...},
    "progress": {...}
  },
  "botStatus": {
    "installed": true,
    "installationLink": "..."
  }
}
```

### Get Discord Server Info
```
GET /api/discord/info/:serverId
```

### Setup Discord Server
```
POST /api/discord/setup
```

**Request Body:**
```json
{
  "userId": "user-uuid",
  "discordInvite": "https://discord.gg/invite-code"
}
```

### Get Project Discord
```
GET /api/discord/projects/:projectId/discord
```

### Discord Bot Installation Notification
```
POST /api/discord/bot-installed
```

**Request Body:**
```json
{
  "guildId": "discord-guild-id",
  "guildName": "Guild Name",
  "memberCount": 10
}
```

### Update Discord Stats
```
POST /api/discord/stats-update
```

**Request Body:**
```json
{
  "guildId": "discord-guild-id",
  "memberCount": 15,
  "messagesCount": 150,
  "papersShared": 10,
  "qualityScore": 85
}
```

### Check Level Requirements
```
POST /api/discord/check-level-requirements
```

**Request Body:**
```json
{
  "guildId": "discord-guild-id",
  "source": "bot",
  "event": "member-join"
}
```

## NFTs

### Get NFTs
```
GET /api/nfts/:projectId
```

### Mint NFT
```
POST /api/nfts/mint
```

**Request Body:**
```json
{
  "projectId": "project-uuid",
  "walletAddress": "0x...",
  "nftType": "idea"
}
```

## Invites

### Verify Invitation Token
```
GET /api/invites/verify?token=invite-token
```

**Response:**
```json
{
  "valid": true,
  "projectName": "Project Name",
  "projectDescription": "Description",
  "inviterName": "Inviter Name",
  "expiresAt": "2023-..."
}
```

### Accept Invitation
```
POST /api/invites/accept
```

**Request Body:**
```json
{
  "token": "invite-token",
  "userId": "user-uuid"
}
```

## Referrals

### Get Referral Code
```
GET /api/referral/code?projectId=project-uuid
```

### Use Referral Code
```
POST /api/referral/use
```

**Request Body:**
```json
{
  "newProjectId": "project-uuid",
  "code": "ABCD1234"
}
```

### Get Referral Stats
```
GET /api/referral/stats?projectId=project-uuid
``` 