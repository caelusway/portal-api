#!/usr/bin/env node
/**
 * Test Script for Coaching Agent
 * 
 * This script tests the coaching agent functionality by:
 * 1. Checking the database connection and schema
 * 2. Verifying document chunks are available
 * 3. Running a test query against the coaching agent
 * 
 * Usage:
 *   npx ts-node src/coaching-agent/scripts/testCoachingAgent.ts [query]
 * 
 * Example:
 *   npx ts-node src/coaching-agent/scripts/testCoachingAgent.ts "What is the Guardians Framework?"
 */

import dotenv from 'dotenv';
import path from 'path';
import { getCoachingResponse } from '../coachingAgentService';
import { 
  initializeDatabase,
  retrieveRelevantChunks,
  countChunksBySource,
  pgPool
} from '../vectorStoreService';
import { generateEmbeddings } from '../pdfHandler';

// Load environment variables
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

// Colors for console output
const COLORS = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
};

// Logger utility
const logger = {
  info: (message: string) => console.log(`${COLORS.blue}[INFO]${COLORS.reset} ${message}`),
  success: (message: string) => console.log(`${COLORS.green}[SUCCESS]${COLORS.reset} ${message}`),
  warn: (message: string) => console.log(`${COLORS.yellow}[WARN]${COLORS.reset} ${message}`),
  error: (message: string, error?: any) => {
    console.error(`${COLORS.red}[ERROR]${COLORS.reset} ${message}`);
    if (error) console.error(`${COLORS.dim}${error.stack || error}${COLORS.reset}`);
  },
  separator: () => console.log('-'.repeat(80)),
};

/**
 * Get the total number of document chunks in the database
 */
async function getTotalChunksCount(): Promise<number> {
  const client = await pgPool.connect();
  try {
    const { rows } = await client.query('SELECT COUNT(*) FROM DocumentChunk');
    return parseInt(rows[0].count, 10);
  } catch (error) {
    logger.error('Error getting total chunks count:', error);
    return 0;
  } finally {
    client.release();
  }
}

/**
 * List all sources in the database with their chunk counts
 */
async function listSources(): Promise<Array<{source: string, count: number}>> {
  const client = await pgPool.connect();
  try {
    const { rows } = await client.query(
      'SELECT source, COUNT(*) as count FROM DocumentChunk GROUP BY source ORDER BY count DESC'
    );
    return rows;
  } catch (error) {
    logger.error('Error listing sources:', error);
    return [];
  } finally {
    client.release();
  }
}

/**
 * Run a test query against the coaching agent
 */
async function testQuery(query: string): Promise<void> {
  logger.info(`Running test query: "${query}"`);
  
  // First, generate embeddings for the query to find relevant chunks
  logger.info('Generating query embeddings...');
  const queryEmbeddings = await generateEmbeddings([query]);
  
  if (!queryEmbeddings || queryEmbeddings.length === 0) {
    logger.error('Failed to generate embeddings for query');
    return;
  }
  
  // Retrieve relevant chunks
  logger.info('Retrieving relevant chunks from vector store...');
  const relevantChunks = await retrieveRelevantChunks(queryEmbeddings[0], 3);
  
  logger.info(`Found ${relevantChunks.length} relevant chunks`);
  if (relevantChunks.length > 0) {
    logger.separator();
    logger.info('Top relevant chunks:');
    relevantChunks.forEach((chunk, index) => {
      console.log(`\n${COLORS.cyan}[Chunk ${index + 1}] ${COLORS.bright}Source: ${chunk.source}${COLORS.reset} (Similarity: ${(chunk.similarity || 0).toFixed(4)})`);
      console.log(`${COLORS.dim}${chunk.content.substring(0, 300)}${chunk.content.length > 300 ? '...' : ''}${COLORS.reset}`);
    });
    logger.separator();
  }
  
  // Get response from coaching agent
  logger.info('Getting response from coaching agent...');
  const startTime = Date.now();
  const response = await getCoachingResponse(query);
  const elapsedTime = (Date.now() - startTime) / 1000;
  
  logger.separator();
  logger.success(`Response (generated in ${elapsedTime.toFixed(2)}s):`);
  console.log(`\n${COLORS.green}${response}${COLORS.reset}\n`);
  logger.separator();
}

/**
 * Main function
 */
async function main(): Promise<void> {
  try {
    // Get query from command line args, or use default
    const query = process.argv.slice(2).join(' ') || 'What is the Guardians Framework?';
    
    logger.info('Initializing and testing coaching agent...');
    
    // Step 1: Initialize database schema
    logger.info('Checking database schema...');
    const initialized = await initializeDatabase();
    if (!initialized) {
      logger.error('Failed to initialize database schema. Aborting.');
      process.exit(1);
    }
    logger.success('Database schema is properly set up');
    
    // Step 2: Check if there are document chunks in the database
    logger.info('Checking for document chunks...');
    const totalChunks = await getTotalChunksCount();
    
    if (totalChunks === 0) {
      logger.warn('No document chunks found in the database!');
      logger.info('Please run the ingestPdfs.ts script first to add documents.');
      process.exit(1);
    }
    
    logger.success(`Found ${totalChunks} document chunks in the database`);
    
    // Step 3: List available sources
    const sources = await listSources();
    if (sources.length > 0) {
      logger.info('Available sources:');
      sources.forEach(({ source, count }) => {
        console.log(`  - ${COLORS.bright}${source}${COLORS.reset}: ${count} chunks`);
      });
    }
    
    // Step 4: Run test query
    await testQuery(query);
    
    // Step 5: Clean up
    await pgPool.end();
    logger.info('Database connection closed');
    
  } catch (error) {
    logger.error('An error occurred during testing:', error);
    // Ensure DB connection is closed even on error
    try {
      await pgPool.end();
    } catch (dbError) {
      logger.error('Error closing database connection:', dbError);
    }
    process.exit(1);
  }
}

// Run script
if (require.main === module) {
  main();
} 