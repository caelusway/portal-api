#!/usr/bin/env ts-node

/**
 * Script to send sandbox notifications for a specific project or projects that reached level 4 in the last day
 * 
 * This script:
 * 1. If project ID is provided: Sends sandbox notification for that specific project
 * 2. If no project ID: Finds all projects that reached level 4 in the last 24 hours
 * 3. Sends sandbox notification emails to the Bio team members
 * 4. Logs the results for monitoring
 * 
 * Usage:
 * # For a specific project
 * npx ts-node src/scripts/send-sandbox-notifications.ts <project-id>
 * 
 * # For all recent level 4 projects
 * npx ts-node src/scripts/send-sandbox-notifications.ts
 * 
 * # Or using npm script (if configured in package.json)
 * npm run script:sandbox-notifications <project-id>
 */

import { PrismaClient } from '@prisma/client';
import * as dotenv from 'dotenv';
import * as path from 'path';

// Load environment variables
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const prisma = new PrismaClient();

interface ProjectWithDetails {
  id: string;
  level: number;
  projectName?: string | null;
  projectDescription?: string | null;
  updatedAt: Date;
  createdAt: Date;
  Discord?: {
    memberCount?: number | null;
    papersShared: number;
    messagesCount: number;
    serverName?: string | null;
  } | null;
  members: Array<{
    bioUser: {
      email?: string | null;
      fullName?: string | null;
    };
  }>;
}

/**
 * Send sandbox notification email to Bio team members
 */
async function sendSandboxNotification(project: ProjectWithDetails, recipientEmail: string): Promise<boolean> {
  try {
    const EmailService = require('../services/email.service');
    await EmailService.sendSandboxEmail(project, recipientEmail);
    console.log(`✅ Sandbox notification sent to ${recipientEmail} for project ${project.id}`);
    return true;
  } catch (error) {
    console.error(`❌ Failed to send sandbox notification to ${recipientEmail} for project ${project.id}:`, error);
    return false;
  }
}

/**
 * Get a specific project by ID
 */
async function getProjectById(projectId: string): Promise<ProjectWithDetails | null> {
  try {
    const project = await prisma.project.findUnique({
      where: {
        id: projectId
      },
      include: {
        Discord: true,
        members: {
          include: {
            bioUser: {
              select: {
                email: true,
                fullName: true
              }
            }
          }
        }
      }
    });

    if (!project) {
      console.error(`❌ Project with ID ${projectId} not found`);
      return null;
    }

    console.log(`📊 Found project: ${project.projectName || 'Unnamed Project'} (Level ${project.level})`);
    return project;
  } catch (error) {
    console.error(`❌ Error fetching project ${projectId}:`, error);
    throw error;
  }
}

/**
 * Get projects that reached level 4 in the last 24 hours
 */
async function getRecentLevel4Projects(): Promise<ProjectWithDetails[]> {
  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
  
  try {
    const projects = await prisma.project.findMany({
      where: {
        level: 4,
        updatedAt: {
          gte: oneDayAgo
        }
      },
      include: {
        Discord: true,
        members: {
          include: {
            bioUser: {
              select: {
                email: true,
                fullName: true
              }
            }
          }
        }
      },
      orderBy: {
        updatedAt: 'desc'
      }
    });

    console.log(`📊 Found ${projects.length} projects that reached level 4 in the last 24 hours`);
    return projects;
  } catch (error) {
    console.error('❌ Error fetching recent level 4 projects:', error);
    throw error;
  }
}

/**
 * Parse sandbox notification emails from environment variable
 */
function getSandboxNotificationEmails(): string[] {
  const sandboxEmails = process.env.SANDBOX_NOTIFICATION_EMAIL;
  
  if (!sandboxEmails) {
    console.warn('⚠️  SANDBOX_NOTIFICATION_EMAIL environment variable not set');
    return [];
  }
  
  const emailList = sandboxEmails
    .split(',')
    .map(email => email.trim())
    .filter(email => email && email.includes('@'));
  
  if (emailList.length === 0) {
    console.warn('⚠️  No valid emails found in SANDBOX_NOTIFICATION_EMAIL environment variable');
    return [];
  }
  
  console.log(`📧 Found ${emailList.length} notification emails: ${emailList.join(', ')}`);
  return emailList;
}

/**
 * Format project information for logging
 */
function formatProjectInfo(project: ProjectWithDetails): string {
  const projectName = project.projectName || 'Unnamed Project';
  const memberCount = project.Discord?.memberCount || 0;
  const papersShared = project.Discord?.papersShared || 0;
  const messagesCount = project.Discord?.messagesCount || 0;
  const userEmail = project.members[0]?.bioUser?.email || 'No email';
  
  return `
    📋 Project: ${projectName} (ID: ${project.id})
    👤 User: ${userEmail}
    📈 Stats: ${memberCount} members, ${papersShared} papers, ${messagesCount} messages
    🏆 Level: ${project.level}
    🕒 Last Updated: ${project.updatedAt.toISOString()}
  `.trim();
}

/**
 * Send notifications for a list of projects
 */
async function sendNotificationsForProjects(projects: ProjectWithDetails[], notificationEmails: string[]): Promise<{ totalSent: number; totalFailed: number }> {
  let totalSent = 0;
  let totalFailed = 0;
  
  for (const project of projects) {
    console.log(`\n📤 Sending notifications for project: ${project.projectName || project.id}`);
    
    for (const email of notificationEmails) {
      const success = await sendSandboxNotification(project, email);
      if (success) {
        totalSent++;
      } else {
        totalFailed++;
      }
      
      // Add a small delay between emails to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }
  
  return { totalSent, totalFailed };
}

/**
 * Main execution function
 */
async function main(): Promise<void> {
  // Parse command line arguments
  const args = process.argv.slice(2);
  const projectId = args[0];
  
  if (projectId) {
    console.log(`🚀 Starting sandbox notification script for specific project: ${projectId}`);
  } else {
    console.log('🚀 Starting sandbox notification script for recent level 4 projects...');
    console.log(`📅 Checking for projects that reached level 4 since: ${new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()}`);
  }
  
  try {
    // Get notification email list
    const notificationEmails = getSandboxNotificationEmails();
    if (notificationEmails.length === 0) {
      console.log('❌ No notification emails configured. Exiting.');
      return;
    }
    
    let projects: ProjectWithDetails[] = [];
    
    if (projectId) {
      // Get specific project
      const project = await getProjectById(projectId);
      if (!project) {
        console.log('❌ Project not found. Exiting.');
        return;
      }
      projects = [project];
      
      // Validate that the project is eligible for sandbox notifications
      if (project.level < 4) {
        console.log(`⚠️  Project is at level ${project.level}, not level 4. Sandbox notifications are typically sent for level 4+ projects.`);
        console.log('📤 Proceeding anyway as requested...');
      }
    } else {
      // Get recent level 4 projects
      projects = await getRecentLevel4Projects();
      
      if (projects.length === 0) {
        console.log('✅ No projects reached level 4 in the last 24 hours. Nothing to do.');
        return;
      }
    }
    
    console.log(`\n📋 Project${projects.length > 1 ? 's' : ''} to process:`);
    projects.forEach((project, index) => {
      console.log(`\n${index + 1}. ${formatProjectInfo(project)}`);
    });
    
    // Send notifications for all projects
    const { totalSent, totalFailed } = await sendNotificationsForProjects(projects, notificationEmails);
    
    // Summary
    console.log('\n📊 Summary:');
    console.log(`✅ Total notifications sent: ${totalSent}`);
    console.log(`❌ Total failures: ${totalFailed}`);
    console.log(`📋 Projects processed: ${projects.length}`);
    console.log(`📧 Team members notified: ${notificationEmails.length}`);
    
    if (totalFailed > 0) {
      console.log('\n⚠️  Some notifications failed. Check the logs above for details.');
      process.exit(1);
    } else {
      console.log('\n🎉 All notifications sent successfully!');
    }
    
  } catch (error) {
    console.error('💥 Script execution failed:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

/**
 * Handle script execution
 */
if (require.main === module) {
  main().catch((error) => {
    console.error('💥 Unhandled error:', error);
    process.exit(1);
  });
}

export { main as sendSandboxNotifications }; 