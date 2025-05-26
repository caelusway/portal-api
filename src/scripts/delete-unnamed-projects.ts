/**
 * Delete Unnamed Projects Script
 * 
 * This script deletes all projects from the database where projectName is "Unnamed Project".
 * It handles related records by deleting them first to avoid foreign key constraint errors.
 * 
 * Usage:
 * npm run delete-unnamed-projects
 * 
 * To run with confirmation bypass:
 * npm run delete-unnamed-projects -- --force
 */

import dotenv from 'dotenv';
import prisma from '../services/db.service';
import { createInterface } from 'readline';

// Load environment variables
dotenv.config();

// Create readline interface for user input
const readline = createInterface({
  input: process.stdin,
  output: process.stdout
});

/**
 * Promisified readline question function
 */
function question(query: string): Promise<string> {
  return new Promise((resolve) => {
    readline.question(query, (answer) => {
      resolve(answer);
    });
  });
}

async function main() {
  console.log('🗑️ Delete Unnamed Projects Script');
  console.log('------------------------------------');
  
  // Parse command line arguments for --force flag
  const forceFlag = process.argv.includes('--force');
  
  try {
    // Count the number of unnamed projects
    const count = await prisma.project.count({
      where: {
        projectName: 'Project Name'
      }
    });
    
    if (count === 0) {
      console.log('✅ No unnamed projects found. Nothing to delete.');
      return;
    }
    
    // First get basic project info
    const basicProjects = await prisma.project.findMany({
      where: {
        projectName: 'Project Name'
      },
      select: {
        id: true,
        projectName: true,
        createdAt: true,
        updatedAt: true,
        level: true
      }
    });
    
    // Then get detailed information about related records
    const projectDetails = await Promise.all(
      basicProjects.map(async (project) => {
        const counts = await prisma.project.findUnique({
          where: { id: project.id },
          include: {
            _count: {
              select: {
                NFTs: true,
                ChatSessions: true,
                dkgFiles: true,
                invites: true,
                members: true
              }
            },
            Discord: true,
            Twitter: true
          }
        });
        
        return {
          ...project,
          counts: counts?._count || {
            NFTs: 0,
            ChatSessions: 0,
            dkgFiles: 0,
            invites: 0,
            members: 0
          },
          hasDiscord: counts?.Discord !== null,
          hasTwitter: counts?.Twitter !== null
        };
      })
    );
    
    console.log(`🔍 Found ${count} unnamed project(s):`);
    
    // Display project details in a table-like format with relation counts
    projectDetails.forEach((project, index) => {
      console.log(`${index + 1}. ID: ${project.id}`);
      console.log(`   Created: ${project.createdAt.toLocaleString()}`);
      console.log(`   Updated: ${project.updatedAt.toLocaleString()}`);
      console.log(`   Level: ${project.level}`);
      console.log(`   Related records:`);
      console.log(`     - NFTs: ${project.counts.NFTs}`);
      console.log(`     - ChatSessions: ${project.counts.ChatSessions}`);
      console.log(`     - DKG Files: ${project.counts.dkgFiles}`);
      console.log(`     - Discord: ${project.hasDiscord ? 'Yes' : 'No'}`);
      console.log(`     - Twitter: ${project.hasTwitter ? 'Yes' : 'No'}`);
      console.log(`     - Invites: ${project.counts.invites}`);
      console.log(`     - Members: ${project.counts.members}`);
      console.log(`-------------------`);
    });
    
    // Ask for confirmation unless --force flag is used
    if (!forceFlag) {
      const confirmation = await question(`⚠️ Are you sure you want to delete ${count} unnamed project(s) and ALL their related records? This action cannot be undone. (yes/no): `);
      
      if (confirmation.toLowerCase() !== 'yes') {
        console.log('❌ Operation canceled by user.');
        readline.close();
        return;
      }
    }
    
    // Get project IDs
    const projectIds = projectDetails.map(project => project.id);
    
    console.log('🗑️ Deleting projects and related records...');
    
    // Delete each project and its related records within a transaction
    let deletedCount = 0;
    let errorCount = 0;
    
    for (const projectId of projectIds) {
      try {
        console.log(`⏳ Processing project ID: ${projectId}`);
        
        await prisma.$transaction(async (tx) => {
          // Delete related records manually to avoid foreign key constraint errors
          
          // 1. Delete NFTs first (these have the constraint we saw in the error)
          const deletedNFTs = await tx.nFT.deleteMany({
            where: { projectId }
          });
          console.log(`  ✓ Deleted ${deletedNFTs.count} NFTs`);
          
          // 2. Delete chat messages through chat sessions
          const chatSessions = await tx.chatSession.findMany({
            where: { projectId },
            select: { id: true }
          });
          
          const sessionIds = chatSessions.map(session => session.id);
          
          if (sessionIds.length > 0) {
            const deletedMessages = await tx.chatMessage.deleteMany({
              where: { sessionId: { in: sessionIds } }
            });
            console.log(`  ✓ Deleted ${deletedMessages.count} chat messages`);
          }
          
          // 3. Delete chat sessions
          const deletedSessions = await tx.chatSession.deleteMany({
            where: { projectId }
          });
          console.log(`  ✓ Deleted ${deletedSessions.count} chat sessions`);
          
          // 4. Delete DKG files
          const deletedDKGFiles = await tx.dKGFile.deleteMany({
            where: { projectId }
          });
          console.log(`  ✓ Deleted ${deletedDKGFiles.count} DKG files`);
          
          // 5. Delete Discord records
          const deletedDiscord = await tx.discord.deleteMany({
            where: { projectId }
          });
          console.log(`  ✓ Deleted ${deletedDiscord.count} Discord records`);
          
          // 6. Delete Twitter records
          const deletedTwitter = await tx.twitter.deleteMany({
            where: { projectId }
          });
          console.log(`  ✓ Deleted ${deletedTwitter.count} Twitter records`);
          
          // 7. Delete project invites
          const deletedInvites = await tx.projectInvite.deleteMany({
            where: { projectId }
          });
          console.log(`  ✓ Deleted ${deletedInvites.count} project invites`);
          
          // 8. Delete project members
          const deletedMembers = await tx.projectMember.deleteMany({
            where: { projectId }
          });
          console.log(`  ✓ Deleted ${deletedMembers.count} project members`);
          
          // 9. Finally delete the project itself
          const deletedProject = await tx.project.delete({
            where: { id: projectId }
          });
          console.log(`  ✓ Deleted project: ${deletedProject.projectName || 'Unnamed Project'}`);
        });
        
        deletedCount++;
        console.log(`✅ Successfully deleted project ID: ${projectId} and all related records`);
      } catch (error) {
        errorCount++;
        console.error(`❌ Error deleting project ID: ${projectId}`, error);
      }
    }
    
    console.log(`\n📊 Summary: Deleted ${deletedCount} projects successfully (${errorCount} failures)`);
    
  } catch (error) {
    console.error('❌ Error deleting unnamed projects:', error);
    process.exit(1);
  } finally {
    // Close readline interface
    readline.close();
    
    // Close Prisma client
    await prisma.$disconnect();
  }
}

// Execute the script
main().catch(error => {
  console.error('❌ Unhandled error:', error);
  process.exit(1);
}); 