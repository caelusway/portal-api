# Google Sheets Sync Service

This service automatically syncs PostgreSQL data with Google Sheets. It can sync both project and Discord server information.

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