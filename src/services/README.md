# Google Sheets Sync Service

This service syncs BioDAO project and Discord server data to Google Sheets. It provides real-time updates to a Google Sheet whenever project or Discord data changes.

## Architecture Overview

The system uses a two-part approach to sync data:

1. **Core Sync Service** (`sheets-sync.service.ts`): Handles the actual synchronization of data to Google Sheets. This service does NOT modify the database structure.

2. **Database Setup Service** (`sheets-db-setup.service.ts`): Manages database triggers and functions that automatically populate a queue whenever project or Discord data changes. This service DOES modify the database structure.

## Files and Components

### Core Service Files (Non-DB-Modifying)

- **`sheets-sync.service.ts`**: Main service for syncing data to Google Sheets
  - `syncProjectToSheets(projectId)`: Syncs a project and its Discord data to Google Sheets
  - `syncDiscordToSheets(discordId)`: Syncs Discord data via its associated project
  - `initializeSheetWithAllProjects()`: Syncs all projects to the sheet

- **`initialize-sheets.ts`**: Script to manually sync projects
  - Use to sync all projects or a specific project to Google Sheets
  - Does NOT modify database structure

### Database Setup Files (DB-Modifying)

- **`sheets-db-setup.service.ts`**: Service for managing database triggers and queue
  - `setupDatabaseTriggersAndQueue()`: Creates DB functions, triggers, and queue table
  - `removeDatabaseTriggersAndFunctions()`: Removes DB functions and triggers
  - `processSyncQueue(batchSize)`: Processes queue items

- **`setup-sheets-db-triggers.ts`**: Script to set up or remove database triggers
  - Use to create or remove database triggers and functions
  - MODIFIES database structure

- **`process-sheets-sync-queue.ts`**: Script to process the sync queue
  - Use to manually process queue or run in watch mode
  - MODIFIES queue data but not structure

## How It Works

1. When enabled, database triggers automatically add items to `sheets_sync_queue` when project or Discord data changes
2. The queue processor reads from this queue and calls the sync service
3. The sync service reads from the database and updates Google Sheets

## Safety Features

- Scripts require environment variables to be set to run
- Database modification scripts have confirmation delays
- Watch mode for queue processor has error handling to prevent crashes

## Usage

### To sync data without setting up database triggers

```bash
# Initialize all projects in the sheet
INITIALIZE_SHEET=true npm run initialize-sheets

# Sync a specific project
INITIALIZE_SHEET=true npm run initialize-sheets -- --project=<project-id>
```

### To set up database triggers (one-time setup)

```bash
# Set up database triggers and queue
SETUP_SHEETS_DB=true npm run setup-sheets-db -- --setup

# Remove database triggers
SETUP_SHEETS_DB=true npm run setup-sheets-db -- --remove
```

### To process the queue

```bash
# Process queue once
PROCESS_SHEETS_QUEUE=true npm run process-sheets-queue

# Process queue continuously (watch mode)
PROCESS_SHEETS_QUEUE=true npm run process-sheets-queue -- --watch
```

## Configuration

Set these environment variables to customize behavior:

- `GOOGLE_SERVICE_ACCOUNT_CREDENTIALS`: JSON credentials for Google service account
- `GOOGLE_SHEET_ID`: ID of the Google Sheet to sync with
- `BATCH_SIZE`: Number of queue items to process in one batch (default: 10)
- `WATCH_INTERVAL`: Seconds between processing attempts in watch mode (default: 60)

## Important Notes

1. **Database Modifications**: The `sheets-db-setup.service.ts` creates database objects including triggers, functions, and a queue table. Only run the setup script if you want these objects created.

2. **Error Handling**: The system is designed to be resilient, with errors in one sync not affecting others.

3. **Performance**: The trigger and queue approach ensures that syncing doesn't impact application performance.

## Features

- Automatic syncing using PostgreSQL triggers
- Queue-based processing to handle high volume
- Supports both project and Discord data
- Manual sync capability via CLI
- Error handling and logging

## Setup

### 1. Install dependencies

```bash
npm install google-auth-library axios pg dotenv
```

### 2. Environment variables

Create a `.env` file with the following:

```
# Database
DATABASE_URL=postgresql://username:password@localhost:5432/database_name

# Google Sheets API
GOOGLE_SERVICE_ACCOUNT_CREDENTIALS={"type":"service_account","project_id":"...","private_key_id":"...","private_key":"...","client_email":"...","client_id":"...","auth_uri":"...","token_uri":"...","auth_provider_x509_cert_url":"...","client_x509_cert_url":"..."}
GOOGLE_SHEET_ID=your_spreadsheet_id_here

# Sync settings
SYNC_BATCH_SIZE=10
SYNC_POLL_INTERVAL_MS=60000
```

### 3. Google Sheets setup

1. Create a Google Sheets spreadsheet with two sheets:
   - "Projects" - First row should have column headers matching the data fields
   - "Discords" - First row should have column headers matching the data fields

2. First column must be the primary key ID for each record

3. Share the spreadsheet with the service account email (read from your service account credentials)

### 4. Set up database triggers

Run the setup script:

```bash
ts-node src/scripts/manual-sheets-sync.ts setup
```

This will:
1. Create the necessary PostgreSQL functions and triggers
2. Create a `sheets_sync_queue` table to track sync requests

## Usage

### Automatic syncing

Start the queue processor:

```bash
ts-node src/scripts/process-sheets-sync-queue.ts
```

This will:
1. Process any pending sync requests immediately
2. Continue to poll for new sync requests at regular intervals

### Manual syncing

To manually sync a specific record:

```bash
# Sync a project
ts-node src/scripts/manual-sheets-sync.ts sync project your_project_id

# Sync a Discord server
ts-node src/scripts/manual-sheets-sync.ts sync discord your_discord_id
```

## How it works

1. When a project or Discord record is inserted or updated in PostgreSQL, a database trigger adds an entry to the `sheets_sync_queue` table.

2. The queue processor regularly checks for unprocessed items in the queue.

3. For each item, it:
   - Retrieves the current data from PostgreSQL
   - Formats the data for Google Sheets
   - Checks if the record already exists in the sheet
   - Updates the existing row or creates a new one
   - Marks the queue item as processed

## Customization

### Changing column mapping

If your database schema differs from the expected format, modify the `formatProjectToRow` and `formatDiscordToRow` functions in `sheets-sync.service.ts` to match your schema.

### Adding more record types

To sync additional types of records:

1. Add a new formatting function (similar to `formatProjectToRow`)
2. Add a new sync function (similar to `syncProjectToSheets`)
3. Add a new database trigger and function in `setupDatabaseTriggers()`
4. Update the `processQueue` function to handle the new record type

## Troubleshooting

### Queue items failing

Check the `sheets_sync_queue` table for items with status starting with "failed" to see the error message:

```sql
SELECT * FROM sheets_sync_queue WHERE status LIKE 'failed:%';
```

### Service account permissions

Ensure your service account has edit access to the Google Sheet. 