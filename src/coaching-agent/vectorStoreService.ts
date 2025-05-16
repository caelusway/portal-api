import { Pool, PoolConfig, PoolClient } from 'pg'; // Using Pool for managing connections
import dotenv from 'dotenv';
import path from 'path';

// Load environment variables to ensure they're available
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

// --- PostgreSQL Client Setup (pgvector) ---
// Configure PostgreSQL connection
// Prioritize connection string URL if available, fall back to individual params
const pgConfig: PoolConfig = process.env.PGVECTOR_URL 
  ? { connectionString: process.env.PGVECTOR_URL } 
  : {
      user: process.env.PGVECTOR_USER || 'your_pg_user',
      host: process.env.PGVECTOR_HOST || 'localhost',
      database: process.env.PGVECTOR_DATABASE || 'your_pg_database_for_vectors',
      password: process.env.PGVECTOR_PASSWORD || 'your_pg_password',
      port: parseInt(process.env.PGVECTOR_PORT || '5432', 10),
    };

// SSL configuration (often needed for cloud providers)
if (process.env.PGVECTOR_SSL === 'true') {
  pgConfig.ssl = process.env.PGVECTOR_SSL_REJECT_UNAUTHORIZED === 'false' 
    ? { rejectUnauthorized: false }
    : true;
}

// Add connection pool configuration
const poolConfig = {
  ...pgConfig,
  max: 20, // Maximum number of clients in the pool
  idleTimeoutMillis: 30000, // How long a client is allowed to remain idle (30 seconds)
  connectionTimeoutMillis: 5000, // How long to wait for a connection (5 seconds)
};

// Create the connection pool
const pgPool = new Pool(poolConfig);

// Handle pool errors
pgPool.on('error', (err) => {
  console.error('Unexpected error on pgvector pool client:', err);
});

// Connection acquisition wrapper with retry logic
async function getClient(retryCount = 3): Promise<PoolClient> {
  try {
    return await pgPool.connect();
  } catch (error) {
    if (retryCount > 0) {
      console.warn(`Failed to acquire pgvector client, retrying (${retryCount} attempts left)...`);
      await new Promise(resolve => setTimeout(resolve, 1000)); // Wait 1 second before retry
      return getClient(retryCount - 1);
    }
    console.error('Failed to acquire pgvector client after multiple attempts:', error);
    throw error;
  }
}

/**
 * Initialize the database schema by creating the necessary tables and indices.
 */
export async function initializeDatabase(): Promise<boolean> {
  let client: PoolClient | null = null;
  try {
    client = await getClient();
    
    // First check if pgvector extension is installed
    const pgvectorCheck = await client.query("SELECT COUNT(*) FROM pg_extension WHERE extname = 'vector'");
    if (parseInt(pgvectorCheck.rows[0].count, 10) === 0) {
      console.warn('WARNING: pgvector extension does not appear to be installed on this database.');
      console.warn('Attempting to create pgvector extension...');
      
      try {
        await client.query('CREATE EXTENSION IF NOT EXISTS vector;');
        console.log('Successfully created pgvector extension.');
      } catch (err) {
        console.error('Failed to create pgvector extension:', err);
        console.error('You may need to run "CREATE EXTENSION vector;" manually as a database superuser.');
        return false;
      }
    } else {
      console.log('pgvector extension is installed.');
    }
    
    // Create document chunk table
    await client.query(`
      CREATE TABLE IF NOT EXISTS DocumentChunk (
        id SERIAL PRIMARY KEY,
        content TEXT NOT NULL,
        embedding VECTOR(1536) NOT NULL,
        source VARCHAR(255) NOT NULL,
        metadata JSONB,
        createdAt TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(content, source)
      );
    `);
    
    // Check if the index already exists
    const indexCheck = await client.query(`
      SELECT COUNT(*) FROM pg_indexes 
      WHERE indexname = 'idx_embedding';
    `);
    
    // Create index if it doesn't exist
    if (parseInt(indexCheck.rows[0].count, 10) === 0) {
      console.log('Creating vector index for efficient similarity search...');
      try {
        // Try creating HNSW index first (more efficient but requires newer pgvector)
        await client.query(`
          CREATE INDEX idx_embedding ON DocumentChunk USING HNSW (embedding vector_l2_ops) WITH (m = 16, ef_construction = 64);
        `);
        console.log('Created HNSW vector index successfully.');
      } catch (hnswerr) {
        console.warn('Failed to create HNSW index, falling back to IVFFlat index:', hnswerr);
        try {
          // Fall back to IVFFlat index which works on older pgvector
          await client.query(`
            CREATE INDEX idx_embedding ON DocumentChunk USING ivfflat (embedding vector_l2_ops) WITH (lists = 100);
          `);
          console.log('Created IVFFlat vector index successfully.');
        } catch (ivferr) {
          console.error('Failed to create vector index:', ivferr);
          // Even without an index, the database will work (just slower)
        }
      }
    }
    
    console.log('Database schema initialization complete.');
    return true;
  } catch (error) {
    console.error('Error initializing database schema:', error);
    return false;
  } finally {
    if (client) client.release();
  }
}

// Test the connection on startup and initialize database
(async () => {
  let client: PoolClient | null = null;
  try {
    client = await getClient();
    console.log('Successfully connected to pgvector PostgreSQL database at:', 
      (await client.query('SELECT NOW()')).rows[0]?.now);
    
    // Initialize the database schema
    await initializeDatabase();
  } catch (error) {
    console.error('Error connecting to pgvector PostgreSQL database:', error);
  } finally {
    if (client) client.release();
  }
})();

// --- End PostgreSQL Client Setup ---

// Export the pgPool for graceful shutdown in scripts
export { pgPool };

/**
 * Stores document chunks and their embeddings in the pgvector database.
 * @param chunks An array of objects, each containing the text chunk, its embedding, and source.
 */
export async function storeDocumentChunks(chunks: Array<{ chunk: string; embedding: number[]; source: string; metadata?: object }>): Promise<void> {
  if (!chunks || chunks.length === 0) {
    return;
  }
  
  const client = await getClient();
  try {
    await client.query('BEGIN'); // Start transaction

    const queryText = `
      INSERT INTO DocumentChunk (content, embedding, source, metadata)
      VALUES ($1, $2::vector, $3, $4)
      ON CONFLICT (content, source) DO NOTHING;
    `; // Example: Skip if content from same source exists, adjust as needed

    for (const item of chunks) {
      const embeddingString = `[${item.embedding.join(',')}]`;
      await client.query(queryText, [item.chunk, embeddingString, item.source, item.metadata || null]);
    }

    await client.query('COMMIT'); // Commit transaction
    console.log(`Successfully stored ${chunks.length} document chunks in pgvector.`);
  } catch (error) {
    await client.query('ROLLBACK'); // Rollback on error
    console.error('Error storing document chunks in pgvector:', error);
    throw new Error('Failed to store document chunks in pgvector database.');
  } finally {
    client.release();
  }
}

/**
 * Retrieves relevant document chunks from the pgvector store based on a query embedding.
 * @param queryEmbedding The embedding of the user's query.
 * @param topK The number of top matching chunks to retrieve.
 * @returns An array of relevant document chunks.
 */
export async function retrieveRelevantChunks(queryEmbedding: number[], topK = 5): Promise<Array<{ id: string; content: string; source: string; similarity?: number }>> {
  if (!queryEmbedding || queryEmbedding.length === 0) {
    return [];
  }
  
  const client = await getClient();
  try {
    const embeddingString = `[${queryEmbedding.join(',')}]`;
    
    // Use a more sophisticated query with hybrid retrieval:
    // 1. Vector similarity search for semantic matching
    // 2. Optional text matching for better precision (uncomment if needed)
    const queryText = `
      WITH vector_matches AS (
        SELECT id, content, source, 1 - (embedding <=> $1::vector) AS similarity
        FROM DocumentChunk
        -- WHERE content ILIKE $3 -- Uncomment for text filtering
        ORDER BY similarity DESC
        LIMIT $2
      )
      SELECT * FROM vector_matches
      -- UNION ALL
      -- SELECT id, content, source, 0.5 AS similarity -- Lower base similarity score for text matches
      -- FROM DocumentChunk
      -- WHERE content ILIKE $3
      -- AND id NOT IN (SELECT id FROM vector_matches)
      -- LIMIT $2
      ORDER BY similarity DESC
      LIMIT $2;
    `;

    const { rows } = await client.query(queryText, [
      embeddingString, 
      topK,
      // `%${query.replace(/[%_]/g, c => `\\${c}`)}%` // Escaping for ILIKE - uncomment if using text filtering
    ]);
    
    console.log(`Retrieved ${rows.length} relevant chunks from pgvector.`);
    return rows.map(row => ({ 
      ...row, 
      id: String(row.id),
      similarity: typeof row.similarity === 'number' ? row.similarity : 0 
    }));
  } catch (error) {
    console.error('Error retrieving relevant chunks from pgvector:', error);
    throw new Error('Failed to retrieve relevant chunks from pgvector database.');
  } finally {
    client.release();
  }
}

/**
 * Clears all document chunks for a specific source from pgvector.
 * @param sourceIdentifier The identifier of the source (e.g., PDF filename) to clear.
 */
export async function clearDocumentChunksBySource(sourceIdentifier: string): Promise<void> {
  const client = await getClient();
  try {
    const queryText = 'DELETE FROM DocumentChunk WHERE source = $1;';
    const res = await client.query(queryText, [sourceIdentifier]);
    console.log(`Successfully deleted ${res.rowCount} chunks for source: ${sourceIdentifier} from pgvector`);
  } catch (error) {
    console.error(`Error clearing document chunks for source ${sourceIdentifier} from pgvector:`, error);
    throw new Error(`Failed to clear document chunks for source ${sourceIdentifier}.`);
  } finally {
    client.release();
  }
}

/**
 * Clears all document chunks from the pgvector store.
 * Useful for a complete reset if needed.
 */
export async function clearAllDocumentChunks(): Promise<void> {
  const client = await getClient();
  try {
    const queryText = 'DELETE FROM DocumentChunk;';
    const res = await client.query(queryText);
    console.log(`Successfully deleted all ${res.rowCount} document chunks from pgvector.`);
  } catch (error) {
    console.error('Error clearing all document chunks from pgvector:', error);
    throw new Error('Failed to clear all document chunks from pgvector.');
  } finally {
    client.release();
  }
}

/**
 * Check if chunks exist for a given source.
 * @param sourceIdentifier The source identifier to check.
 * @returns Number of chunks found for the source.
 */
export async function countChunksBySource(sourceIdentifier: string): Promise<number> {
  const client = await getClient();
  try {
    const queryText = 'SELECT COUNT(*) FROM DocumentChunk WHERE source = $1;';
    const { rows } = await client.query(queryText, [sourceIdentifier]);
    return parseInt(rows[0].count, 10);
  } catch (error) {
    console.error(`Error counting chunks for source ${sourceIdentifier}:`, error);
    return 0; // Return 0 on error
  } finally {
    client.release();
  }
}

/**
 * Get database statistics for monitoring
 */
export async function getDatabaseStats(): Promise<any> {
  const client = await getClient();
  try {
    const stats: {
      totalChunks: number;
      sources: Array<{source: string; count: string | number}>;
      databaseSize: string;
      indexSize: string;
    } = {
      totalChunks: 0,
      sources: [],
      databaseSize: '',
      indexSize: '',
    };
    
    // Get total chunks
    const countResult = await client.query('SELECT COUNT(*) FROM DocumentChunk');
    stats.totalChunks = parseInt(countResult.rows[0].count, 10);
    
    // Get sources
    const sourcesResult = await client.query('SELECT source, COUNT(*) FROM DocumentChunk GROUP BY source ORDER BY COUNT(*) DESC');
    stats.sources = sourcesResult.rows;
    
    // Get database and index size (if user has permissions)
    try {
      const sizeResult = await client.query(`
        SELECT pg_size_pretty(pg_total_relation_size('DocumentChunk')) AS total_size,
               pg_size_pretty(pg_indexes_size('DocumentChunk')) AS index_size;
      `);
      if (sizeResult.rows.length > 0) {
        stats.databaseSize = sizeResult.rows[0].total_size;
        stats.indexSize = sizeResult.rows[0].index_size;
      }
    } catch (err) {
      console.warn('Unable to get database size statistics (insufficient permissions):', err);
    }
    
    return stats;
  } catch (error) {
    console.error('Error getting database statistics:', error);
    throw new Error('Failed to retrieve database statistics.');
  } finally {
    client.release();
  }
} 