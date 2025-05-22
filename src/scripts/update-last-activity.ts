/**
 * Last Activity Update Script
 * 
 * This script updates the lastActivity column in Google Sheets for all projects.
 * It determines the most recent activity time by comparing:
 * - Project updatedAt timestamp
 * - Associated Discord record updatedAt timestamp
 * - Most recent ChatMessage timestamp (if available)
 * 
 * Usage:
 * npm run update-last-activity
 * 
 * To update a single project:
 * npm run update-last-activity -- --project=<project-id>
 */

import dotenv from 'dotenv';
import { Pool } from 'pg';
import { formatDateWithRelative } from '../services/utils';
import { updateLastActivity, syncProjectToSheets } from '../services/sheets-sync.service';

// Load environment variables
dotenv.config();

// Initialize PostgreSQL connection pool
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// Rate limiting configuration
const RATE_LIMIT = {
  DELAY_BETWEEN_REQUESTS: 1000, // 1 second between requests
  MAX_RETRIES: 5,               // Maximum number of retries for rate-limited requests
  RETRY_DELAY: 5000,            // 5 seconds delay before retrying after a rate limit
  EXPONENTIAL_BACKOFF: true     // Increase delay time exponentially with each retry
};

/**
 * Utility function to wait for a specified time
 * @param ms Milliseconds to wait
 */
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Retries a function with exponential backoff when rate limited
 * @param fn The function to execute
 * @param retries Maximum number of retries
 * @param initialDelay Initial delay in ms
 */
async function executeWithRetry<T>(
  fn: () => Promise<T>,
  retries = RATE_LIMIT.MAX_RETRIES,
  initialDelay = RATE_LIMIT.RETRY_DELAY
): Promise<T> {
  try {
    return await fn();
  } catch (error: any) {
    // Check if this is a rate limit error (429)
    const isRateLimit = error.message?.includes('429') || 
                        error.response?.status === 429 ||
                        error.code === 'ERR_BAD_REQUEST';
                        
    if (isRateLimit && retries > 0) {
      console.log(`⚠️ Rate limit exceeded. Retrying in ${initialDelay/1000} seconds... (${retries} retries left)`);
      await sleep(initialDelay);
      
      // Calculate next delay with exponential backoff if enabled
      const nextDelay = RATE_LIMIT.EXPONENTIAL_BACKOFF 
        ? initialDelay * 2 
        : initialDelay;
        
      return executeWithRetry(fn, retries - 1, nextDelay);
    }
    
    // For non-rate-limit errors or if we've exhausted retries, throw the error
    throw error;
  }
}

async function main() {
  console.log('🕒 Last Activity Update Script');
  console.log('------------------------------------');

  // Parse command line arguments
  let projectId: string | null = null;
  let forceFlag = false;
  
  process.argv.forEach(arg => {
    // Look for --project=<id> pattern
    if (arg.startsWith('--project=')) {
      projectId = arg.split('=')[1];
    }
    // Look for --force flag to skip confirmation
    if (arg === '--force') {
      forceFlag = true;
    }
  });

  try {
    if (projectId) {
      // Update lastActivity for a single project
      console.log(`🔎 Updating lastActivity for single project: ${projectId}`);
      await updateProjectLastActivity(projectId);
    } else {
      // Update lastActivity for all projects
      console.log('🔄 Updating lastActivity for all projects in Google Sheets...');
      console.log('⚠️ This can trigger Google API rate limits if too many requests are made too quickly.');
      console.log(`ℹ️ Using ${RATE_LIMIT.DELAY_BETWEEN_REQUESTS}ms delay between requests with up to ${RATE_LIMIT.MAX_RETRIES} retries.`);
      
      if (!forceFlag) {
        console.log('⚠️ To continue, run with: npm run update-last-activity -- --force');
        process.exit(0);
      }
      
      await updateAllProjectsLastActivity();
    }
    
    console.log('✨ lastActivity update completed successfully!');
    console.log('------------------------------------');
    
  } catch (error) {
    console.error('❌ Error during lastActivity update:', error);
    process.exit(1);
  }
}

/**
 * Update lastActivity for a specific project
 */
async function updateProjectLastActivity(projectId: string): Promise<void> {
  try {
    // Get project data
    const projectResult = await pool.query(
      'SELECT id, "updatedAt" FROM "Project" WHERE id = $1',
      [projectId]
    );
    
    if (projectResult.rows.length === 0) {
      console.error(`❌ No project found with ID: ${projectId}`);
      return;
    }
    
    const project = projectResult.rows[0];
    let lastActivityTime = project.updatedAt ? new Date(project.updatedAt) : null;
    
    // Get associated Discord data
    const discordResult = await pool.query(
      'SELECT id, "updatedAt" FROM "Discord" WHERE "projectId" = $1',
      [projectId]
    );
    
    if (discordResult.rows.length > 0) {
      const discord = discordResult.rows[0];
      
      // Check Discord updatedAt
      if (discord.updatedAt) {
        const discordUpdateTime = new Date(discord.updatedAt);
        if (!lastActivityTime || discordUpdateTime > lastActivityTime) {
          lastActivityTime = discordUpdateTime;
          console.log(`📝 Using Discord updatedAt as lastActivity for project ${projectId}`);
        }
      }
    }
    
    // Check for most recent chat message for this project
    try {
      const chatMessageResult = await pool.query(`
        SELECT MAX(cm.timestamp) as last_message_time
        FROM "ChatMessage" cm
        JOIN "ChatSession" cs ON cm.sessionId = cs.id
        WHERE cs.projectId = $1
      `, [projectId]);
      
      if (chatMessageResult.rows[0]?.last_message_time) {
        const chatMessageTime = new Date(chatMessageResult.rows[0].last_message_time);
        if (!lastActivityTime || chatMessageTime > lastActivityTime) {
          lastActivityTime = chatMessageTime;
          console.log(`📝 Using ChatMessage timestamp as lastActivity for project ${projectId}`);
        }
      }
    } catch (error) {
      // If any error occurs with chat message check, just log and continue
      console.log(`ℹ️ Could not check for chat message timestamp: ${error instanceof Error ? error.message : String(error)}`);
    }
    
    // Use current time if no timestamps found
    if (!lastActivityTime) {
      lastActivityTime = new Date();
      console.log(`⚠️ No activity timestamps found for project ${projectId}, using current time`);
    }
    
    // Format the timestamp
    const formattedTime = formatDateWithRelative(lastActivityTime);
    console.log(`🕒 Last activity for project ${projectId}: ${formattedTime}`);
    
    // Update the lastActivity column in Google Sheets with retry logic
    const result = await executeWithRetry(() => updateLastActivity(projectId, lastActivityTime));
    console.log(`✅ ${result}`);
    
  } catch (error) {
    console.error(`❌ Error updating lastActivity for project ${projectId}:`, error);
    throw new Error(`Failed to update lastActivity for project ${projectId}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Update lastActivity for all projects in the database
 */
async function updateAllProjectsLastActivity(): Promise<void> {
  try {
    // Get all projects
    const projectsResult = await pool.query('SELECT id FROM "Project"');
    
    if (projectsResult.rows.length === 0) {
      console.log('ℹ️ No projects found in the database');
      return;
    }
    
    console.log(`🔍 Found ${projectsResult.rows.length} projects to update`);
    
    // Process each project
    let successCount = 0;
    let errorCount = 0;
    
    for (const [index, project] of projectsResult.rows.entries()) {
      try {
        console.log(`⏳ Updating lastActivity for project ${project.id}... (${index + 1}/${projectsResult.rows.length})`);
        await updateProjectLastActivity(project.id);
        successCount++;
        
        // Add delay between requests to avoid rate limiting
        if (index < projectsResult.rows.length - 1) {
          console.log(`⏱️ Waiting ${RATE_LIMIT.DELAY_BETWEEN_REQUESTS}ms before next request...`);
          await sleep(RATE_LIMIT.DELAY_BETWEEN_REQUESTS);
        }
      } catch (error) {
        console.error(`❌ Error updating project ${project.id}:`, error);
        errorCount++;
      }
    }
    
    console.log(`📊 Summary: Updated ${successCount} projects successfully (${errorCount} failures)`);
    
  } catch (error) {
    console.error('❌ Error updating all projects:', error);
    throw new Error(`Failed to update all projects: ${error instanceof Error ? error.message : String(error)}`);
  }
}

// Execute the script
main().catch(error => {
  console.error('❌ Unhandled error:', error);
  process.exit(1);
}); 