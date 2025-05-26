#!/usr/bin/env ts-node

import { PrismaClient } from '@prisma/client';
import { syncProjectToSheets } from '../services/sheets-sync.service';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

const prisma = new PrismaClient();

/**
 * One-time function to check and sync new projects to Google Sheets
 */
async function oneTimeSyncNewProjects(): Promise<void> {
  try {
    console.log('[ONE_TIME_SYNC] Checking for new projects to sync to Google Sheets');

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
      }
    });

    if (newProjects.length === 0) {
      console.log('[ONE_TIME_SYNC] No new projects found that need syncing');
      return;
    }

    console.log(`[ONE_TIME_SYNC] Found ${newProjects.length} new projects to sync`);

    // Sync each project to Google Sheets
    let successCount = 0;
    let errorCount = 0;

    for (const project of newProjects) {
      try {
        console.log(`[ONE_TIME_SYNC] Syncing project: ${project.id} (${project.projectName || 'Unnamed Project'})`);
        
        const result = await syncProjectToSheets(project.id);
        
        console.log(`[ONE_TIME_SYNC] Successfully synced project ${project.id}: ${result}`);
        successCount++;
      } catch (error) {
        console.error(`[ONE_TIME_SYNC] Error syncing project ${project.id}:`, error);
        errorCount++;
      }
    }

    console.log(`[ONE_TIME_SYNC] Sync completed. Success: ${successCount}, Errors: ${errorCount}`);
  } catch (error) {
    console.error('[ONE_TIME_SYNC] Error in oneTimeSyncNewProjects:', error);
  } finally {
    // Close the Prisma client connection
    await prisma.$disconnect();
  }
}

// Run the one-time sync
oneTimeSyncNewProjects()
  .then(() => {
    console.log('[ONE_TIME_SYNC] Script completed');
    process.exit(0);
  })
  .catch((error) => {
    console.error('[ONE_TIME_SYNC] Script failed with error:', error);
    process.exit(1);
  }); 