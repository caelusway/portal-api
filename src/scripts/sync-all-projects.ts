#!/usr/bin/env ts-node

import { PrismaClient } from '@prisma/client';
import { syncProjectToSheets } from '../services/sheets-sync.service';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

const prisma = new PrismaClient();

/**
 * Syncs only newly created projects from database to Google Sheets
 * @param days Number of days to look back for new projects (default: 30)
 */
async function syncNewlyCreatedProjects(days = 30): Promise<void> {
  try {
    console.log(`[SYNC_NEW] Starting sync of projects created in the last ${days} days to Google Sheets`);

    // Calculate the date to look back to
    const lookbackDate = new Date();
    lookbackDate.setDate(lookbackDate.getDate() - days);

    // Get recently created projects from the database
    const newProjects = await prisma.project.findMany({
      where: {
        createdAt: {
          gte: lookbackDate
        }
      },
      orderBy: {
        createdAt: 'desc' // Most recent first
      }
    });

    if (newProjects.length === 0) {
      console.log(`[SYNC_NEW] No projects found created after ${lookbackDate.toISOString()}`);
      return;
    }

    console.log(`[SYNC_NEW] Found ${newProjects.length} projects created in the last ${days} days`);

    // Helper function to add delay
    const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
    
    // Sync each project to Google Sheets with delay between each
    let successCount = 0;
    let errorCount = 0;
    const DELAY_BETWEEN_PROJECTS = 3000; // 3 seconds delay to avoid rate limits

    // Process in smaller batches
    const BATCH_SIZE = 5; // Process 5 projects at a time
    const DELAY_BETWEEN_BATCHES = 10000; // 10 seconds between batches

    // Split into batches
    for (let i = 0; i < newProjects.length; i += BATCH_SIZE) {
      const batch = newProjects.slice(i, i + BATCH_SIZE);
      console.log(`[SYNC_NEW] Processing batch ${Math.floor(i/BATCH_SIZE) + 1} of ${Math.ceil(newProjects.length/BATCH_SIZE)} (${batch.length} projects)`);
      
      for (const project of batch) {
        try {
          console.log(`[SYNC_NEW] Syncing project: ${project.id} (${project.projectName || 'Unnamed Project'}) created on ${project.createdAt}`);
          
          const result = await syncProjectToSheets(project.id);
          
          console.log(`[SYNC_NEW] Successfully synced project ${project.id}: ${result}`);
          successCount++;
          
          // Add delay between projects to avoid rate limits
          if (batch.indexOf(project) < batch.length - 1) {
            console.log(`[SYNC_NEW] Waiting ${DELAY_BETWEEN_PROJECTS/1000} seconds before next project...`);
            await delay(DELAY_BETWEEN_PROJECTS);
          }
        } catch (error) {
          console.error(`[SYNC_NEW] Error syncing project ${project.id}:`, error);
          errorCount++;
          
          // If we hit a rate limit (429), wait longer
          if (error instanceof Error && error.message.includes('429') || 
              typeof error === 'object' && error !== null && String(error).includes('429')) {
            const longerDelay = 20000; // 20 seconds
            console.log(`[SYNC_NEW] Rate limit hit. Waiting ${longerDelay/1000} seconds before continuing...`);
            await delay(longerDelay);
          } else {
            // Still delay on other errors
            await delay(DELAY_BETWEEN_PROJECTS);
          }
        }
      }
      
      // Add delay between batches
      if (i + BATCH_SIZE < newProjects.length) {
        console.log(`[SYNC_NEW] Batch complete. Waiting ${DELAY_BETWEEN_BATCHES/1000} seconds before next batch...`);
        await delay(DELAY_BETWEEN_BATCHES);
      }
    }

    console.log(`[SYNC_NEW] Sync completed. Success: ${successCount}, Errors: ${errorCount}`);
  } catch (error) {
    console.error('[SYNC_NEW] Error in syncNewlyCreatedProjects:', error);
  } finally {
    // Close the Prisma client connection
    await prisma.$disconnect();
  }
}

// Get days from command line argument or default to 30
const days = process.argv[2] ? parseInt(process.argv[2]) : 30;

// Run the sync
syncNewlyCreatedProjects(days)
  .then(() => {
    console.log('[SYNC_NEW] Script completed');
    process.exit(0);
  })
  .catch((error) => {
    console.error('[SYNC_NEW] Script failed with error:', error);
    process.exit(1);
  }); 