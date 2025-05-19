/**
 * Google Sheets Database Setup Script
 * 
 * This script sets up the database triggers and queue for Google Sheets synchronization.
 * It creates: 
 * - A sheets_sync_queue table
 * - Two database functions (sync_project_to_sheets, sync_discord_to_sheets)
 * - Two database triggers on the Project and Discord tables
 * 
 * WARNING: This script modifies the database schema.
 * 
 * Usage:
 * - To set up: npm run setup-sheets-db -- --setup
 * - To remove: npm run setup-sheets-db -- --remove
 * 
 * Environment variables:
 * - SETUP_SHEETS_DB: Set to 'true' to run the setup (safety measure)
 */

import dotenv from 'dotenv';
import { setupDatabaseTriggersAndQueue, removeDatabaseTriggersAndFunctions } from '../services/sheets-db-setup.service';

// Load environment variables
dotenv.config();

async function main() {
  console.log('🔧 Google Sheets Database Setup Script');
  console.log('--------------------------------------');

  // Safety check to prevent accidental runs
  if (process.env.SETUP_SHEETS_DB !== 'true') {
    console.error('⚠️ Safety check: SETUP_SHEETS_DB environment variable not set to true.');
    console.error('To run this script, set SETUP_SHEETS_DB=true in your .env file or use:');
    console.error('SETUP_SHEETS_DB=true npm run setup-sheets-db -- --setup');
    process.exit(1);
  }

  // Parse command line arguments
  let shouldSetup = false;
  let shouldRemove = false;
  
  process.argv.forEach(arg => {
    if (arg === '--setup') {
      shouldSetup = true;
    } else if (arg === '--remove') {
      shouldRemove = true;
    }
  });

  if (!shouldSetup && !shouldRemove) {
    console.error('⚠️ Please specify either --setup or --remove');
    console.error('Example: npm run setup-sheets-db -- --setup');
    process.exit(1);
  }

  if (shouldSetup && shouldRemove) {
    console.error('⚠️ Cannot specify both --setup and --remove at the same time.');
    console.error('Please run them separately if you want to perform both operations.');
    process.exit(1);
  }

  try {
    if (shouldSetup) {
      console.log('🔧 Setting up database triggers and queue for Google Sheets sync...');
      
      console.log('\n⚠️ WARNING: This will create or modify database objects:');
      console.log('  - sheets_sync_queue table');
      console.log('  - sync_project_to_sheets() function');
      console.log('  - sync_discord_to_sheets() function');
      console.log('  - project_sheets_sync trigger on Project table');
      console.log('  - discord_sheets_sync trigger on Discord table');
      console.log('\nPress Ctrl+C within 5 seconds to cancel...');
      
      // Give them 5 seconds to cancel
      await new Promise(resolve => setTimeout(resolve, 5000));
      
      await setupDatabaseTriggersAndQueue();
      console.log('✅ Database setup complete!');
    } else if (shouldRemove) {
      console.log('🔧 Removing database triggers and functions for Google Sheets sync...');
      
      console.log('\n⚠️ WARNING: This will remove database objects:');
      console.log('  - project_sheets_sync trigger from Project table');
      console.log('  - discord_sheets_sync trigger from Discord table');
      console.log('  - sync_project_to_sheets() function');
      console.log('  - sync_discord_to_sheets() function');
      console.log('\nPress Ctrl+C within 5 seconds to cancel...');
      
      // Give them 5 seconds to cancel
      await new Promise(resolve => setTimeout(resolve, 5000));
      
      await removeDatabaseTriggersAndFunctions();
      console.log('✅ Database cleanup complete!');
      console.log('(The sheets_sync_queue table was preserved. Drop it manually if needed.)');
    }
  } catch (error) {
    console.error('❌ Error during database operations:', error);
    process.exit(1);
  }
}

// Execute the script
main().catch(error => {
  console.error('❌ Unhandled error:', error);
  process.exit(1);
}); 