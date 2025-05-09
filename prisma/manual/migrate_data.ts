import { PrismaClient as NewPrismaClient } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';
import { Pool } from 'pg';

// Load environment variables
dotenv.config();

// Create a backup directory
const BACKUP_DIR = path.join(__dirname, '../../../backup', `migration-backup-${new Date().toISOString().replace(/:/g, '-')}`);
if (!fs.existsSync(BACKUP_DIR)) {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
}

// Initialize PostgreSQL pool for old database (raw queries)
console.log('Initializing database connection to OLD_DATABASE_URL...');
// Check if environment variables are set
if (!process.env.OLD_DATABASE_URL) {
  console.error('Error: OLD_DATABASE_URL environment variable is not set');
  process.exit(1);
}

if (!process.env.DATABASE_URL) {
  console.error('Error: DATABASE_URL environment variable is not set');
  process.exit(1);
}

// Disable SSL certificate validation globally (only do this in controlled environments)
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

// Modify connection string to add sslmode=no-verify if not present
let oldDbConnectionString = process.env.OLD_DATABASE_URL;
if (!oldDbConnectionString.includes('sslmode=')) {
  oldDbConnectionString += oldDbConnectionString.includes('?') 
    ? '&sslmode=no-verify' 
    : '?sslmode=no-verify';
}
console.log('Using connection string (redacted):', 
  oldDbConnectionString.replace(/\/\/.*?@/, '//[REDACTED]@'));

// Declare oldDbPool at module scope
let oldDbPool: Pool;

try {
  oldDbPool = new Pool({
    connectionString: oldDbConnectionString,
    ssl: {
      rejectUnauthorized: false // Disable SSL validation
    }
  });
} catch (error) {
  console.error('Error initializing database connection:', error);
  process.exit(1);
}

// Initialize new Prisma client
const newPrisma = new NewPrismaClient({
  datasources: {
    db: {
      url: process.env.DATABASE_URL
    }
  }
});

// Store mapping between old and new IDs
const projectIdMap = new Map<string, { oldId: string, newId: string, bioUserId: string }>();
// Store BioUser email mapping to prevent duplicates
const bioUserEmailMap = new Map<string, string>(); // email -> bioUserId

async function backupData() {
  console.log('Backing up data...');

  try {
    // Use a raw query for projects to avoid schema mismatch
    const projectsQuery = `
      SELECT * FROM "Project"
    `;
    const projectsResult = await oldDbPool.query(projectsQuery);
    const projects = projectsResult.rows;
    
    fs.writeFileSync(path.join(BACKUP_DIR, 'projects.json'), JSON.stringify(projects, null, 2));
    console.log(`Backed up ${projects.length} projects`);

    // Backup NFTs
    const nftsQuery = `SELECT * FROM "NFT"`;
    const nftsResult = await oldDbPool.query(nftsQuery);
    const nfts = nftsResult.rows;
    fs.writeFileSync(path.join(BACKUP_DIR, 'nfts.json'), JSON.stringify(nfts, null, 2));
    console.log(`Backed up ${nfts.length} NFTs`);

    // Backup Discord records
    const discordQuery = `SELECT * FROM "Discord"`;
    const discordResult = await oldDbPool.query(discordQuery);
    const discordRecords = discordResult.rows;
    fs.writeFileSync(path.join(BACKUP_DIR, 'discord.json'), JSON.stringify(discordRecords, null, 2));
    console.log(`Backed up ${discordRecords.length} Discord records`);

    // Backup Chat Sessions
    const chatSessionsQuery = `SELECT * FROM "ChatSession"`;
    const chatSessionsResult = await oldDbPool.query(chatSessionsQuery);
    const chatSessions = chatSessionsResult.rows;
    fs.writeFileSync(path.join(BACKUP_DIR, 'chatSessions.json'), JSON.stringify(chatSessions, null, 2));
    console.log(`Backed up ${chatSessions.length} chat sessions`);

    // Backup Chat Messages
    const chatMessagesQuery = `SELECT * FROM "ChatMessage"`;
    const chatMessagesResult = await oldDbPool.query(chatMessagesQuery);
    const chatMessages = chatMessagesResult.rows;
    fs.writeFileSync(path.join(BACKUP_DIR, 'chatMessages.json'), JSON.stringify(chatMessages, null, 2));
    console.log(`Backed up ${chatMessages.length} chat messages`);

    return true;
  } catch (error) {
    console.error('Error during backup:', error);
    return false;
  }
}

// Helper function to find or create a BioUser
async function findOrCreateBioUser(project: any) {
  try {
    // First check if this is a valid email
    if (project.email) {
      // Check if we've already created a BioUser with this email
      const existingUserId = bioUserEmailMap.get(project.email);
      if (existingUserId) {
        console.log(`Using existing BioUser ${existingUserId} for email ${project.email}`);
        return { id: existingUserId, isNew: false };
      }
      
      // Check if a BioUser with this email already exists in the database
      const existingBioUser = await newPrisma.bioUser.findUnique({
        where: { email: project.email }
      });
      
      if (existingBioUser) {
        console.log(`Found existing BioUser ${existingBioUser.id} for email ${project.email}`);
        bioUserEmailMap.set(project.email, existingBioUser.id);
        return { id: existingBioUser.id, isNew: false };
      }
    }
    
    // Generate a unique email if none provided or to avoid conflicts
    const finalEmail = project.email || `migrated-${project.id}@example.com`;
    
    // Create a new BioUser
    const bioUser = await newPrisma.bioUser.create({
      data: {
        privyId: project.privyId || `migrated-${project.id}`,
        wallet: project.wallet,
        email: finalEmail,
        fullName: project.fullName,
        referralCode: project.referralCode || undefined,
      }
    });
    
    // Store the email mapping
    if (finalEmail) {
      bioUserEmailMap.set(finalEmail, bioUser.id);
    }
    
    console.log(`Created new BioUser ${bioUser.id} for project ${project.id}`);
    return { id: bioUser.id, isNew: true };
  } catch (error) {
    console.error(`Error finding/creating BioUser for project ${project.id}:`, error);
    
    
    return null;
  }
}

// Migrate projects and related data
async function migrateProjects() {
  console.log('Migrating projects...');
  
  // Get all projects using raw query
  const projectsQuery = `
    SELECT * FROM "Project"
  `;
  const projectsResult = await oldDbPool.query(projectsQuery);
  const projects = projectsResult.rows;

  console.log(`Found ${projects.length} projects to migrate`);
  
  // Create mapping for referral relationships to reconnect later
  projectIdMap.clear(); // Ensure the map is empty
  bioUserEmailMap.clear(); // Clear email map
  
  // First migration pass - create BioUsers and basic Projects
  for (const oldProject of projects) {
    console.log(`Migrating project ${oldProject.id}...`);
    
    try {
      // Find or create the BioUser first
      const bioUserResult = await findOrCreateBioUser(oldProject);
      
      if (!bioUserResult) {
        console.error(`Failed to create BioUser for project ${oldProject.id}, skipping`);
        continue;
      }
      
      // Create the Project
      const newProject = await newPrisma.project.create({
        data: {
          level: oldProject.level || 1,
          projectName: oldProject.projectName || "Unnamed Project",
          projectDescription: oldProject.projectDescription || "",
          projectVision: oldProject.projectVision || "",
          scientificReferences: oldProject.scientificReferences || "",
          credentialLinks: oldProject.credentialLinks || "",
          teamMembers: oldProject.teamMembers || "",
          motivation: oldProject.motivation || "",
          progress: oldProject.progress || "",
          referralCode: oldProject.referralCode || undefined,
          referralSource: oldProject.referralSource || undefined,
          projectLinks: oldProject.projectLinks || "",
          verifiedScientistCount: 0,
          // Create the member link
          members: {
            create: {
              role: "founder",
              bioUserId: bioUserResult.id
            }
          }
        }
      });
      
      // Store the mapping between old and new IDs
      projectIdMap.set(oldProject.id, {
        oldId: oldProject.id,
        newId: newProject.id,
        bioUserId: bioUserResult.id
      });
      
      console.log(`Successfully migrated project ${oldProject.id} to new project ${newProject.id} with BioUser ${bioUserResult.id}`);
    } catch (error) {
      console.error(`Error migrating project ${oldProject.id}:`, error);
    }
  }
  
  // Second pass - reconnect referral relationships
  for (const oldProject of projects) {
    // Skip if project wasn't migrated successfully
    if (!projectIdMap.has(oldProject.id) || !oldProject.referredById) {
      continue;
    }
    
    // Skip if referred project wasn't migrated
    if (!projectIdMap.has(oldProject.referredById)) {
      continue;
    }
    
    try {
      // Get the new project and referral IDs
      const projectMapping = projectIdMap.get(oldProject.id);
      const referralMapping = projectIdMap.get(oldProject.referredById);
      
      // Safety check to make sure both mappings exist
      if (!projectMapping || !referralMapping) {
        console.log(`Skipping referral update for project ${oldProject.id} - mapping not found`);
        continue;
      }
      
      // Update the referral relationship
      await newPrisma.project.update({
        where: { id: projectMapping.newId },
        data: {
          referredById: referralMapping.newId
        }
      });
      
      console.log(`Updated referral relationship for project ${projectMapping.newId} to ${referralMapping.newId}`);
    } catch (error) {
      console.error(`Error updating referral for project ${oldProject.id}:`, error);
    }
  }
  
  // Store the project ID mapping for debugging
  fs.writeFileSync(path.join(BACKUP_DIR, 'projectIdMap.json'), JSON.stringify(Array.from(projectIdMap.entries()), null, 2));
  console.log(`Migrated ${projectIdMap.size} out of ${projects.length} projects`);
  
  return projectIdMap.size > 0;
}

async function migrateNFTs() {
  console.log('Migrating NFTs...');
  
  // Get all NFT records from old database
  const nftsQuery = `SELECT * FROM "NFT"`;
  const nftsResult = await oldDbPool.query(nftsQuery);
  const nfts = nftsResult.rows;
  
  console.log(`Found ${nfts.length} NFTs to migrate`);
  
  let migratedCount = 0;
  
  for (const oldNFT of nfts) {
    try {
      // Skip if the project wasn't successfully migrated
      const projectMapping = projectIdMap.get(oldNFT.projectId);
      if (!projectMapping) {
        console.log(`Skipping NFT ${oldNFT.id} because project ${oldNFT.projectId} was not migrated`);
        continue;
      }
      
      // Create the new NFT with only fields that match the schema
      const newNFT = await newPrisma.nFT.create({
        data: {
          type: oldNFT.type,
          projectId: projectMapping.newId,
          transactionHash: oldNFT.transactionHash || null,
          imageUrl: oldNFT.imageUrl || null,
        }
      });
      
      migratedCount++;
      console.log(`Migrated NFT ${oldNFT.id} for project ${projectMapping.newId}`);
    } catch (error) {
      console.error(`Error migrating NFT ${oldNFT.id}:`, error);
    }
  }
  
  console.log(`Successfully migrated ${migratedCount} out of ${nfts.length} NFTs`);
  return migratedCount > 0;
}

async function migrateDiscord() {
  console.log('Migrating Discord data...');
  
  // Get all Discord records from old database
  const discordQuery = `SELECT * FROM "Discord"`;
  const discordResult = await oldDbPool.query(discordQuery);
  const discordRecords = discordResult.rows;
  
  console.log(`Found ${discordRecords.length} Discord records to migrate`);
  
  let migratedCount = 0;
  
  for (const oldDiscord of discordRecords) {
    try {
      // Skip if the project wasn't successfully migrated
      const projectMapping = projectIdMap.get(oldDiscord.projectId);
      if (!projectMapping) {
        console.log(`Skipping Discord record for project ${oldDiscord.projectId} - project not migrated`);
        continue;
      }
      
      // Create the new Discord record with fields that match the schema
      const newDiscord = await newPrisma.discord.create({
        data: {
          serverId: oldDiscord.serverId || "",
          inviteLink: oldDiscord.inviteLink || "",
          memberCount: oldDiscord.memberCount || 0,
          papersShared: oldDiscord.papersShared || 0,
          messagesCount: oldDiscord.messagesCount || 0,
          qualityScore: oldDiscord.qualityScore || 0,
          botAdded: oldDiscord.botAdded || false,
          botAddedAt: oldDiscord.botAddedAt || null,
          verificationToken: oldDiscord.verificationToken || null,
          verified: oldDiscord.verified || false,
          serverIcon: oldDiscord.serverIcon || null,
          serverName: oldDiscord.serverName || "",
          projectId: projectMapping.newId,
        }
      });
      
      migratedCount++;
      console.log(`Migrated Discord record for project ${projectMapping.newId}`);
    } catch (error) {
      console.error(`Error migrating Discord record for project ${oldDiscord.projectId}:`, error);
    }
  }
  
  console.log(`Successfully migrated ${migratedCount} out of ${discordRecords.length} Discord records`);
  return migratedCount > 0;
}

async function migrateChatData() {
  console.log('Migrating chat sessions and messages...');
  
  // Get all chat sessions from old database
  const sessionsQuery = `SELECT * FROM "ChatSession"`;
  const sessionsResult = await oldDbPool.query(sessionsQuery);
  const sessions = sessionsResult.rows;
  
  console.log(`Found ${sessions.length} chat sessions to migrate`);
  
  // Create a mapping for chat session IDs
  const sessionIdMap = new Map<string, string>();
  let migratedSessionCount = 0;
  let migratedMessageCount = 0;
  
  for (const oldSession of sessions) {
    try {
      // Skip if the project wasn't successfully migrated
      const projectMapping = projectIdMap.get(oldSession.projectId);
      if (!projectMapping) {
        console.log(`Skipping chat session for project ${oldSession.projectId} - project not migrated`);
        continue;
      }
      
      // Create the new chat session with fields that match the schema
      const newSession = await newPrisma.chatSession.create({
        data: {
          projectId: projectMapping.newId,
        }
      });
      
      // Store session ID mapping
      sessionIdMap.set(oldSession.id, newSession.id);
      migratedSessionCount++;
      
      // Get chat messages for this session
      const messagesQuery = `SELECT * FROM "ChatMessage" WHERE "sessionId" = $1 ORDER BY "timestamp" ASC`;
      const messagesResult = await oldDbPool.query(messagesQuery, [oldSession.id]);
      const messages = messagesResult.rows;
      
      console.log(`Found ${messages.length} chat messages for session ${oldSession.id}`);
      
      // Get BioUser ID for non-agent messages
      const bioUserId = projectMapping.bioUserId;
      
      // Migrate each message
      for (const oldMessage of messages) {
        try {
          await newPrisma.chatMessage.create({
            data: {
              sessionId: newSession.id,
              content: oldMessage.content || "",
              isFromAgent: oldMessage.isFromAgent || false,
              actionTaken: oldMessage.actionTaken || null,
              actionSuccess: oldMessage.actionSuccess,
              // Only set bioUserId for user messages, not for agent messages
              bioUserId: oldMessage.isFromAgent ? null : bioUserId,
            }
          });
          
          migratedMessageCount++;
        } catch (error) {
          console.error(`Error migrating message for session ${oldSession.id}:`, error);
        }
      }
      
      console.log(`Migrated chat session ${oldSession.id} for project ${projectMapping.newId} with ${messages.length} messages`);
    } catch (error) {
      console.error(`Error migrating chat session for project ${oldSession.projectId}:`, error);
    }
  }
  
  console.log(`Successfully migrated ${migratedSessionCount} out of ${sessions.length} chat sessions`);
  console.log(`Successfully migrated ${migratedMessageCount} chat messages`);
  
  return migratedSessionCount > 0;
}

async function createTwitterRecords() {
  console.log('Creating Twitter records...');
  
  // Create Twitter records for each project that was migrated
  let createdCount = 0;
  
  for (const [oldProjectId, mapping] of projectIdMap.entries()) {
    try {
      const newTwitterRecord = await newPrisma.twitter.create({
        data: {
          projectId: mapping.newId,
          connected: false,
          introTweetsCount: 0,
        }
      });
      
      createdCount++;
      console.log(`Created Twitter record for project ${mapping.newId}`);
    } catch (error) {
      console.error(`Error creating Twitter record for project ${mapping.newId}:`, error);
    }
  }
  
  console.log(`Created ${createdCount} Twitter records`);
  return createdCount > 0;
}

async function migrate() {
  console.log('Starting migration...');
  
  try {
    // Step 1: Back up all data
    const backupSuccess = await backupData();
    if (!backupSuccess) {
      console.error('Failed to back up data, aborting migration');
      return;
    }
    
    // Step 2: Migrate projects first (creates BioUsers and Projects)
    const projectsMigrated = await migrateProjects();
    if (!projectsMigrated) {
      console.error('Failed to migrate any projects, aborting further steps');
      return;
    }
    
    // Step 3: Migrate NFTs
    await migrateNFTs();
    
    // Step 4: Migrate Discord data
    await migrateDiscord();
    
    // Step 5: Migrate Chat Sessions and Messages
    await migrateChatData();
    
    // Step 6: Create Twitter records (which don't exist in old schema)
    await createTwitterRecords();
    
    console.log('Migration completed successfully');
  } catch (error) {
    console.error('Error during migration:', error);
  } finally {
    // Close database connections
    await newPrisma.$disconnect();
    await oldDbPool.end();
  }
}

export { migrate };

// Automatically run if script is executed directly
if (require.main === module) {
  migrate().catch(console.error).finally(async () => {
    await newPrisma.$disconnect();
    await oldDbPool.end();
  });
} 