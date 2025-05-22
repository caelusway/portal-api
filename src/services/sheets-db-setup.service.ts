import { Pool } from 'pg';
import dotenv from 'dotenv';

dotenv.config();

// Initialize PostgreSQL connection pool
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

/**
 * Format a relative time string for database storage
 * Returns strings like "just now", "5 minutes ago", etc.
 * @deprecated This function is kept for backward compatibility but is no longer used
 */
function formatRelativeTimeSQL(): string {
  return `
    CASE
      WHEN "updatedAt" IS NULL THEN 'just now'
      WHEN age(now(), "updatedAt") < interval '1 minute' THEN 'just now'
      WHEN age(now(), "updatedAt") < interval '1 hour' THEN 
        EXTRACT(minute FROM age(now(), "updatedAt"))::integer || 
        CASE WHEN EXTRACT(minute FROM age(now(), "updatedAt"))::integer = 1 THEN ' minute ago' ELSE ' minutes ago' END
      WHEN age(now(), "updatedAt") < interval '1 day' THEN 
        EXTRACT(hour FROM age(now(), "updatedAt"))::integer || 
        CASE WHEN EXTRACT(hour FROM age(now(), "updatedAt"))::integer = 1 THEN ' hour ago' ELSE ' hours ago' END
      WHEN age(now(), "updatedAt") < interval '30 days' THEN 
        EXTRACT(day FROM age(now(), "updatedAt"))::integer || 
        CASE WHEN EXTRACT(day FROM age(now(), "updatedAt"))::integer = 1 THEN ' day ago' ELSE ' days ago' END
      WHEN age(now(), "updatedAt") < interval '1 year' THEN 
        (EXTRACT(month FROM age(now(), "updatedAt")) + EXTRACT(year FROM age(now(), "updatedAt")) * 12)::integer || 
        CASE WHEN (EXTRACT(month FROM age(now(), "updatedAt")) + EXTRACT(year FROM age(now(), "updatedAt")) * 12)::integer = 1 THEN ' month ago' ELSE ' months ago' END
      ELSE
        EXTRACT(year FROM age(now(), "updatedAt"))::integer || 
        CASE WHEN EXTRACT(year FROM age(now(), "updatedAt"))::integer = 1 THEN ' year ago' ELSE ' years ago' END
    END
  `;
}

/**
 * Format date with timezone and local time
 * Uses America/New_York timezone (US Eastern Time)
 * Returns strings like "2023-05-15 3:45 PM ET"
 */
function formatDateWithRelativeSQL(): string {
  return `
    to_char(COALESCE("updatedAt", now()) AT TIME ZONE 'America/New_York', 'YYYY-MM-DD hh:MI AM') || ' ET'
  `;
}

/**
 * Get current date/time in US Eastern timezone with format
 * Returns a string like "2023-05-15 3:45 PM ET"
 */
function getCurrentTimeInUSEastern(): string {
  return `to_char(now() AT TIME ZONE 'America/New_York', 'YYYY-MM-DD hh:MI AM') || ' ET'`;
}

/**
 * Setup database triggers and functions for automatic Google Sheets syncing
 * This creates the necessary PostgreSQL functions, triggers, and queue table.
 * 
 * WARNING: This modifies database schema by creating functions, triggers, and potentially a table.
 * Only run this if you want these database objects created.
 */
export async function setupDatabaseTriggersAndQueue(): Promise<void> {
  try {
    console.log('Setting up database triggers and queue for Google Sheets sync');
    
    // First, check actual table names in the database
    console.log('Checking for actual table names in the database...');
    const tableCheckResult = await pool.query(`
      SELECT table_schema, table_name 
      FROM information_schema.tables 
      WHERE table_name IN ('project', 'discord', 'Project', 'Discord')
        AND table_schema NOT IN ('pg_catalog', 'information_schema')
    `);
    
    // Log the actual table names found
    console.log('Found tables:');
    tableCheckResult.rows.forEach(row => {
      console.log(`- ${row.table_schema}.${row.table_name}`);
    });
    
    if (tableCheckResult.rows.length === 0) {
      throw new Error('Could not find project or discord tables in the database. Check your database connection and Prisma schema.');
    }
    
    // Find the actual table names
    const projectTableInfo = tableCheckResult.rows.find(row => 
      row.table_name.toLowerCase() === 'project' || row.table_name === 'Project'
    );
    
    const discordTableInfo = tableCheckResult.rows.find(row => 
      row.table_name.toLowerCase() === 'discord' || row.table_name === 'Discord'
    );
    
    if (!projectTableInfo) {
      throw new Error('Project table not found in the database');
    }
    
    if (!discordTableInfo) {
      throw new Error('Discord table not found in the database');
    }
    
    // Create fully quoted table names to preserve case
    const quotedProjectTable = `"${projectTableInfo.table_schema}"."${projectTableInfo.table_name}"`;
    const quotedDiscordTable = `"${discordTableInfo.table_schema}"."${discordTableInfo.table_name}"`;
    
    console.log(`Using quoted table names: Project = ${quotedProjectTable}, Discord = ${quotedDiscordTable}`);
    
    // 1. Create queue table if it doesn't exist
    console.log('Creating sheets_sync_queue table if it doesn\'t exist...');
    await pool.query(`
      CREATE TABLE IF NOT EXISTS sheets_sync_queue (
        id SERIAL PRIMARY KEY,
        record_id TEXT NOT NULL,
        record_type TEXT NOT NULL,
        operation TEXT NOT NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        processed_at TIMESTAMP WITH TIME ZONE,
        status TEXT
      );
    `);
    console.log('Queue table created or verified');
    
    // 2. Create function for project sync
    console.log('Creating sync_project_to_sheets function...');
    await pool.query(`
      CREATE OR REPLACE FUNCTION sync_project_to_sheets()
      RETURNS TRIGGER AS $$
      BEGIN
        -- Add project_id to a queue table that your application will process
        INSERT INTO sheets_sync_queue (record_id, record_type, operation)
        VALUES (NEW.id, 'project', TG_OP);
        
        -- Update the lastActivity timestamp if the column exists
        BEGIN
          -- Try to update the lastActivity field in the same transaction
          -- This avoids needing a separate UPDATE statement later
          -- We use dynamic SQL to handle quoted identifiers properly
          IF TG_OP = 'UPDATE' OR TG_OP = 'INSERT' THEN
            -- Get the current time in US Eastern timezone
            DECLARE
              current_time_eastern text := ${getCurrentTimeInUSEastern()};
            BEGIN
              EXECUTE format('UPDATE %I.%I SET "lastActivity" = $2 WHERE id = $1', 
                          TG_TABLE_SCHEMA, TG_TABLE_NAME) 
              USING NEW.id, current_time_eastern;
            END;
          END IF;
        EXCEPTION WHEN undefined_column THEN
          -- If lastActivity column doesn't exist yet, we can ignore this error
          RAISE NOTICE 'Project table does not have lastActivity column yet. Skipping update.';
        END;
        
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
    `);
    console.log('Created function: sync_project_to_sheets');
    
    // 3. Create function for discord sync that triggers project row update
    console.log('Creating sync_discord_to_sheets function...');
    await pool.query(`
      CREATE OR REPLACE FUNCTION sync_discord_to_sheets()
      RETURNS TRIGGER AS $$
      BEGIN
        -- For updated Discord records, we want to sync the associated project
        -- If project_id is NULL, there's nothing to sync
        IF NEW."projectId" IS NOT NULL THEN
          -- Add the project_id to the queue instead of discord_id
          INSERT INTO sheets_sync_queue (record_id, record_type, operation)
          VALUES (NEW."projectId", 'project', TG_OP);
          
          -- Update last activity timestamp in the project record if possible
          BEGIN
            -- Get the current time in US Eastern timezone
            DECLARE
              current_time_eastern text := ${getCurrentTimeInUSEastern()};
            BEGIN
              -- Try to update the project's lastActivity field
              -- Using dynamic SQL in EXECUTE to avoid issues with quoted identifiers
              EXECUTE format('UPDATE %I.%I SET "lastActivity" = $2 WHERE id = $1', 
                          TG_TABLE_SCHEMA, 'Project') 
              USING NEW."projectId", current_time_eastern;
            END;
          EXCEPTION WHEN undefined_column THEN
            -- If lastActivity column doesn't exist yet, we can ignore this error
            RAISE NOTICE 'Project table does not have lastActivity column yet. Skipping update.';
          END;
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
    `);
    console.log('Created function: sync_discord_to_sheets');
    
    // 4. Create trigger for project table
    console.log('Creating project_sheets_sync trigger...');
    await pool.query(`
      DROP TRIGGER IF EXISTS project_sheets_sync ON ${quotedProjectTable};
      CREATE TRIGGER project_sheets_sync
      AFTER INSERT OR UPDATE ON ${quotedProjectTable}
      FOR EACH ROW
      EXECUTE FUNCTION sync_project_to_sheets();
    `);
    console.log('Created trigger: project_sheets_sync');
    
    // 5. Create trigger for discord table
    console.log('Creating discord_sheets_sync trigger...');
    await pool.query(`
      DROP TRIGGER IF EXISTS discord_sheets_sync ON ${quotedDiscordTable};
      CREATE TRIGGER discord_sheets_sync
      AFTER INSERT OR UPDATE ON ${quotedDiscordTable}
      FOR EACH ROW
      EXECUTE FUNCTION sync_discord_to_sheets();
    `);
    console.log('Created trigger: discord_sheets_sync');
    
    console.log('Database triggers and queue for Google Sheets sync setup complete');
  } catch (error) {
    console.error('Error setting up database triggers and queue:', error);
    throw new Error(`Failed to setup database triggers and queue: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Remove database triggers and functions for Google Sheets syncing
 * This is useful to undo changes made by setupDatabaseTriggersAndQueue
 */
export async function removeDatabaseTriggersAndFunctions(): Promise<void> {
  try {
    console.log('Removing database triggers and functions for Google Sheets sync');
    
    // Check for actual table names in the database
    const tableCheckResult = await pool.query(`
      SELECT table_schema, table_name 
      FROM information_schema.tables 
      WHERE table_name IN ('project', 'discord', 'Project', 'Discord')
        AND table_schema NOT IN ('pg_catalog', 'information_schema')
    `);
    
    // Find the actual table names
    const projectTableInfo = tableCheckResult.rows.find(row => 
      row.table_name.toLowerCase() === 'project' || row.table_name === 'Project'
    );
    
    const discordTableInfo = tableCheckResult.rows.find(row => 
      row.table_name.toLowerCase() === 'discord' || row.table_name === 'Discord'
    );
    
    // Remove triggers if tables exist
    if (projectTableInfo) {
      const quotedProjectTable = `"${projectTableInfo.table_schema}"."${projectTableInfo.table_name}"`;
      console.log(`Removing project_sheets_sync trigger from ${quotedProjectTable}...`);
      await pool.query(`DROP TRIGGER IF EXISTS project_sheets_sync ON ${quotedProjectTable};`);
    }
    
    if (discordTableInfo) {
      const quotedDiscordTable = `"${discordTableInfo.table_schema}"."${discordTableInfo.table_name}"`;
      console.log(`Removing discord_sheets_sync trigger from ${quotedDiscordTable}...`);
      await pool.query(`DROP TRIGGER IF EXISTS discord_sheets_sync ON ${quotedDiscordTable};`);
    }
    
    // Remove functions
    console.log('Removing sync_project_to_sheets function...');
    await pool.query(`DROP FUNCTION IF EXISTS sync_project_to_sheets() CASCADE;`);
    
    console.log('Removing sync_discord_to_sheets function...');
    await pool.query(`DROP FUNCTION IF EXISTS sync_discord_to_sheets() CASCADE;`);
    
    console.log('Database triggers and functions removed');
  } catch (error) {
    console.error('Error removing database triggers and functions:', error);
    throw new Error(`Failed to remove database triggers and functions: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Process the sync queue in batches
 * WARNING: This interacts with the database by updating the sheets_sync_queue table.
 */
export async function processSyncQueue(batchSize: number = 10): Promise<string> {
  try {
    console.log(`Processing Google Sheets sync queue (batch size: ${batchSize})`);
    
    // Get unprocessed items from queue, deduplicating by record_id and record_type
    const queueResult = await pool.query(
      `WITH ranked_items AS (
         SELECT 
           id,
           record_id,
           record_type,
           operation,
           created_at,
           ROW_NUMBER() OVER (PARTITION BY record_id, record_type ORDER BY created_at DESC) as rn
         FROM sheets_sync_queue
         WHERE processed_at IS NULL
       )
       SELECT id, record_id, record_type, operation, created_at
       FROM ranked_items
       WHERE rn = 1
       ORDER BY created_at ASC
       LIMIT $1`,
      [batchSize]
    );
    
    if (queueResult.rows.length === 0) {
      return 'No queue items to process';
    }
    
    let processedCount = 0;
    let errorCount = 0;
    
    // Import the syncProjectToSheets function from sheets-sync.service
    const { syncProjectToSheets } = await import('./sheets-sync.service');
    
    // Process each queue item
    for (const item of queueResult.rows) {
      try {
        console.log(`Processing queue item: ${item.record_type} ${item.record_id} (${item.operation})`);
        
        let result = '';
        // Since Discord updates now trigger project updates, we only need to handle project type
        if (item.record_type === 'project') {
          result = await syncProjectToSheets(item.record_id);
        } else {
          result = `Skipping record type: ${item.record_type}. Only project type is processed directly.`;
        }
        
        // Mark as processed
        await pool.query(
          `UPDATE sheets_sync_queue 
           SET processed_at = NOW(), status = $1 
           WHERE id = $2`,
          ['completed', item.id]
        );
        
        processedCount++;
        console.log(`Queue item ${item.id} processed: ${result}`);
      } catch (error) {
        errorCount++;
        console.error(`Error processing queue item ${item.id}:`, error);
        
        // Mark as failed
        await pool.query(
          `UPDATE sheets_sync_queue 
           SET processed_at = NOW(), status = $1 
           WHERE id = $2`,
          [`failed: ${error instanceof Error ? error.message : String(error)}`, item.id]
        );
      }
    }
    
    return `Processed ${processedCount} items (${errorCount} errors)`;
  } catch (error) {
    console.error('Error processing sync queue:', error);
    throw new Error(`Failed to process sync queue: ${error instanceof Error ? error.message : String(error)}`);
  }
} 