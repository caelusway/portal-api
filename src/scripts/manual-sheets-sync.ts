import { manualSync, setupDatabaseTriggers } from '../services/sheets-sync.service';
import dotenv from 'dotenv';

dotenv.config();

async function main() {
  // Parse command line arguments
  const args = process.argv.slice(2);
  
  if (args.length === 0) {
    printUsage();
    process.exit(0);
  }
  
  const command = args[0];
  
  try {
    switch (command) {
      case 'setup':
        // Setup database triggers
        console.log('Setting up database triggers...');
        await setupDatabaseTriggers();
        console.log('Database triggers setup complete');
        break;
        
      case 'sync':
        // Check for required arguments
        if (args.length < 3) {
          console.error('Error: Missing arguments for sync command');
          printUsage();
          process.exit(1);
        }
        
        const type = args[1] as 'project' | 'discord';
        const id = args[2];
        
        // Validate type
        if (type !== 'project' && type !== 'discord') {
          console.error('Error: Type must be "project" or "discord"');
          printUsage();
          process.exit(1);
        }
        
        console.log(`Manually syncing ${type} with ID ${id}...`);
        const result = await manualSync(type, id);
        console.log(`Sync result: ${result}`);
        break;
        
      default:
        console.error(`Error: Unknown command "${command}"`);
        printUsage();
        process.exit(1);
    }
  } catch (error) {
    console.error('Error:', (error as Error).message);
    process.exit(1);
  }
}

function printUsage() {
  console.log(`
Google Sheets Sync CLI

Usage:
  ts-node manual-sheets-sync.ts setup
    - Setup database triggers for automatic syncing
    
  ts-node manual-sheets-sync.ts sync <type> <id>
    - Manually sync a record to Google Sheets
    - <type>: "project" or "discord"
    - <id>: The record ID to sync
    
Examples:
  ts-node manual-sheets-sync.ts setup
  ts-node manual-sheets-sync.ts sync project 123e4567-e89b-12d3-a456-426614174000
  ts-node manual-sheets-sync.ts sync discord 987e6543-e21b-87d9-a654-321987654000
  `);
}

// Run the script
main().catch(console.error); 