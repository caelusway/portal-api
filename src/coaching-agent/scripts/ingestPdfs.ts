#!/usr/bin/env node
/**
 * PDF Ingestion Script for Coaching Agent
 * 
 * This script processes PDF files, extracts their content, chunks the text,
 * generates embeddings, and stores them in a pgvector database for retrieval.
 * 
 * Usage: 
 *   npx ts-node src/coaching-agent/scripts/ingestPdfs.ts [options] <file1.pdf> <file2.pdf> ... 
 *   npx ts-node src/coaching-agent/scripts/ingestPdfs.ts [options] --dir=<directory>
 * 
 * Options:
 *   --overwrite         Clear existing chunks for each PDF before ingestion.
 *   --dir=<path>        Process all PDFs in the specified directory.
 *   --check-only        Only check if PDFs exist in the vector store, don't ingest.
 *   --concurrency=<n>   Process up to n files concurrently (default: 1).
 *   --verbose           Show detailed logs.
 *   --help              Show this help message.
 */

import dotenv from 'dotenv';
import fs from 'fs/promises';
import path from 'path';
import { processPdfForIngestion } from '../pdfHandler';
import { 
  storeDocumentChunks, 
  clearDocumentChunksBySource,
  countChunksBySource,
  pgPool,
  initializeDatabase
} from '../vectorStoreService';

// Load environment variables from .env file
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

// Default options
const DEFAULT_OPTIONS = {
  overwrite: false,
  checkOnly: false,
  concurrency: 1,
  verbose: false,
  help: false,
  dir: '',
};

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
  verbose: (message: string, options: typeof DEFAULT_OPTIONS) => {
    if (options.verbose) {
      console.log(`${COLORS.dim}[VERBOSE]${COLORS.reset} ${message}`);
    }
  },
  separator: () => console.log('-'.repeat(80)),
};

/**
 * Process a single PDF file: read, chunk, embed, and store
 */
async function ingestSinglePdf(
  filePath: string, 
  options: typeof DEFAULT_OPTIONS
): Promise<boolean> {
  const absoluteFilePath = path.resolve(filePath);
  const fileName = path.basename(absoluteFilePath);
  
  logger.info(`Processing PDF: ${COLORS.bright}${fileName}${COLORS.reset}`);
  const startTime = Date.now();

  try {
    // 1. Check if file exists
    try {
      await fs.access(absoluteFilePath);
    } catch (error) {
      logger.error(`File not found: ${absoluteFilePath}`);
      return false;
    }

    // 2. Check if chunks already exist for this source
    const existingChunksCount = await countChunksBySource(fileName);
    
    if (existingChunksCount > 0) {
      logger.warn(`Found ${existingChunksCount} existing chunks for source: ${fileName}`);
      
      if (options.checkOnly) {
        logger.info(`Skipping ${fileName} (--check-only flag is set)`);
        return true;
      }
      
      if (!options.overwrite) {
        logger.warn(`Skipping ${fileName} (use --overwrite to replace existing chunks)`);
        return true;
      }
      
      logger.info(`Clearing ${existingChunksCount} existing chunks for ${fileName}...`);
      await clearDocumentChunksBySource(fileName);
      logger.success(`Cleared existing chunks for ${fileName}`);
    } else if (options.checkOnly) {
      logger.warn(`No chunks found for ${fileName} (--check-only flag is set)`);
      return true;
    }

    // 3. Read the file
    logger.verbose(`Reading file: ${absoluteFilePath}`, options);
    const pdfBuffer = await fs.readFile(absoluteFilePath);
    logger.verbose(`Read ${pdfBuffer.length} bytes`, options);

    // 4. Process the PDF: parse, chunk, generate embeddings
    logger.info(`Processing content of ${fileName}...`);
    const chunksWithEmbeddings = await processPdfForIngestion(pdfBuffer, fileName);

    // 5. Store the chunks in pgvector if we got any
    if (chunksWithEmbeddings.length > 0) {
      logger.info(`Generated ${chunksWithEmbeddings.length} chunks with embeddings for ${fileName}`);
      
      const metadata = {
        filename: fileName,
        path: absoluteFilePath,
        processingDate: new Date().toISOString(),
      };
      
      // Add metadata to each chunk
      const chunksWithMetadata = chunksWithEmbeddings.map(item => ({
        ...item,
        metadata
      }));
      
      // Store in database
      await storeDocumentChunks(chunksWithMetadata);
      
      const elapsedTime = ((Date.now() - startTime) / 1000).toFixed(2);
      logger.success(
        `Successfully stored ${chunksWithEmbeddings.length} chunks for ${fileName} in pgvector (${elapsedTime}s)`
      );
      return true;
    } else {
      logger.warn(`No chunks were generated for ${fileName}. The PDF might be empty or could not be processed.`);
      return false;
    }
  } catch (error) {
    const elapsedTime = ((Date.now() - startTime) / 1000).toFixed(2);
    logger.error(`Error processing PDF ${fileName} after ${elapsedTime}s:`, error);
    return false;
  }
}

/**
 * Find all PDF files in a directory (non-recursive)
 */
async function findPdfFilesInDirectory(directoryPath: string): Promise<string[]> {
  try {
    const absolutePath = path.resolve(directoryPath);
    const files = await fs.readdir(absolutePath);
    
    const pdfFiles = files
      .filter(file => file.toLowerCase().endsWith('.pdf'))
      .map(file => path.join(absolutePath, file));
    
    logger.info(`Found ${pdfFiles.length} PDF files in ${absolutePath}`);
    return pdfFiles;
  } catch (error) {
    logger.error(`Error reading directory ${directoryPath}:`, error);
    return [];
  }
}

/**
 * Process PDFs in batches with limited concurrency
 */
async function processPdfsInBatches(
  filePaths: string[], 
  options: typeof DEFAULT_OPTIONS
): Promise<{success: number, failed: number}> {
  const results = {
    success: 0,
    failed: 0,
  };
  
  // Process in batches with the specified concurrency
  const concurrency = Math.max(1, options.concurrency);
  
  for (let i = 0; i < filePaths.length; i += concurrency) {
    const batch = filePaths.slice(i, i + concurrency);
    logger.verbose(`Processing batch of ${batch.length} files (${i+1}-${Math.min(i+batch.length, filePaths.length)} of ${filePaths.length})`, options);
    
    const batchPromises = batch.map(filePath => ingestSinglePdf(filePath, options));
    const batchResults = await Promise.all(batchPromises);
    
    // Count successes and failures
    batchResults.forEach(success => {
      if (success) {
        results.success++;
      } else {
        results.failed++;
      }
    });
    
    logger.separator();
  }
  
  return results;
}

/**
 * Parse command line arguments into options and file paths
 */
function parseCommandLineArgs(): {
  options: typeof DEFAULT_OPTIONS;
  pdfFilePaths: string[];
} {
  const args = process.argv.slice(2);
  const options = { ...DEFAULT_OPTIONS };
  const pdfFilePaths: string[] = [];
  
  for (const arg of args) {
    if (arg === '--overwrite') {
      options.overwrite = true;
    } else if (arg === '--verbose') {
      options.verbose = true;
    } else if (arg === '--help') {
      options.help = true;
    } else if (arg === '--check-only') {
      options.checkOnly = true;
    } else if (arg.startsWith('--dir=')) {
      options.dir = arg.split('=')[1];
    } else if (arg.startsWith('--concurrency=')) {
      const value = parseInt(arg.split('=')[1], 10);
      if (!isNaN(value) && value > 0) {
        options.concurrency = value;
      } else {
        logger.warn(`Invalid concurrency value: ${arg.split('=')[1]}, using default of ${DEFAULT_OPTIONS.concurrency}`);
      }
    } else if (arg.endsWith('.pdf') || arg.endsWith('.PDF')) {
      pdfFilePaths.push(arg);
    } else {
      logger.warn(`Unknown argument: ${arg}`);
    }
  }
  
  return { options, pdfFilePaths };
}

/**
 * Display help message
 */
function showHelp(): void {
  console.log(`
${COLORS.bright}PDF Ingestion Script for Coaching Agent${COLORS.reset}

This script processes PDF files, extracts their content, chunks the text,
generates embeddings, and stores them in a pgvector database for retrieval.

${COLORS.bright}Usage:${COLORS.reset} 
  npx ts-node src/coaching-agent/scripts/ingestPdfs.ts [options] <file1.pdf> <file2.pdf> ... 
  npx ts-node src/coaching-agent/scripts/ingestPdfs.ts [options] --dir=<directory>

${COLORS.bright}Options:${COLORS.reset}
  --overwrite         Clear existing chunks for each PDF before ingestion.
  --dir=<path>        Process all PDFs in the specified directory.
  --check-only        Only check if PDFs exist in the vector store, don't ingest.
  --concurrency=<n>   Process up to n files concurrently (default: 1).
  --verbose           Show detailed logs.
  --help              Show this help message.

${COLORS.bright}Environment Variables:${COLORS.reset}
  OPENAI_API_KEY      Your OpenAI API key for generating embeddings.
  PGVECTOR_USER       PostgreSQL username.
  PGVECTOR_PASSWORD   PostgreSQL password.
  PGVECTOR_HOST       PostgreSQL host.
  PGVECTOR_PORT       PostgreSQL port.
  PGVECTOR_DATABASE   PostgreSQL database name.

${COLORS.bright}Examples:${COLORS.reset}
  # Process a single PDF file
  npx ts-node src/coaching-agent/scripts/ingestPdfs.ts path/to/document.pdf

  # Process multiple PDFs with overwrite
  npx ts-node src/coaching-agent/scripts/ingestPdfs.ts --overwrite doc1.pdf doc2.pdf

  # Process all PDFs in a directory with 3 parallel processes
  npx ts-node src/coaching-agent/scripts/ingestPdfs.ts --dir=pdfs --concurrency=3
  `);
}

/**
 * Main function
 */
async function main(): Promise<void> {
  try {
    // Parse command line arguments
    const { options, pdfFilePaths } = parseCommandLineArgs();
    
    // Show help if requested or if no files provided
    if (options.help || (pdfFilePaths.length === 0 && !options.dir)) {
      showHelp();
      return;
    }
    
    // If directory option is provided, find all PDFs in that directory
    let filesToProcess = [...pdfFilePaths];
    if (options.dir) {
      const dirPath = path.resolve(options.dir);
      logger.info(`Scanning directory: ${dirPath} for PDF files...`);
      const dirFiles = await findPdfFilesInDirectory(dirPath);
      filesToProcess = [...filesToProcess, ...dirFiles];
    }
    
    // Validate that we have at least one file to process
    if (filesToProcess.length === 0) {
      logger.error('No PDF files specified. Use --help for usage information.');
      process.exit(1);
    }
    
    logger.info(`Preparing to process ${filesToProcess.length} PDF files with concurrency: ${options.concurrency}`);
    
    // Initialize the database before processing PDFs
    logger.info('Initializing database schema...');
    const initialized = await initializeDatabase();
    if (!initialized) {
      logger.error('Failed to initialize database schema. Aborting.');
      process.exit(1);
    }
    logger.success('Database schema initialized successfully');
    
    // Process the PDFs
    const startTime = Date.now();
    const results = await processPdfsInBatches(filesToProcess, options);
    const totalTime = ((Date.now() - startTime) / 1000).toFixed(2);
    
    // Log summary
    logger.separator();
    logger.info(`Processing completed in ${totalTime}s`);
    logger.info(`Successfully processed: ${results.success} PDFs`);
    if (results.failed > 0) {
      logger.warn(`Failed to process: ${results.failed} PDFs`);
    }
    
    // Close the database pool
    await pgPool.end();
    logger.info('Database connection closed');
    
  } catch (error) {
    logger.error('An error occurred during execution:', error);
    // Ensure DB connection is closed even on error
    try {
      await pgPool.end();
      logger.info('Database connection closed');
    } catch (dbError) {
      logger.error('Error closing database connection:', dbError);
    }
    process.exit(1);
  }
}

// Don't change below this line
if (require.main === module) {
  main();
} 