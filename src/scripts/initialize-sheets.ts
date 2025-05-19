/**
 * Google Sheets Initialization Script
 * 
 * This script initializes or refreshes the Google Sheet with project data from the database.
 * 
 * Usage:
 * - To sync all projects: npm run initialize-sheets
 * - To sync a specific project: npm run initialize-sheets -- --project=<project-id>
 * 
 * Environment variables:
 * - INITIALIZE_SHEET: Set to 'true' to run the initialization (safety measure)
 */

import dotenv from 'dotenv';
import { initializeSheetWithAllProjects, syncProjectToSheets } from '../services/sheets-sync.service';

// Load environment variables
dotenv.config();

async function main() {
  console.log('🔄 Google Sheets Initialization Script');
  console.log('------------------------------------');

  // Safety check to prevent accidental runs
  if (process.env.INITIALIZE_SHEET !== 'true') {
    console.error('⚠️ Safety check: INITIALIZE_SHEET environment variable not set to true.');
    console.error('To run this script, set INITIALIZE_SHEET=true in your .env file or use:');
    console.error('INITIALIZE_SHEET=true npm run initialize-sheets');
    process.exit(1);
  }

  // Parse command line arguments
  let projectId: string | null = null;
  
  process.argv.forEach(arg => {
    // Look for --project=<id> pattern
    if (arg.startsWith('--project=')) {
      projectId = arg.split('=')[1];
    }
  });

  try {
    if (projectId) {
      console.log(`🔎 Syncing single project: ${projectId}`);
      
      try {
        const result = await syncProjectToSheets(projectId);
        console.log(`✅ Result: ${result}`);
      } catch (projectError) {
        console.error(`❌ Error syncing project ${projectId}:`, projectError);
        process.exit(1);
      }
    } else {
      console.log('🔄 Syncing all projects to Google Sheets...');
      console.log('This may take a while depending on the number of projects.');
      
      try {
        const result = await initializeSheetWithAllProjects();
        console.log(`✅ Success! ${result}`);
      } catch (batchError) {
        console.error('❌ Error during batch sync:', batchError);
        process.exit(1);
      }
    }
    
    console.log('✨ Google Sheets sync completed successfully!');
    console.log('------------------------------------');
    console.log('👉 Check your Google Sheet to verify the data is synchronized correctly.');
    
  } catch (error) {
    console.error('❌ Unexpected error during Google Sheets initialization:', error);
    process.exit(1);
  }
}

// Execute the script
main().catch(error => {
  console.error('❌ Unhandled error:', error);
  process.exit(1);
}); 