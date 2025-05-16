#!/usr/bin/env ts-node
/**
 * Migration script to add sessionType to existing chat sessions
 * 
 * Run with:
 * npx ts-node prisma/migrations/add-session-type.ts
 */

import { PrismaClient } from '@prisma/client';
import { SESSION_TYPES } from '../../src/coaching-agent/coachingChatService';

// Progress display function
function showProgress(current: number, total: number, label: string): void {
  const percentage = Math.round((current / total) * 100);
  process.stdout.write(`\r${label}: ${current}/${total} (${percentage}%) complete`);
  if (current === total) {
    process.stdout.write('\n');
  }
}

async function migrate() {
  console.log('Starting migration to add sessionType to existing chat sessions...');
  
  const prisma = new PrismaClient();
  
  try {
    // Count total sessions
    const totalSessions = await prisma.chatSession.count();
    console.log(`Found ${totalSessions} total chat sessions to update`);
    
    if (totalSessions === 0) {
      console.log('No sessions to update. Migration completed.');
      await prisma.$disconnect();
      return;
    }
    
    // Get all sessions without sessionType
    const sessions = await prisma.chatSession.findMany({
      where: {
        sessionType: SESSION_TYPES.CORE_AGENT
      },
      select: {
        id: true
      }
    });
    
    console.log(`Found ${sessions.length} sessions without sessionType`);
    
    // Update sessions in batches to avoid timeouts/memory issues
    const BATCH_SIZE = 100;
    const batchCount = Math.ceil(sessions.length / BATCH_SIZE);
    
    for (let i = 0; i < batchCount; i++) {
      const start = i * BATCH_SIZE;
      const end = Math.min(start + BATCH_SIZE, sessions.length);
      const batch = sessions.slice(start, end);
      
      console.log(`Processing batch ${i + 1}/${batchCount} (${batch.length} sessions)...`);
      
      // Update each session in the batch
      for (let j = 0; j < batch.length; j++) {
        const session = batch[j];
        
        await prisma.chatSession.update({
          where: { id: session.id },
          data: { sessionType: SESSION_TYPES.CORE_AGENT }
        });
        
        showProgress(j + 1, batch.length, `Batch ${i + 1}`);
      }
      
      console.log(`Completed batch ${i + 1}/${batchCount}`);
    }
    
    console.log('Migration completed successfully');
    console.log(`Updated ${sessions.length} sessions with sessionType = '${SESSION_TYPES.CORE_AGENT}'`);
    
  } catch (error) {
    console.error('Migration failed:', error);
  } finally {
    await prisma.$disconnect();
  }
}

// Run the migration
migrate()
  .then(() => {
    console.log('Migration script finished');
    process.exit(0);
  })
  .catch((error) => {
    console.error('Migration script failed:', error);
    process.exit(1);
  });
