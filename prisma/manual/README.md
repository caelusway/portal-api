# Database Migration Script

This folder contains a migration script to migrate data from an old database schema to the new schema.

## Overview

The migration script performs the following steps:
1. Backs up all data from the old database
2. Creates BioUsers from Project data
3. Migrates Projects with correct relationships
4. Migrates NFTs
5. Migrates Discord data
6. Migrates Chat Sessions and Messages
7. Creates Twitter records (which don't exist in the old schema)

## Prerequisites

The script requires the following dependencies:
- Node.js v14+
- TypeScript
- PostgreSQL client (`pg`)
- Prisma Client

## Setup

1. Copy the `env-example.txt` file to `.env` in the project root:
   ```
   cp prisma/migrations/manual/env-example.txt .env
   ```

2. Edit the `.env` file and update the database connection strings:
   ```
   OLD_DATABASE_URL="postgresql://username:password@old-host:5432/old-database?sslmode=no-verify"
   DATABASE_URL="postgresql://username:password@new-host:5432/new-database"
   ```

3. Install the required dependencies:
   ```
   npm install pg @types/pg dotenv
   ```

## Running the Migration

Run the migration script with:
```
npx ts-node prisma/migrations/manual/migrate_data.ts
```

The script will:
1. Create a backup of all data in the `backup` directory
2. Perform the migration steps
3. Log progress and any errors

## Troubleshooting

### SSL Certificate Issues

If you encounter SSL certificate errors, modify your database URL to include:
- `?sslmode=no-verify` for PostgreSQL
- Or `?ssl=false` to disable SSL completely

### Schema Conflicts

This script uses raw SQL queries to avoid schema conflicts between the old and new database models. The main solution is:
1. Using raw queries for the old database to bypass Prisma schema validation
2. Explicitly adding default values for new fields that don't exist in the old schema

### Database Access

Ensure that:
1. The database URLs are correctly formatted
2. The user has sufficient permissions on both databases
3. Network access is available to both database servers

# Database Migration to Supabase

This directory contains scripts for database backup and migration to Supabase.

## Migration Script

The `migrate-to-supabase.ts` script provides an all-in-one solution for migrating your PostgreSQL database to Supabase.

### Prerequisites

- Node.js and TypeScript installed
- PostgreSQL client tools installed (`pg_dump` and `psql` commands available)
- `.env` file with proper database connection strings:
  - `DATABASE_URL`: Source PostgreSQL database connection string
  - `SUPABASE_DB_URL`: Target Supabase database connection string

### Usage

Run the script with:

```bash
# Install dependencies if needed
npm install dotenv @prisma/client

# Run with ts-node
npx ts-node prisma/manual/migrate-to-supabase.ts [chunkSize]
```

Optional parameters:
- `chunkSize`: Number of SQL lines to process in each chunk (default: 5000)

### What the Script Does

1. **Backup Creation**: Creates a backup of your source database using `pg_dump` with options optimized for Supabase compatibility.
2. **Smart Import**: Analyzes the backup file size and chooses the best import strategy:
   - For small files (<8MB): Direct import
   - For large files: Splits into manageable chunks for better performance
3. **Error Handling**: Provides detailed error messages if any step fails
4. **Progress Reporting**: Shows real-time progress during the migration
5. **Cleanup**: Automatically removes temporary files after completion

### Connection String Format

Both connection strings should be in PostgreSQL format:
```
postgresql://username:password@hostname:port/database
```

For Supabase, the connection string typically looks like:
```
postgres://postgres:password@db.xxxxxxxxxxxxxxxxxxxx.supabase.co:5432/postgres
```

### Troubleshooting

- **Permission Errors**: Ensure you have the necessary permissions to both databases
- **Missing Tools**: Confirm that `pg_dump` and `psql` are installed and available in your PATH
- **Connection Issues**: Verify that both database URLs are correct and accessible from your network
- **Large Databases**: For very large databases, consider increasing the chunk size for better performance

### Considerations

- The migration process can take some time for large databases
- The script temporarily disables foreign key constraints during import to handle circular references
- All schema objects are imported without owners or permissions (Supabase manages these aspects) 