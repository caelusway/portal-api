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