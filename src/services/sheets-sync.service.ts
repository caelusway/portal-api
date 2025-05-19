import { JWT } from 'google-auth-library';
import axios from 'axios';
import { Pool } from 'pg';
import dotenv from 'dotenv';

dotenv.config();

// --- Configuration ---
const SERVICE_ACCOUNT_JSON_STRING = process.env.GOOGLE_SERVICE_ACCOUNT_CREDENTIALS;
const SPREADSHEET_ID = process.env.GOOGLE_SHEET_ID;
const SHEET_NAME = 'Projects'; // Combined sheet for Projects and their Discord data
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
  
  try {
    // Try to parse the service account credentials JSON
    let creds;
    try {
      creds = JSON.parse(SERVICE_ACCOUNT_JSON_STRING);
    } catch (jsonError) {
      // Provide detailed error about the JSON parsing issue
      const errorMsg = jsonError instanceof Error ? jsonError.message : String(jsonError);
      console.error('Failed to parse Google service account credentials JSON:', errorMsg);
      
      // Show a snippet of the credentials string to help diagnose (first 20 chars)
      const credSnippet = SERVICE_ACCOUNT_JSON_STRING.length > 20
        ? SERVICE_ACCOUNT_JSON_STRING.substring(0, 20) + '...'
        : SERVICE_ACCOUNT_JSON_STRING;
      console.error('Service account credentials snippet:', credSnippet);
      
      throw new Error(`Invalid Google service account credentials JSON: ${errorMsg}. Check that your GOOGLE_SERVICE_ACCOUNT_CREDENTIALS environment variable contains valid JSON.`);
    }
    
    // Check if the parsed credentials have the required fields
    if (!creds.client_email || !creds.private_key) {
      throw new Error('Google service account credentials are missing required fields (client_email and/or private_key)');
    }
    
    const client = new JWT({
      email: creds.client_email,
      key: creds.private_key,
      scopes: GOOGLE_SHEETS_SCOPES,
    });

    const token = await client.authorize();
    return token.access_token || '';
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error('Error getting Google access token:', errorMsg);
    throw new Error(`Failed to get Google access token: ${errorMsg}`);
  }
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
 * Format a project record into a row for Google Sheets, including its Discord data if available
 * IMPORTANT: The order of values must match your Google Sheet columns
 */
function formatProjectToRow(record: any, discordRecord: any = null): any[] {
  if (!record) {
    console.warn("formatProjectToRow received null or undefined record. Returning empty array.");
    return [];
  }

  // Start with project data
  const rowData = [
    record.id,
    record.level,
    record.projectName,
    record.projectDescription,
    record.projectVision,
    record.projectLinks,
    record.referralSource,
    record.scientificReferences,
    record.credentialLinks,
    record.teamMembers,
    record.motivation,
    record.progress,
    record.referralCode,
    record.referredById
  ];

  // Add Discord data if available
  if (discordRecord) {
    rowData.push(
      discordRecord.id,
      discordRecord.serverId,
      discordRecord.serverName,
      discordRecord.invitationUrl,
      discordRecord.messagesCount,
      discordRecord.papersShared,
      discordRecord.qualityScore,
      discordRecord.memberCount
    );
  } else {
    // Add empty values for Discord columns
    for (let i = 0; i < 8; i++) { // Reduced from 10 to 8 Discord fields (removed createdAt/updatedAt)
      rowData.push("");
    }
  }

  return rowData;
}

/**
 * Sync a project to Google Sheets (create or update)
 */
export async function syncProjectToSheets(projectId: string): Promise<string> {
  try {
    console.log(`Syncing project ${projectId} to Google Sheets with Discord data`);
    
    // Fetch project data from PostgreSQL - Fix table name case sensitivity with quotes
    const projectResult = await pool.query(
      'SELECT * FROM "Project" WHERE id = $1',
      [projectId]
    );
    
    if (projectResult.rows.length === 0) {
      return `No project found with ID: ${projectId}`;
    }
    
    const projectRecord = projectResult.rows[0];
    
    // Fetch associated Discord data (if any)
    let discordRecord = null;
    const discordResult = await pool.query(
      'SELECT * FROM "Discord" WHERE "projectId" = $1 LIMIT 1',
      [projectId]
    );
    
    if (discordResult.rows.length > 0) {
      discordRecord = discordResult.rows[0];
      console.log(`Found associated Discord server: ${discordRecord.serverName} (${discordRecord.id}) for project ${projectId}`);
    } else {
      console.log(`No Discord server found for project ${projectId}`);
    }
    
    const accessToken = await getGoogleAccessToken();
    
    // Format the project data with Discord data for Google Sheets
    const rowData = formatProjectToRow(projectRecord, discordRecord);
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
      
      return `Updated row ${rowIndex} in sheet for project ID: ${projectId} with Discord data`;
    } else {
      // Row not found, create it
      console.log(`Row for project ID ${projectId} not found. Creating new row.`);
      
      const appendUrl = `${GOOGLE_SHEETS_API_ENDPOINT}/${SPREADSHEET_ID}/values/${SHEET_NAME}!A1:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`;
      await axios.post(
        appendUrl,
        { values: [rowData] },
        { headers: { Authorization: `Bearer ${accessToken}` } }
      );
      
      return `Created new row in sheet for project ID: ${projectId} with Discord data`;
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
    console.log(`Syncing Discord ${discordId} to Google Sheets by updating project row`);
    
    // Fetch Discord data from PostgreSQL - Fix table name case sensitivity with quotes
    const discordResult = await pool.query(
      'SELECT * FROM "Discord" WHERE id = $1',
      [discordId]
    );
    
    if (discordResult.rows.length === 0) {
      return `No Discord found with ID: ${discordId}`;
    }
    
    const discordRecord = discordResult.rows[0];
    
    // Get the associated project ID
    const projectId = discordRecord.projectId;
    if (!projectId) {
      return `Discord ${discordId} has no associated project_id. Cannot sync to project row.`;
    }
    
    // Sync by calling the project sync function with this Discord data
    return await syncProjectToSheets(projectId);
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
    console.log('Setting up database triggers for Google Sheets sync - SKIPPED to avoid DB schema changes');
    // This function is intentionally left empty to avoid modifying the database schema
    // For actual setup of database triggers, use the dedicated file: src/services/sheets-db-setup.service.ts
  } catch (error) {
    console.error('Error in setupDatabaseTriggers (skipped):', error);
    throw new Error(`Failed to setup database triggers: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Process the sync queue in batches
 */
export async function processQueue(batchSize: number = 10): Promise<string> {
  try {
    console.log(`Processing Google Sheets sync queue (batch size: ${batchSize}) - SKIPPED to avoid DB interactions`);
    return 'Queue processing is disabled. Use the dedicated service in sheets-db-setup.service.ts if needed.';
  } catch (error) {
    console.error('Error in processQueue (skipped):', error);
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
      // For Discord, we'll find the associated project and sync that
      const discordResult = await pool.query(
        'SELECT "projectId" FROM "Discord" WHERE id = $1',
        [id]
      );
      
      if (discordResult.rows.length === 0 || !discordResult.rows[0].projectId) {
        return `No project associated with Discord ID: ${id}. Cannot sync.`;
      }
      
      const projectId = discordResult.rows[0].projectId;
      return await syncProjectToSheets(projectId);
    } else {
      return 'Invalid type. Must be "project" or "discord".';
    }
  } catch (error) {
    console.error(`Error in manual sync (${type} ${id}):`, error);
    throw new Error(`Manual sync failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Initialize the Google Sheet with all existing projects and their Discord stats
 * This is useful for the first run or to completely refresh the sheet
 */
export async function initializeSheetWithAllProjects(): Promise<string> {
  try {
    console.log('Initializing Google Sheet with all existing projects and their Discord stats');
    
    // Get all projects from the database - removed ORDER BY "createdAt"
    const projectsResult = await pool.query('SELECT id FROM "Project"');
    
    if (projectsResult.rows.length === 0) {
      return 'No projects found in the database to sync';
    }
    
    console.log(`Found ${projectsResult.rows.length} projects to sync`);
    
    let successCount = 0;
    let errorCount = 0;
    let errorDetails: string[] = [];
    
    // Sync each project to the Google Sheet
    for (const project of projectsResult.rows) {
      try {
        console.log(`Syncing project ${project.id}...`);
        await syncProjectToSheets(project.id);
        successCount++;
      } catch (error) {
        errorCount++;
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.error(`Error syncing project ${project.id}:`, error);
        errorDetails.push(`Project ${project.id}: ${errorMessage}`);
      }
    }
    
    // Include first 3 error details in the result message (if any)
    let errorSummary = '';
    if (errorDetails.length > 0) {
      const detailsToShow = errorDetails.slice(0, 3);
      errorSummary = `\nFirst ${detailsToShow.length} errors: \n` + detailsToShow.join('\n');
      if (errorDetails.length > 3) {
        errorSummary += `\n...and ${errorDetails.length - 3} more errors.`;
      }
    }
    
    return `Initialized sheet with ${successCount} projects (${errorCount} errors)${errorSummary}`;
  } catch (error) {
    console.error('Error initializing sheet with all projects:', error);
    throw new Error(`Failed to initialize sheet: ${error instanceof Error ? error.message : String(error)}`);
  }
} 