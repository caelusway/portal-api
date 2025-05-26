#!/usr/bin/env ts-node

import { PrismaClient } from '@prisma/client';
import { syncProjectToSheets } from '../services/sheets-sync.service';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

const prisma = new PrismaClient();

// Flag to track if the script is already running
let isRunning = false;

/**
 * Main function to check and sync new projects to Google Sheets
 */
async function syncNewProjects(): Promise<void> {
  // Prevent multiple instances from running simultaneously
  if (isRunning) {
    console.log('[SYNC_NEW_PROJECTS] Previous sync still running, skipping this run');
    return;
  }

  try {
    isRunning = true;
    console.log('[SYNC_NEW_PROJECTS] Checking for new projects to sync to Google Sheets');

    // Query for projects that haven't been synced to sheets yet
    const newProjects = await prisma.project.findMany({
      where: {
        // Check for projects created in the last 30 days that haven't been synced
        createdAt: {
          gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) // 30 days ago
        }
      },
      orderBy: {
        createdAt: 'asc'
      },
      take: 10 // Process in batches to avoid overloading
    });

    if (newProjects.length === 0) {
      console.log('[SYNC_NEW_PROJECTS] No new projects found that need syncing');
      return;
    }

    console.log(`[SYNC_NEW_PROJECTS] Found ${newProjects.length} new projects to sync`);

    // Sync each project to Google Sheets
    let successCount = 0;
    let errorCount = 0;

    for (const project of newProjects) {
      try {
        console.log(`[SYNC_NEW_PROJECTS] Syncing project: ${project.id} (${project.projectName || 'Unnamed Project'})`);
        
        const result = await syncProjectToSheets(project.id);
        
        console.log(`[SYNC_NEW_PROJECTS] Successfully synced project ${project.id}: ${result}`);
        successCount++;
      } catch (error) {
        console.error(`[SYNC_NEW_PROJECTS] Error syncing project ${project.id}:`, error);
        errorCount++;
      }
    }

    console.log(`[SYNC_NEW_PROJECTS] Sync completed. Success: ${successCount}, Errors: ${errorCount}`);
  } catch (error) {
    console.error('[SYNC_NEW_PROJECTS] Error in syncNewProjects:', error);
  } finally {
    isRunning = false;
  }
}

/**
 * Set up interval to run the sync process every 5 minutes
 */
function startPeriodicSync(intervalMinutes: number = 5): void {
  // Initial run when script starts
  syncNewProjects();

  // Then run every X minutes
  const intervalMs = intervalMinutes * 60 * 1000;
  setInterval(syncNewProjects, intervalMs);
  
  console.log(`[SYNC_NEW_PROJECTS] Periodic sync scheduled to run every ${intervalMinutes} minutes`);
}

// When run directly (node sync-new-projects.js)
if (require.main === module) {
  console.log('[SYNC_NEW_PROJECTS] Starting periodic sync of new projects to Google Sheets');
  
  // Get interval from arguments or environment, default to 5 minutes
  const intervalMinutes = parseInt(process.argv[2]) || parseInt(process.env.SYNC_INTERVAL_MINUTES || '') || 5;
  
  startPeriodicSync(intervalMinutes);
  
  // Keep the process alive
  console.log(`[SYNC_NEW_PROJECTS] Process running. Will check for new projects every ${intervalMinutes} minutes`);
  
  // Handle graceful shutdown
  const shutdown = () => {
    console.log('[SYNC_NEW_PROJECTS] Shutting down...');
    process.exit(0);
  };
  
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
} else {
  // When imported as a module, export the functions
  module.exports = {
    syncNewProjects,
    startPeriodicSync
  };
} 