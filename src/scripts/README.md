# BioDAO Scripts

This directory contains utility scripts for the BioDAO portal-api.

## Scripts

### sync-all-projects.ts

Syncs newly created projects to Google Sheets.

#### Description

This script syncs projects created within a configurable time period (default: last 30 days) to Google Sheets. It runs once and exits, making it perfect for periodic scheduled execution.

#### Usage

```bash
# Sync projects created in the last 30 days (default)
npx ts-node src/scripts/sync-all-projects.ts

# Sync projects created in the last 7 days
npx ts-node src/scripts/sync-all-projects.ts 7

# Sync projects created in the last 60 days
npx ts-node src/scripts/sync-all-projects.ts 60
```

### sync-new-projects.ts

Automatically syncs new projects to Google Sheets every 5 minutes.

#### Description

This script checks the database for projects created in the last 30 days and syncs them to the configured Google Sheet. It runs continuously with a configurable interval.

#### Requirements

- Google Sheets API credentials properly configured in `.env` (GOOGLE_SERVICE_ACCOUNT_CREDENTIALS and GOOGLE_SHEET_ID)
- Database connection properly configured

#### Usage

Run the script directly using ts-node:

```bash
# Run with default 5-minute interval
npx ts-node src/scripts/sync-new-projects.ts

# Run with custom interval (e.g., 10 minutes)
npx ts-node src/scripts/sync-new-projects.ts 10
```

#### Running in production

For production environments, use a process manager like PM2:

```bash
# Install PM2 if not already installed
npm install -g pm2

# Start the script with PM2
pm2 start --name "project-sync" ts-node -- src/scripts/sync-new-projects.ts

# Check status
pm2 status

# View logs
pm2 logs project-sync
```

#### Environment Variables

- `SYNC_INTERVAL_MINUTES`: Override the default 5-minute interval

### one-time-sync-new-projects.ts

Performs a one-time sync of new projects to Google Sheets without continuously running.

#### Description

Similar to `sync-new-projects.ts`, but runs once and exits. Useful for testing or manual syncing operations.

#### Usage

```bash
# Run the one-time sync
npx ts-node src/scripts/one-time-sync-new-projects.ts
```

### Other Scripts

- `update-last-activity.ts`: Updates last activity timestamps for projects
- `initialize-sheets.ts`: Initializes Google Sheets with headers
- `delete-unnamed-projects.ts`: Deletes unnamed projects from the database 