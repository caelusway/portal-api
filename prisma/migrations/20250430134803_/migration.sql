/*
  Warnings:

  - You are about to drop the column `startedAt` on the `ChatSession` table. All the data in the column will be lost.
  - You are about to drop the column `email` on the `Project` table. All the data in the column will be lost.
  - You are about to drop the column `fullName` on the `Project` table. All the data in the column will be lost.
  - You are about to drop the column `privyId` on the `Project` table. All the data in the column will be lost.
  - You are about to drop the column `projectDescription` on the `Project` table. All the data in the column will be lost.
  - You are about to drop the column `projectName` on the `Project` table. All the data in the column will be lost.
  - You are about to drop the column `projectVision` on the `Project` table. All the data in the column will be lost.
  - You are about to drop the column `referralCode` on the `Project` table. All the data in the column will be lost.
  - You are about to drop the column `referredById` on the `Project` table. All the data in the column will be lost.
  - You are about to drop the column `teamMembers` on the `Project` table. All the data in the column will be lost.
  - You are about to drop the column `wallet` on the `Project` table. All the data in the column will be lost.
  - A unique constraint covering the columns `[serverId]` on the table `Discord` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[verificationToken]` on the table `Discord` will be added. If there are existing duplicate values, this will fail.

*/
-- DropForeignKey
ALTER TABLE "ChatMessage" DROP CONSTRAINT "ChatMessage_sessionId_fkey";

-- DropForeignKey
ALTER TABLE "ChatSession" DROP CONSTRAINT "ChatSession_projectId_fkey";

-- DropForeignKey
ALTER TABLE "Discord" DROP CONSTRAINT "Discord_projectId_fkey";

-- DropForeignKey
ALTER TABLE "NFT" DROP CONSTRAINT "NFT_projectId_fkey";

-- DropForeignKey
ALTER TABLE "Project" DROP CONSTRAINT "Project_referredById_fkey";

-- DropIndex
DROP INDEX "Project_privyId_key";

-- DropIndex
DROP INDEX "Project_referralCode_key";

-- DropIndex
DROP INDEX "Project_wallet_key";

-- AlterTable
ALTER TABLE "ChatMessage" ADD COLUMN     "bioUserId" TEXT,
ALTER COLUMN "isFromAgent" DROP DEFAULT;

-- AlterTable
ALTER TABLE "ChatSession" DROP COLUMN "startedAt",
ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "Discord" ALTER COLUMN "memberCount" DROP NOT NULL,
ALTER COLUMN "memberCount" DROP DEFAULT,
ALTER COLUMN "qualityScore" SET DEFAULT 50,
ALTER COLUMN "inviteLink" DROP NOT NULL;

-- AlterTable
ALTER TABLE "Project" DROP COLUMN "email",
DROP COLUMN "fullName",
DROP COLUMN "privyId",
DROP COLUMN "projectDescription",
DROP COLUMN "projectName",
DROP COLUMN "projectVision",
DROP COLUMN "referralCode",
DROP COLUMN "referredById",
DROP COLUMN "teamMembers",
DROP COLUMN "wallet",
ADD COLUMN     "description" TEXT,
ADD COLUMN     "name" TEXT,
ADD COLUMN     "teamDescription" TEXT,
ADD COLUMN     "vision" TEXT;

-- CreateTable
CREATE TABLE "BioUser" (
    "id" TEXT NOT NULL,
    "privyId" TEXT NOT NULL,
    "wallet" TEXT,
    "email" TEXT,
    "fullName" TEXT,
    "avatarUrl" TEXT,
    "referralCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "referredById" TEXT,

    CONSTRAINT "BioUser_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectMember" (
    "id" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "bioUserId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,

    CONSTRAINT "ProjectMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectInvite" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "inviterUserId" TEXT NOT NULL,
    "inviteeEmail" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProjectInvite_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BioUser_privyId_key" ON "BioUser"("privyId");

-- CreateIndex
CREATE UNIQUE INDEX "BioUser_wallet_key" ON "BioUser"("wallet");

-- CreateIndex
CREATE UNIQUE INDEX "BioUser_email_key" ON "BioUser"("email");

-- CreateIndex
CREATE UNIQUE INDEX "BioUser_referralCode_key" ON "BioUser"("referralCode");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectMember_bioUserId_projectId_key" ON "ProjectMember"("bioUserId", "projectId");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectInvite_token_key" ON "ProjectInvite"("token");

-- CreateIndex
CREATE UNIQUE INDEX "Discord_serverId_key" ON "Discord"("serverId");

-- CreateIndex
CREATE UNIQUE INDEX "Discord_verificationToken_key" ON "Discord"("verificationToken");

-- AddForeignKey
ALTER TABLE "BioUser" ADD CONSTRAINT "BioUser_referredById_fkey" FOREIGN KEY ("referredById") REFERENCES "BioUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectMember" ADD CONSTRAINT "ProjectMember_bioUserId_fkey" FOREIGN KEY ("bioUserId") REFERENCES "BioUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectMember" ADD CONSTRAINT "ProjectMember_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectInvite" ADD CONSTRAINT "ProjectInvite_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectInvite" ADD CONSTRAINT "ProjectInvite_inviterUserId_fkey" FOREIGN KEY ("inviterUserId") REFERENCES "BioUser"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NFT" ADD CONSTRAINT "NFT_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Discord" ADD CONSTRAINT "Discord_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatSession" ADD CONSTRAINT "ChatSession_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatMessage" ADD CONSTRAINT "ChatMessage_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "ChatSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatMessage" ADD CONSTRAINT "ChatMessage_bioUserId_fkey" FOREIGN KEY ("bioUserId") REFERENCES "BioUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;
