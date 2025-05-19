/**
 * Google Sheets Sync Queue Processor
 * 
 * This script processes the Google Sheets sync queue, syncing pending changes to Google Sheets.
 * It reads from the sheets_sync_queue table and processes any unprocessed items.
 * 
 * Usage:
 * - To process queue once: npm run process-sheets-queue
 * - To run continuously: npm run process-sheets-queue -- --watch
 * 
 * Environment variables:
 * - PROCESS_SHEETS_QUEUE: Set to 'true' to run the processor (safety measure)
 * - BATCH_SIZE: Number of items to process in one batch (default: 10)
 * - WATCH_INTERVAL: Seconds between processing attempts in watch mode (default: 60)
 */

import dotenv from 'dotenv';
import { processSyncQueue } from '../services/sheets-db-setup.service';

// Load environment variables
dotenv.config();

// Configuration
const BATCH_SIZE = parseInt(process.env.BATCH_SIZE || '10', 10);
const WATCH_INTERVAL = parseInt(process.env.WATCH_INTERVAL || '60', 10) * 1000; // Convert to milliseconds

async function main() {
  console.log('🔄 Google Sheets Sync Queue Processor');
  console.log('------------------------------------');

  // Safety check to prevent accidental runs
  if (process.env.PROCESS_SHEETS_QUEUE !== 'true') {
    console.error('⚠️ Safety check: PROCESS_SHEETS_QUEUE environment variable not set to true.');
    console.error('To run this script, set PROCESS_SHEETS_QUEUE=true in your .env file or use:');
    console.error('PROCESS_SHEETS_QUEUE=true npm run process-sheets-queue');
    process.exit(1);
  }

  // Parse command line arguments
  let watchMode = false;
  
  process.argv.forEach(arg => {
    if (arg === '--watch') {
      watchMode = true;
    }
  });

  try {
    if (watchMode) {
      console.log(`🔄 Starting queue processor in watch mode (interval: ${WATCH_INTERVAL / 1000}s, batch size: ${BATCH_SIZE})`);
      
      // Process immediately once
      await processOnce();
      
      // Then set up interval for subsequent processing
      setInterval(async () => {
        try {
          await processOnce();
        } catch (error) {
          console.error('❌ Error in watch mode processing cycle:', error);
          // Continue the interval even after errors
        }
      }, WATCH_INTERVAL);
      
      console.log('📊 Queue processor running in watch mode. Press Ctrl+C to stop.');
    } else {
      console.log(`🔄 Processing queue (batch size: ${BATCH_SIZE})...`);
      await processOnce();
      console.log('✅ Queue processing complete.');
    }
  } catch (error) {
    console.error('❌ Error during queue processing:', error);
    if (!watchMode) {
      process.exit(1);
    }
  }
}

async function processOnce() {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] Processing sync queue...`);
  const result = await processSyncQueue(BATCH_SIZE);
  console.log(`[${timestamp}] ${result}`);
}

// Execute the script
if (require.main === module) {
  main().catch(error => {
    console.error('❌ Unhandled error:', error);
    process.exit(1);
  });
} 