import { processQueue, setupDatabaseTriggers } from '../services/sheets-sync.service';
import dotenv from 'dotenv';

dotenv.config();

const BATCH_SIZE = parseInt(process.env.SYNC_BATCH_SIZE || '10', 10);
const POLL_INTERVAL_MS = parseInt(process.env.SYNC_POLL_INTERVAL_MS || '60000', 10); // Default: 1 minute

async function main() {
  try {
    console.log('Starting Google Sheets sync queue processor');

    // First-time setup of database triggers (only if needed)
    if (process.env.SETUP_TRIGGERS === 'true') {
      console.log('Setting up database triggers...');
      await setupDatabaseTriggers();
      console.log('Database triggers setup complete');
    }

    // Process queue on startup
    let result = await processQueue(BATCH_SIZE);
    console.log(`Initial queue processing: ${result}`);

    // Process queue at regular intervals
    setInterval(async () => {
      try {
        result = await processQueue(BATCH_SIZE);
        console.log(`Queue processing: ${result}`);
      } catch (error) {
        console.error('Error in queue processing interval:', error);
      }
    }, POLL_INTERVAL_MS);

    console.log(`Queue processor running with poll interval of ${POLL_INTERVAL_MS}ms`);
  } catch (error) {
    console.error('Error starting queue processor:', error);
    process.exit(1);
  }
}

// Run the script
main().catch(console.error); 