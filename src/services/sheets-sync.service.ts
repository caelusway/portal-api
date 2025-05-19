import { JWT } from 'google-auth-library';
import axios from 'axios';
import { Pool } from 'pg';
import dotenv from 'dotenv';

dotenv.config();

// --- Configuration ---
const SERVICE_ACCOUNT_JSON_STRING = process.env.GOOGLE_SERVICE_ACCOUNT_CREDENTIALS;
const SPREADSHEET_ID = process.env.GOOGLE_SHEET_ID;
const SHEET_NAME = 'Projects'; // Ensure this matches your sheet name
const DISCORD_SHEET_NAME = 'Discords'; // Sheet for Discord data
const PRIMARY_KEY_COLUMN_LETTER = 'A'; // Column letter for Primary Key in Sheets
const PRIMARY_KEY_COLUMN_INDEX = 0; // 0-based index for the primary key column (A=0, B=1, etc.)
const GOOGLE_TOKEN_URI = 'https://oauth2.googleapis.com/token';
const GOOGLE_SHEETS_API_ENDPOINT = 'https://sheets.googleapis.com/v4/spreadsheets';
const GOOGLE_SHEETS_SCOPES = [
  'https://www.googleapis.com/auth/spreadsheets'
];

// Initialize PostgreSQL connection pool
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

/**
 * Get Google OAuth2 access token using service account credentials
 */
async function getGoogleAccessToken(): Promise<string> {
  if (!SERVICE_ACCOUNT_JSON_STRING) {
    throw new Error('Missing GOOGLE_SERVICE_ACCOUNT_CREDENTIALS environment variable');
  }
  
  const creds = JSON.parse(SERVICE_ACCOUNT_JSON_STRING);
  const client = new JWT({
    email: creds.client_email,
    key: creds.private_key,
    scopes: GOOGLE_SHEETS_SCOPES,
  });

  const token = await client.authorize();
  return token.access_token || '';
}

/**
 * Find the row index in Google Sheets that contains the given ID
 */
async function findRowIndexById(accessToken: string, id: string, sheetName: string = SHEET_NAME): Promise<number | null> {
  const range = `${sheetName}!${PRIMARY_KEY_COLUMN_LETTER}:${PRIMARY_KEY_COLUMN_LETTER}`;
  const url = `${GOOGLE_SHEETS_API_ENDPOINT}/${SPREADSHEET_ID}/values/${range}?majorDimension=COLUMNS`;
  
  console.log(`Searching for ID ${id} in Sheet "${sheetName}" range ${range}`);
  
  try {
    const response = await axios.get(url, {
      headers: {
        Authorization: `Bearer ${accessToken}`
      }
    });

    // The API returns values as an array of columns if majorDimension=COLUMNS.
    // We are interested in the first (and only requested) column.
    const idColumnData = response.data.values?.[0];
    if (!idColumnData || idColumnData.length === 0) {
      console.log(`Primary key column (${PRIMARY_KEY_COLUMN_LETTER}) is empty or not found in sheet "${sheetName}".`);
      return null;
    }

    // Find the index of the cell that matches the id.
    // Ensure consistent string comparison as Sheet values might be numbers or strings.
    const rowIndex = idColumnData.findIndex((cellValue: any) => String(cellValue) === String(id));
    if (rowIndex === -1) {
      console.log(`ID ${id} not found in column ${PRIMARY_KEY_COLUMN_LETTER} of sheet "${sheetName}".`);
      return null;
    }

    // Google Sheets rows are 1-indexed.
    return rowIndex + 1;
  } catch (error) {
    console.error(`Error finding row for ID ${id} in sheet "${sheetName}":`, error);
    return null;
  }
}

/**
 * Format a project record into a row for Google Sheets
 * IMPORTANT: The order of values must match your Google Sheet columns
 */
function formatProjectToRow(record: any): any[] {
  if (!record) {
    console.warn("formatProjectToRow received null or undefined record. Returning empty array.");
    return [];
  }

  // The order of fields here MUST match the order of columns in your Google Sheet
  return [
    record.id,
    record.level,
    record.project_name,
    record.project_description,
    record.project_vision,
    record.project_links,
    record.referral_source,
    record.scientific_references,
    record.credential_links,
    record.team_members,
    record.motivation,
    record.progress,
    record.created_at,
    record.updated_at,
    record.referral_code,
    record.referred_by_id
  ];
}

/**
 * Format a Discord record into a row for Google Sheets
 * IMPORTANT: The order of values must match your Google Sheet columns
 */
function formatDiscordToRow(record: any): any[] {
  if (!record) {
    console.warn("formatDiscordToRow received null or undefined record. Returning empty array.");
    return [];
  }

  // The order of fields here MUST match the order of columns in your Google Sheet
  return [
    record.id,
    record.server_id,
    record.server_name,
    record.project_id,
    record.invitation_url,
    record.messages_count,
    record.papers_shared,
    record.quality_score,
    record.member_count,
    record.created_at,
    record.updated_at
  ];
}

/**
 * Sync a project to Google Sheets (create or update)
 */
export async function syncProjectToSheets(projectId: string): Promise<string> {
  try {
    console.log(`Syncing project ${projectId} to Google Sheets`);
    
    // Fetch project data from PostgreSQL
    const projectResult = await pool.query(
      'SELECT * FROM project WHERE id = $1',
      [projectId]
    );
    
    if (projectResult.rows.length === 0) {
      return `No project found with ID: ${projectId}`;
    }
    
    const projectRecord = projectResult.rows[0];
    const accessToken = await getGoogleAccessToken();
    
    // Format the project data for Google Sheets
    const rowData = formatProjectToRow(projectRecord);
    if (rowData.length === 0) {
      return `Formatted project data is empty for ID: ${projectId}. Sync skipped.`;
    }
    
    // Try to find if the project already exists in the sheet
    const rowIndex = await findRowIndexById(accessToken, projectId);
    
    if (rowIndex !== null) {
      // Row found, update it
      const lastColumnLetter = String.fromCharCode('A'.charCodeAt(0) + rowData.length - 1);
      const updateRange = `${SHEET_NAME}!A${rowIndex}:${lastColumnLetter}${rowIndex}`;
      
      console.log(`Updating row ${rowIndex} (Range: ${updateRange}) for project ID: ${projectId}`);
      
      const updateUrl = `${GOOGLE_SHEETS_API_ENDPOINT}/${SPREADSHEET_ID}/values/${updateRange}?valueInputOption=USER_ENTERED`;
      await axios.put(
        updateUrl,
        { values: [rowData] },
        { headers: { Authorization: `Bearer ${accessToken}` } }
      );
      
      return `Updated row ${rowIndex} in sheet for project ID: ${projectId}`;
    } else {
      // Row not found, create it
      console.log(`Row for project ID ${projectId} not found. Creating new row.`);
      
      const appendUrl = `${GOOGLE_SHEETS_API_ENDPOINT}/${SPREADSHEET_ID}/values/${SHEET_NAME}!A1:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`;
      await axios.post(
        appendUrl,
        { values: [rowData] },
        { headers: { Authorization: `Bearer ${accessToken}` } }
      );
      
      return `Created new row in sheet for project ID: ${projectId}`;
    }
  } catch (error) {
    console.error(`Error syncing project ${projectId} to sheets:`, error);
    throw new Error(`Failed to sync project to Google Sheets: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Sync a Discord server to Google Sheets (create or update)
 */
export async function syncDiscordToSheets(discordId: string): Promise<string> {
  try {
    console.log(`Syncing Discord ${discordId} to Google Sheets`);
    
    // Fetch Discord data from PostgreSQL
    const discordResult = await pool.query(
      'SELECT * FROM discord WHERE id = $1',
      [discordId]
    );
    
    if (discordResult.rows.length === 0) {
      return `No Discord found with ID: ${discordId}`;
    }
    
    const discordRecord = discordResult.rows[0];
    const accessToken = await getGoogleAccessToken();
    
    // Format the Discord data for Google Sheets
    const rowData = formatDiscordToRow(discordRecord);
    if (rowData.length === 0) {
      return `Formatted Discord data is empty for ID: ${discordId}. Sync skipped.`;
    }
    
    // Try to find if the Discord already exists in the sheet
    const rowIndex = await findRowIndexById(accessToken, discordId, DISCORD_SHEET_NAME);
    
    if (rowIndex !== null) {
      // Row found, update it
      const lastColumnLetter = String.fromCharCode('A'.charCodeAt(0) + rowData.length - 1);
      const updateRange = `${DISCORD_SHEET_NAME}!A${rowIndex}:${lastColumnLetter}${rowIndex}`;
      
      console.log(`Updating row ${rowIndex} (Range: ${updateRange}) for Discord ID: ${discordId}`);
      
      const updateUrl = `${GOOGLE_SHEETS_API_ENDPOINT}/${SPREADSHEET_ID}/values/${updateRange}?valueInputOption=USER_ENTERED`;
      await axios.put(
        updateUrl,
        { values: [rowData] },
        { headers: { Authorization: `Bearer ${accessToken}` } }
      );
      
      return `Updated row ${rowIndex} in sheet for Discord ID: ${discordId}`;
    } else {
      // Row not found, create it
      console.log(`Row for Discord ID ${discordId} not found. Creating new row.`);
      
      const appendUrl = `${GOOGLE_SHEETS_API_ENDPOINT}/${SPREADSHEET_ID}/values/${DISCORD_SHEET_NAME}!A1:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`;
      await axios.post(
        appendUrl,
        { values: [rowData] },
        { headers: { Authorization: `Bearer ${accessToken}` } }
      );
      
      return `Created new row in sheet for Discord ID: ${discordId}`;
    }
  } catch (error) {
    console.error(`Error syncing Discord ${discordId} to sheets:`, error);
    throw new Error(`Failed to sync Discord to Google Sheets: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Setup database triggers and functions for automatic syncing
 */
export async function setupDatabaseTriggers(): Promise<void> {
  try {
    console.log('Setting up database triggers for Google Sheets sync');
    
    // Create function for project sync
    await pool.query(`
      CREATE OR REPLACE FUNCTION sync_project_to_sheets()
      RETURNS TRIGGER AS $$
      BEGIN
        -- Add project_id to a queue table that your application will process
        INSERT INTO sheets_sync_queue (record_id, record_type, operation)
        VALUES (NEW.id, 'project', TG_OP);
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
    `);
    
    // Create function for discord sync
    await pool.query(`
      CREATE OR REPLACE FUNCTION sync_discord_to_sheets()
      RETURNS TRIGGER AS $$
      BEGIN
        -- Add discord_id to a queue table that your application will process
        INSERT INTO sheets_sync_queue (record_id, record_type, operation)
        VALUES (NEW.id, 'discord', TG_OP);
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
    `);
    
    // Create queue table if it doesn't exist
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
    
    // Create trigger for project table
    await pool.query(`
      DROP TRIGGER IF EXISTS project_sheets_sync ON project;
      CREATE TRIGGER project_sheets_sync
      AFTER INSERT OR UPDATE ON project
      FOR EACH ROW
      EXECUTE FUNCTION sync_project_to_sheets();
    `);
    
    // Create trigger for discord table
    await pool.query(`
      DROP TRIGGER IF EXISTS discord_sheets_sync ON discord;
      CREATE TRIGGER discord_sheets_sync
      AFTER INSERT OR UPDATE ON discord
      FOR EACH ROW
      EXECUTE FUNCTION sync_discord_to_sheets();
    `);
    
    console.log('Database triggers for Google Sheets sync setup complete');
  } catch (error) {
    console.error('Error setting up database triggers:', error);
    throw new Error(`Failed to setup database triggers: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Process the sync queue in batches
 */
export async function processQueue(batchSize: number = 10): Promise<string> {
  try {
    console.log(`Processing Google Sheets sync queue (batch size: ${batchSize})`);
    
    // Get unprocessed items from queue
    const queueResult = await pool.query(
      `SELECT * FROM sheets_sync_queue 
       WHERE processed_at IS NULL 
       ORDER BY created_at ASC 
       LIMIT $1`,
      [batchSize]
    );
    
    if (queueResult.rows.length === 0) {
      return 'No queue items to process';
    }
    
    let processedCount = 0;
    let errorCount = 0;
    
    // Process each queue item
    for (const item of queueResult.rows) {
      try {
        console.log(`Processing queue item: ${item.record_type} ${item.record_id} (${item.operation})`);
        
        let result = '';
        if (item.record_type === 'project') {
          result = await syncProjectToSheets(item.record_id);
        } else if (item.record_type === 'discord') {
          result = await syncDiscordToSheets(item.record_id);
        } else {
          result = `Unknown record type: ${item.record_type}`;
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

/**
 * Manually trigger sync for a specific project or discord
 */
export async function manualSync(type: 'project' | 'discord', id: string): Promise<string> {
  try {
    if (type === 'project') {
      return await syncProjectToSheets(id);
    } else if (type === 'discord') {
      return await syncDiscordToSheets(id);
    } else {
      return 'Invalid type. Must be "project" or "discord".';
    }
  } catch (error) {
    console.error(`Error in manual sync (${type} ${id}):`, error);
    throw new Error(`Manual sync failed: ${error instanceof Error ? error.message : String(error)}`);
  }
} 