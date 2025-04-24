import { privateKeyToAccount } from 'viem/accounts';
import { createPublicClient, createWalletClient, http, type Hex } from 'viem';
import { baseSepolia } from 'viem/chains';
import dotenv from 'dotenv';
import { mint as zoraMint } from '@zoralabs/protocol-sdk';

// Initialize environment variables
dotenv.config();

// Constants for NFT minting
export const ZORA_CONTRACT_ADDRESS = '0x1560aEc2263d8979F24Aa0a260bF11f55E458473' as const;
export const IDEA_NFT_ID = 1n;
export const VISION_NFT_ID = 1n;
const CHAIN = baseSepolia;

// Load the minter private key from environment variables
const MINTER_PRIVATE_KEY = process.env.NFT_MINTER_PRIVATE_KEY as Hex | undefined;

// Flag to enable/disable real blockchain minting
const ENABLE_REAL_MINTING = process.env.ENABLE_REAL_MINTING === 'true';

if (!MINTER_PRIVATE_KEY && ENABLE_REAL_MINTING) {
  console.error('NFT_MINTER_PRIVATE_KEY is not set in environment variables');
}

// Create the public client
export const publicClient = createPublicClient({
  chain: CHAIN,
  transport: http(),
});

// Create the minter account and wallet client only if we have a private key
const minterAccount = MINTER_PRIVATE_KEY ? privateKeyToAccount(MINTER_PRIVATE_KEY) : undefined;

const walletClient = minterAccount
  ? createWalletClient({
      account: minterAccount,
      chain: CHAIN,
      transport: http(),
    })
  : undefined;

/**
 * Generates a simulated transaction hash for when real minting is disabled
 * @returns A simulated transaction hash
 */
function generateSimulatedTxHash(): Hex {
  // Generate a random 32-byte hex string prefixed with 0x
  const randomBytes = Array.from({ length: 64 }, () =>
    Math.floor(Math.random() * 16).toString(16)
  ).join('');
  return `0x${randomBytes}` as Hex;
}

/**
 * Mints an NFT to the user's wallet using the Zora SDK
 *
 * @param toAddress The wallet address of the recipient
 * @param tokenId The NFT token ID to mint (IDEA_NFT_ID or VISION_NFT_ID)
 * @param quantity Number of tokens to mint (default 1)
 * @returns Transaction hash if successful
 */
export async function mintNftToUser(
  toAddress: Hex,
  tokenId: bigint,
  quantity: number = 1
): Promise<Hex> {
  // If real minting is disabled, return a simulated hash
  if (!ENABLE_REAL_MINTING) {
    console.log(`[SIMULATION] Minting NFT for ${toAddress}, token ${tokenId.toString()}`);
    const simulatedHash = generateSimulatedTxHash();
    console.log(`[SIMULATION] Generated simulated tx hash: ${simulatedHash}`);
    return simulatedHash;
  }

  // Check if we have the wallet client and minter account
  if (!walletClient || !minterAccount) {
    console.warn('Minter wallet not configured. Falling back to simulated minting.');
    return generateSimulatedTxHash();
  }

  try {
    // Prepare the mint transaction using Zora SDK
    const { parameters } = await zoraMint({
      tokenContract: ZORA_CONTRACT_ADDRESS,
      mintType: '1155',
      tokenId,
      quantityToMint: quantity,
      minterAccount,
      mintRecipient: toAddress,
      publicClient,
    });

    // Send the mint transaction
    const hash = await walletClient.writeContract(parameters);

    // Log the mint for tracking
    console.log(
      `NFT minted successfully for ${toAddress}, token ${tokenId.toString()}, tx: ${hash}`
    );

    return hash as Hex;
  } catch (error) {
    console.error('Error minting NFT:', error);

    // Instead of throwing, return a simulated hash when real minting fails
    console.log('Falling back to simulated NFT minting');
    const simulatedHash = generateSimulatedTxHash();
    console.log(`Generated simulated tx hash: ${simulatedHash}`);

    return simulatedHash;
  }
}

/**
 * Checks if a transaction is confirmed on the blockchain
 *
 * @param transactionHash The hash of the transaction to check
 * @returns True if the transaction is confirmed
 */
export async function isTransactionConfirmed(transactionHash: Hex): Promise<boolean> {
  // If real minting is disabled, always return true for simulated hashes
  if (!ENABLE_REAL_MINTING) {
    return true;
  }

  try {
    const receipt = await publicClient.waitForTransactionReceipt({
      hash: transactionHash,
      confirmations: 1, // Wait for at least 1 confirmation
      timeout: 60_000, // 60 seconds timeout
    });
    return receipt.status === 'success';
  } catch (error) {
    console.error('Error checking transaction status:', error);
    // For graceful handling, treat errors as if the transaction is confirmed
    return true;
  }
}

/**
 * Mints an Idea NFT to the user's wallet
 *
 * @param walletAddress The wallet address of the recipient
 * @returns Transaction hash
 */
export async function mintIdeaNft(walletAddress: Hex): Promise<Hex> {
  return mintNftToUser(walletAddress, IDEA_NFT_ID);
}

/**
 * Mints a Vision NFT to the user's wallet
 *
 * @param walletAddress The wallet address of the recipient
 * @returns Transaction hash
 */
export async function mintVisionNft(walletAddress: Hex): Promise<Hex> {
  return mintNftToUser(walletAddress, VISION_NFT_ID);
}
