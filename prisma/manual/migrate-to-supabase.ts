import { PrismaClient } from '@prisma/client';
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import readline from 'readline';

// Load environment variables from .env file
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const prisma = new PrismaClient();

/**
 * Migrate database from DATABASE_URL to SUPABASE_DB_URL
 * Performs backup and import in one operation
 */
async function migrateToSupabase(chunkSize: number = 5000): Promise<void> {
  try {
    console.log('=== Portal API Database Migration to Supabase ===');
    
    // Check environment variables
    const sourceDbUrl = process.env.DATABASE_URL;
    const targetDbUrl = process.env.SUPABASE_DB_URL;
    
    if (!sourceDbUrl) {
      throw new Error('DATABASE_URL environment variable is not set');
    }
    
    if (!targetDbUrl) {
      throw new Error('SUPABASE_DB_URL environment variable is not set');
    }
    
    // Create temp directory for backup files
    const tempDir = path.resolve(__dirname, 'temp');
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }
    
    // Generate backup filename with timestamp
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupFile = path.join(tempDir, `db_backup_${timestamp}.sql`);
    
    // Step 1: Create backup from source database
    console.log('1. Creating database backup from source...');
    await createDatabaseBackup(sourceDbUrl, backupFile);
    
    // Step 2: Import to target Supabase database
    console.log('\n2. Importing to Supabase...');
    await importToSupabase(backupFile, targetDbUrl, chunkSize);
    
    // Step 3: Clean up
    console.log('\n3. Cleaning up temporary files...');
    fs.unlinkSync(backupFile);
    fs.rmdirSync(tempDir, { recursive: true });
    
    console.log('\n✅ Database migration completed successfully!');
    console.log('  Your database has been migrated from PostgreSQL to Supabase.');
    
  } catch (error) {
    console.error('❌ Migration failed:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

/**
 * Create a database backup from the source database
 */
async function createDatabaseBackup(dbUrl: string, outputFile: string): Promise<void> {
  try {
    // Parse database URL to get connection parameters
    const dbUrlObj = new URL(dbUrl);
    const host = dbUrlObj.hostname;
    const port = dbUrlObj.port;
    const database = dbUrlObj.pathname.substring(1); // Remove leading slash
    const username = dbUrlObj.username;
    const password = dbUrlObj.password;
    
    console.log(`  Source database: ${database} on ${host}:${port}`);
    
    // Create the backup using pg_dump with options optimized for Supabase import
    const pgDumpCommand = `PGPASSWORD=${password} pg_dump \
      --host=${host} \
      --port=${port} \
      --username=${username} \
      --dbname=${database} \
      --clean \
      --if-exists \
      --no-owner \
      --no-acl \
      --format=plain \
      --schema=public \
      > ${outputFile}`;
    
    execSync(pgDumpCommand, { stdio: 'inherit' });
    
    // Get file size for reporting
    const stats = fs.statSync(outputFile);
    const fileSizeInMB = (stats.size / (1024 * 1024)).toFixed(2);
    
    console.log(`  ✅ Backup successful!`);
    console.log(`  Backup file size: ${fileSizeInMB} MB`);
    
  } catch (error) {
    console.error('  ❌ Backup failed!', error);
    throw error;
  }
}

/**
 * Import a database backup to Supabase
 */
async function importToSupabase(backupFile: string, dbUrl: string, chunkSize: number): Promise<void> {
  try {
    // Calculate file size
    const stats = fs.statSync(backupFile);
    const fileSizeInMB = (stats.size / (1024 * 1024)).toFixed(2);
    console.log(`  Backup file size: ${fileSizeInMB} MB`);
    
    // For large files, process in chunks
    if (parseInt(fileSizeInMB) > 8) {
      console.log(`  File is larger than 8MB. Processing in chunks of ${chunkSize} lines...`);
      await processLargeFile(backupFile, dbUrl, chunkSize);
    } else {
      // For smaller files, direct import
      console.log('  File is small enough for direct import. Importing...');
      importFileDirect(backupFile, dbUrl);
    }
    
    console.log('  ✅ Import completed successfully!');
  } catch (error) {
    console.error('  ❌ Import failed!', error);
    throw error;
  }
}

/**
 * Process a large SQL file by splitting it into chunks and importing each chunk
 */
async function processLargeFile(filePath: string, dbUrl: string, chunkSize: number): Promise<void> {
  // Create a temporary directory for chunks
  const chunksDir = path.join(path.dirname(filePath), 'chunks');
  if (!fs.existsSync(chunksDir)) {
    fs.mkdirSync(chunksDir, { recursive: true });
  }
  
  try {
    // Disable foreign key constraints during import for smoother processing
    console.log('  Disabling foreign key constraints...');
    execSqlOnSupabase('SET session_replication_role = \'replica\';', dbUrl);
    
    // Count total lines for progress reporting
    console.log('  Counting total lines in file...');
    const totalLinesRl = readline.createInterface({
      input: fs.createReadStream(filePath),
      crlfDelay: Infinity
    });
    
    let totalLines = 0;
    for await (const _ of totalLinesRl) {
      totalLines++;
    }
    console.log(`  Total lines in file: ${totalLines}`);
    
    // Process the file in chunks
    console.log('  Processing file in chunks...');
    const fileStream = fs.createReadStream(filePath);
    const rl = readline.createInterface({
      input: fileStream,
      crlfDelay: Infinity
    });
    
    let lineCount = 0;
    let chunkCount = 0;
    let currentChunk: string[] = [];
    
    // Process each line
    for await (const line of rl) {
      currentChunk.push(line);
      lineCount++;
      
      if (lineCount % chunkSize === 0) {
        // Write and process this chunk
        chunkCount++;
        const chunkPath = path.join(chunksDir, `chunk_${chunkCount}.sql`);
        fs.writeFileSync(chunkPath, currentChunk.join('\n'));
        
        const progress = ((lineCount / totalLines) * 100).toFixed(1);
        console.log(`  Processing chunk ${chunkCount}: lines ${lineCount - chunkSize + 1}-${lineCount} (${progress}%)...`);
        importFileDirect(chunkPath, dbUrl);
        
        // Reset for next chunk
        currentChunk = [];
      }
    }
    
    // Process any remaining lines in the last chunk
    if (currentChunk.length > 0) {
      chunkCount++;
      const chunkPath = path.join(chunksDir, `chunk_${chunkCount}.sql`);
      fs.writeFileSync(chunkPath, currentChunk.join('\n'));
      
      console.log(`  Processing final chunk ${chunkCount}: remaining ${currentChunk.length} lines...`);
      importFileDirect(chunkPath, dbUrl);
    }
    
    // Re-enable foreign key constraints
    console.log('  Re-enabling foreign key constraints...');
    execSqlOnSupabase('SET session_replication_role = \'origin\';', dbUrl);
    
    console.log(`  Processed ${lineCount} lines in ${chunkCount} chunks.`);
  } finally {
    // Clean up temporary directory
    if (fs.existsSync(chunksDir)) {
      fs.readdirSync(chunksDir).forEach(file => {
        fs.unlinkSync(path.join(chunksDir, file));
      });
      fs.rmdirSync(chunksDir);
    }
  }
}

/**
 * Import a SQL file directly to Supabase using psql
 */
function importFileDirect(filePath: string, dbUrl: string): void {
  try {
    // Remove Prisma-specific parameters that psql doesn't understand
    const cleanDbUrl = dbUrl.replace(/\?pgbouncer=true/, '').replace(/&pgbouncer=true/, '');
    
    const importCommand = `psql "${cleanDbUrl}" -f "${filePath}"`;
    execSync(importCommand, { stdio: 'inherit' });
  } catch (error) {
    console.error('  Error during direct import:', error);
    throw error;
  }
}

/**
 * Execute a SQL statement directly on Supabase
 */
function execSqlOnSupabase(sqlStatement: string, dbUrl: string): void {
  try {
    // Create a temporary file in the system temp directory or the temp subdirectory
    const tempDir = path.resolve(__dirname, 'temp');
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }
    
    const tempFile = path.join(tempDir, `temp_statement_${Date.now()}.sql`);
    fs.writeFileSync(tempFile, sqlStatement);
    
    // Remove Prisma-specific parameters that psql doesn't understand
    const cleanDbUrl = dbUrl.replace(/\?pgbouncer=true/, '').replace(/&pgbouncer=true/, '');
    
    // Execute using psql
    const command = `psql "${cleanDbUrl}" -f "${tempFile}"`;
    execSync(command, { stdio: 'inherit' });
    
    // Clean up
    fs.unlinkSync(tempFile);
  } catch (error) {
    console.error('  Error executing SQL on Supabase:', error);
    throw error;
  }
}

// Run the migration if this script is executed directly
if (require.main === module) {
  // Get chunk size from command line arguments if provided
  const args = process.argv.slice(2);
  const chunkSize = args[0] ? parseInt(args[0]) : 5000;
  
  migrateToSupabase(chunkSize)
    .then(() => {
      console.log('Migration process complete.');
      process.exit(0);
    })
    .catch(error => {
      console.error('Error during migration:', error);
      process.exit(1);
    });
}

export { migrateToSupabase }; 