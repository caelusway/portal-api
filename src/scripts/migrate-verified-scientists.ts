import { runScientistMigration } from '../discord-bot';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

/**
 * Migration script to backfill verifiedScientistCount for existing Discord members
 * 
 * Usage:
 * npm run migrate:scientists
 * or
 * npx ts-node src/scripts/migrate-verified-scientists.ts
 */
async function main() {
  console.log('🔬 Starting Verified Scientists Migration...\n');
  
  try {
    const result = await runScientistMigration();
    
    if (result.success) {
      console.log('\n✅ Migration completed successfully!');
      console.log(result.message);
    } else {
      console.error('\n❌ Migration failed:');
      console.error(result.message);
      process.exit(1);
    }
  } catch (error) {
    console.error('\n💥 Unexpected error during migration:');
    console.error(error);
    process.exit(1);
  }
}

// Run the migration
if (require.main === module) {
  main().then(() => {
    console.log('\n🎉 Migration script completed.');
    process.exit(0);
  }).catch((error) => {
    console.error('\n💥 Migration script failed:', error);
    process.exit(1);
  });
}

export { main as runMigration }; 