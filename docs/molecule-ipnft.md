# Molecule IP-NFT Service

This document describes how to use the Molecule IP-NFT service in the BioDAO platform.

## Overview

The Molecule IP-NFT service allows BioDAO projects to mint specialized NFTs that represent intellectual property rights and legal agreements. These NFTs follow Molecule's IP-NFT standard and can be used to establish ownership of research data, patents, and other scientific IP.

## Configuration

To use the IP-NFT service, add the following environment variables to your `.env` file:

```
# Web3.storage token for IPFS uploads
WEB3_STORAGE_TOKEN=your_web3_storage_token

# Molecule IP-NFT settings
IPNFT_MINTER_PRIVATE_KEY=0xYourPrivateKeyHere
IPNFT_NETWORK=goerli  # Use 'goerli' for testing or 'mainnet' for production
ENABLE_REAL_MINTING=false  # Set to 'true' for real blockchain transactions
```

### Required Environment Variables

- **WEB3_STORAGE_TOKEN**: API token for web3.storage, used for uploading files to IPFS
- **IPNFT_MINTER_PRIVATE_KEY**: Private key of the Ethereum wallet that will pay for minting transactions
- **IPNFT_NETWORK**: Network to use (`goerli` for testnet, `mainnet` for production)
- **ENABLE_REAL_MINTING**: Whether to perform real blockchain transactions (`true`) or simulations (`false`)

## API Endpoints

The following REST API endpoints are available:

### GET `/api/ipnft/:projectId`

Get all IP-NFTs for a project.

### POST `/api/ipnft/upload-document`

Upload a document (PDF, etc.) to IPFS.

**Request Format**:
- Content-Type: `multipart/form-data`
- Fields:
  - `document`: The file to upload

**Response**:
```json
{
  "uri": "ipfs://...",
  "contentHash": "...",
  "name": "filename.pdf",
  "mimeType": "application/pdf"
}
```

### POST `/api/ipnft/upload-image`

Upload an image to IPFS.

**Request Format**:
- Content-Type: `multipart/form-data`
- Fields:
  - `image`: The image file to upload

**Response**:
```json
{
  "uri": "ipfs://...",
  "name": "image.png",
  "mimeType": "image/png"
}
```

### POST `/api/ipnft/generate-terms`

Generate a terms signature message that must be signed by the user.

**Request Format**:
```json
{
  "agreementHashes": {
    "Sponsored Research Agreement": "bagaaiera7ftqs3jmnoph3zgq67bgjrszlqtxkk5ygadgjvnihukrqioipndq",
    "Assignment Agreement": "bagaaiera7ftqs3jmnoph3zgq67bgjrszlqtxkk5ygadgjvnihukrqioipndq"
  },
  "chainId": 5
}
```

**Response**:
```json
{
  "termsMessage": "I accept the IP-NFT minting terms\n\nI have read and agreed to...\n\nVersion: 1\nChain ID: 5"
}
```

### POST `/api/ipnft/mint`

Mint a new IP-NFT.

**Request Format**:
```json
{
  "projectId": "project-uuid",
  "walletAddress": "0x...",
  "projectName": "My Research Project",
  "description": "This is a research project about...",
  "agreements": [
    {
      "type": "License Agreement",
      "url": "ipfs://...",
      "mime_type": "application/pdf",
      "content_hash": "bagaaiera7ftqs3jmnoph3zgq67bgjrszlqtxkk5ygadgjvnihukrqioipndq"
    }
  ],
  "projectDetails": {
    "industry": "Biotechnology",
    "organization": "My Lab",
    "topic": "Cancer Research",
    "funding_amount": {
      "value": 100000,
      "decimals": 2,
      "currency": "USD",
      "currency_type": "ISO4217"
    },
    "research_lead": {
      "name": "Dr. Jane Doe",
      "email": "jane@example.com"
    }
  },
  "imageUri": "ipfs://...",
  "termsSignature": "0x..."
}
```

**Response**:
```json
{
  "success": true,
  "tokenId": "123",
  "transactionHash": "0x..."
}
```

## IP-NFT Minting Flow

1. Upload all legal documents using the `/api/ipnft/upload-document` endpoint
2. Upload an image using the `/api/ipnft/upload-image` endpoint
3. Generate terms using the `/api/ipnft/generate-terms` endpoint
4. Sign the terms message with the user's wallet
5. Mint the IP-NFT using the `/api/ipnft/mint` endpoint

## Error Handling

All endpoints return a standard error format:

```json
{
  "error": "Error message description"
}
```

Common error scenarios:
- Missing required fields
- Invalid file formats
- Failed IPFS uploads
- Invalid signatures
- Failed blockchain transactions 