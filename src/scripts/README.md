# BioDAO Scripts

This directory contains utility scripts for the BioDAO portal-api.

## Scripts

### send-sandbox-notifications.ts

Sends sandbox notifications to Bio team members for a specific project or projects that reached level 4 in the last 24 hours.

#### Description

This script can operate in two modes:
1. **Specific Project Mode**: When provided with a project ID, it sends sandbox notifications for that specific project regardless of level or timing
2. **Auto-Discovery Mode**: When run without arguments, it identifies projects that have reached level 4 (sandbox access) within the last 24 hours and sends notification emails to the Bio team members

This ensures the team is promptly notified when users qualify for sandbox access or allows manual triggering for specific projects.

#### Requirements

- `SANDBOX_NOTIFICATION_EMAIL` environment variable set with comma-separated email addresses
- Email service properly configured
- Database connection properly configured

#### Usage

```bash
# Send notifications for a specific project (by project ID)
npx ts-node src/scripts/send-sandbox-notifications.ts <project-id>

# Send notifications for all projects that reached level 4 in the last 24 hours
npx ts-node src/scripts/send-sandbox-notifications.ts

# Examples:
npx ts-node src/scripts/send-sandbox-notifications.ts abc123-def456-ghi789
npx ts-node src/scripts/send-sandbox-notifications.ts

# Or using npm script (if configured in package.json)
npm run script:sandbox-notifications <project-id>
npm run script:sandbox-notifications
```

#### Environment Variables

- `SANDBOX_NOTIFICATION_EMAIL`: Comma-separated list of Bio team member emails (e.g., "emre@bio.xyz,james@bio.xyz,lukas@bio.xyz")

#### Features

- **Dual Mode Operation**: Specific project targeting or automatic discovery
- **Project Validation**: Warns if a specific project is below level 4 but proceeds anyway
- **Detailed Project Information**: Includes project name, user email, Discord stats, level, and timestamps
- **Comprehensive logging and error handling**
- **Rate limiting between email sends** to avoid spam filters
- **Exit codes for monitoring** (0 = success, 1 = failure)
- **Graceful error handling** for missing projects or email failures

#### Use Cases

1. **Manual Notifications**: Send sandbox notifications for a specific project when needed
2. **Automated Monitoring**: Run periodically to catch new level 4 projects
3. **Testing**: Verify email functionality with specific projects
4. **Recovery**: Resend notifications for projects that may have been missed

#### Scheduling

For automatic discovery mode, this script is designed to be run periodically (e.g., daily) via cron or a task scheduler:

```bash
# Example cron job to run daily at 9 AM for auto-discovery
0 9 * * * cd /path/to/portal-api && npx ts-node src/scripts/send-sandbox-notifications.ts

# Example cron job to send notifications for a specific project
0 10 * * * cd /path/to/portal-api && npx ts-node src/scripts/send-sandbox-notifications.ts abc123-def456-ghi789
```

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