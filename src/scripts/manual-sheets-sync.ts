import { manualSync, initializeSheetWithAllProjects } from '../services/sheets-sync.service';
import dotenv from 'dotenv';

dotenv.config();

// Get command line arguments
const args = process.argv.slice(2);
const command = args[0]?.toLowerCase();

async function main() {
  try {
    if (command === 'init' || command === 'initialize') {
      console.log('Initializing sheet with all projects...');
      const result = await initializeSheetWithAllProjects();
      console.log(result);
      return;
    }

    if (args.length < 2) {
      console.log('Usage:');
      console.log('  npx ts-node src/scripts/manual-sheets-sync.ts project PROJECT_ID');
      console.log('  npx ts-node src/scripts/manual-sheets-sync.ts discord DISCORD_ID');
      console.log('  npx ts-node src/scripts/manual-sheets-sync.ts init');
      process.exit(1);
    }

    const type = args[0].toLowerCase();
    const id = args[1];

    if (type !== 'project' && type !== 'discord') {
      console.error('Invalid type. Must be "project" or "discord"');
      process.exit(1);
    }

    console.log(`Manually syncing ${type} with ID: ${id}`);
    const result = await manualSync(type as 'project' | 'discord', id);
    console.log(result);
  } catch (error) {
    console.error('Error in manual sync:', error);
    process.exit(1);
  }
}

main().catch(console.error); 