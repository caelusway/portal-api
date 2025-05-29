import crypto from 'crypto';

export interface FileHash {
  filename: string;
  hash: string;
  size: number;
  mimetype: string;
}

export interface MerkleTreeResult {
  root: string;
  tree: string[];
  values: Array<{ value: string; treeIndex: number }>;
}

export interface POIResult {
  root: string;
  merkleTree: {
    format: string;
    tree: string[];
    values: Array<{ value: string; treeIndex: number }>;
  };
  transaction: {
    payload: string;
    recipient: string;
  };
  files: FileHash[];
}

export class POIService {
  private static readonly SUPPORTED_CHAINS = [1, 8453]; // Ethereum Mainnet, Base
  private static readonly API_VERSION = '1.0';
  private static readonly CONTRACT_ADDRESS = process.env.POI_CONTRACT_ADDRESS || '0x1DEA29b04a59000b877979339a457d5aBE315b52';

  /**
   * Hash a file buffer using SHA-256
   */
  static hashFile(fileBuffer: Buffer): string {
    return '0x' + crypto.createHash('sha256').update(fileBuffer).digest('hex');
  }

  /**
   * Create a merkle tree from file hashes
   */
  static createMerkleTree(fileHashes: string[]): MerkleTreeResult {
    if (fileHashes.length === 0) {
      throw new Error('No files provided');
    }

    // Start with the file hashes as leaf nodes
    let currentLevel = [...fileHashes];
    const tree: string[] = [];
    const values = fileHashes.map((hash, index) => ({
      value: hash,
      treeIndex: index + 1
    }));

    // Build the tree bottom-up
    while (currentLevel.length > 1) {
      const nextLevel: string[] = [];
      
      for (let i = 0; i < currentLevel.length; i += 2) {
        const left = currentLevel[i];
        const right = i + 1 < currentLevel.length ? currentLevel[i + 1] : left;
        
        // Create parent hash by combining left and right
        const combined = left + right.slice(2); // Remove '0x' from right hash
        const parentHash = '0x' + crypto.createHash('sha256').update(combined).digest('hex');
        
        nextLevel.push(parentHash);
        tree.push(parentHash);
      }
      
      currentLevel = nextLevel;
    }

    // The root is the last remaining hash
    const root = currentLevel[0];
    
    return {
      root,
      tree: [root, ...tree.reverse()], // Include root at the beginning
      values
    };
  }

  /**
   * Process files and generate proof of invention
   */
  static async generateProofOfInvention(files: Express.Multer.File[]): Promise<POIResult> {
    if (!files || files.length === 0) {
      throw new Error('No files provided');
    }

    // Process each file and create hash information
    const fileHashes: string[] = [];
    const fileInfo: FileHash[] = [];

    for (const file of files) {
      const hash = this.hashFile(file.buffer);
      fileHashes.push(hash);
      
      fileInfo.push({
        filename: file.originalname,
        hash,
        size: file.size,
        mimetype: file.mimetype
      });
    }

    // Create merkle tree
    const merkleTree = this.createMerkleTree(fileHashes);

    // Create transaction payload (the merkle root)
    const transactionPayload = merkleTree.root;

    return {
      root: merkleTree.root,
      merkleTree: {
        format: 'simple-v1',
        tree: merkleTree.tree,
        values: merkleTree.values
      },
      transaction: {
        payload: transactionPayload,
        recipient: this.CONTRACT_ADDRESS
      },
      files: fileInfo
    };
  }

  /**
   * Validate file upload constraints
   */
  static validateFiles(files: Express.Multer.File[]): { valid: boolean; error?: string } {
    if (!files || files.length === 0) {
      return { valid: false, error: 'No files provided. Please upload at least one file.' };
    }

    // Check total file size (100MB limit)
    const totalSize = files.reduce((sum, file) => sum + file.size, 0);
    const maxSize = 100 * 1024 * 1024; // 100MB

    if (totalSize > maxSize) {
      return { 
        valid: false, 
        error: `Total file size (${Math.round(totalSize / 1024 / 1024)}MB) exceeds 100MB limit` 
      };
    }

    return { valid: true };
  }

  /**
   * Get API metadata
   */
  static getMetadata() {
    return {
      supportedEvmChainIds: this.SUPPORTED_CHAINS,
      apiVersion: this.API_VERSION,
      timestamp: new Date().toISOString()
    };
  }

  /**
   * Create error response format
   */
  static createErrorResponse(message: string, code: number) {
    return {
      success: false,
      error: {
        message,
        code
      },
      metadata: this.getMetadata()
    };
  }

  /**
   * Create success response format
   */
  static createSuccessResponse(result: POIResult) {
    return {
      success: true,
      result,
      metadata: this.getMetadata()
    };
  }
}

export default POIService; 