/**
 * Database Schema Check Tool
 * 
 * This script checks the PostgreSQL database schema and lists tables
 * to help diagnose issues with table names and case sensitivity.
 */

import { Pool } from 'pg';
import dotenv from 'dotenv';

dotenv.config();

// Initialize PostgreSQL connection pool
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

async function checkDatabaseSchema() {
  console.log('🔍 PostgreSQL Database Schema Check');
  console.log('----------------------------------');
  
  try {
    // Test connection
    console.log('Testing database connection...');
    await pool.query('SELECT NOW()');
    console.log('✅ Connection successful!');
    
    // Get all tables from the database
    console.log('\n📋 Checking tables in the database...');
    const tableResult = await pool.query(`
      SELECT table_schema, table_name 
      FROM information_schema.tables 
      WHERE table_schema NOT IN ('pg_catalog', 'information_schema')
      ORDER BY table_schema, table_name
    `);
    
    if (tableResult.rows.length === 0) {
      console.log('⚠️ No tables found in the database');
    } else {
      console.log(`Found ${tableResult.rows.length} tables:`);
      console.log('--------------------------');
      
      // Group tables by schema
      const tablesBySchema: Record<string, string[]> = {};
      tableResult.rows.forEach((row) => {
        if (!tablesBySchema[row.table_schema]) {
          tablesBySchema[row.table_schema] = [];
        }
        tablesBySchema[row.table_schema].push(row.table_name);
      });
      
      // Print tables by schema
      for (const schema in tablesBySchema) {
        console.log(`\nSchema: ${schema}`);
        console.log('---------------------');
        tablesBySchema[schema].forEach((tableName) => {
          console.log(`- ${tableName}`);
        });
      }
    }
    
    // Specifically check for Project and Discord tables
    console.log('\n🔍 Looking for Project and Discord tables...');
    const projectTables = await pool.query(`
      SELECT table_schema, table_name 
      FROM information_schema.tables 
      WHERE table_name IN ('project', 'Project', 'discord', 'Discord')
        AND table_schema NOT IN ('pg_catalog', 'information_schema')
    `);
    
    if (projectTables.rows.length === 0) {
      console.log('⚠️ Critical: Project and Discord tables not found!');
    } else {
      console.log('Tables found:');
      projectTables.rows.forEach((row) => {
        console.log(`- ${row.table_schema}.${row.table_name}`);
      });
      
      // For each found table, check its columns
      for (const table of projectTables.rows) {
        console.log(`\n📋 Columns in ${table.table_schema}.${table.table_name}:`);
        const columnsResult = await pool.query(`
          SELECT column_name, data_type, is_nullable
          FROM information_schema.columns
          WHERE table_schema = $1 AND table_name = $2
          ORDER BY ordinal_position
        `, [table.table_schema, table.table_name]);
        
        columnsResult.rows.forEach((column) => {
          console.log(`- ${column.column_name} (${column.data_type}, ${column.is_nullable === 'YES' ? 'nullable' : 'not nullable'})`);
        });
      }
    }
    
  } catch (error) {
    console.error('❌ Database error:', error);
  } finally {
    await pool.end();
    console.log('\n✨ Database check complete');
  }
}

checkDatabaseSchema().catch(error => {
  console.error('Unhandled error:', error);
  process.exit(1);
}); 