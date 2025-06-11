/*
  Warnings:

  - You are about to drop the column `metadata` on the `MemberBadge` table. All the data in the column will be lost.

*/
-- DropIndex
DROP INDEX "MemberActivity_activityType_idx";

-- DropIndex
DROP INDEX "MemberActivity_createdAt_idx";

-- DropIndex
DROP INDEX "MemberBadge_badgeType_idx";

-- AlterTable
ALTER TABLE "DiscordMember" ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ALTER COLUMN "rank" SET DEFAULT 0;

-- AlterTable
ALTER TABLE "MemberActivity" ALTER COLUMN "points" SET DEFAULT 0;

-- AlterTable
ALTER TABLE "MemberBadge" DROP COLUMN "metadata";

-- CreateTable
CREATE TABLE "DiscordMessage" (
    "id" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "qualityScore" INTEGER NOT NULL DEFAULT 50,
    "isLowValue" BOOLEAN NOT NULL DEFAULT false,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "discordId" TEXT NOT NULL,
    "memberId" TEXT,

    CONSTRAINT "DiscordMessage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DiscordMessage_messageId_key" ON "DiscordMessage"("messageId");

-- CreateIndex
CREATE INDEX "DiscordMessage_discordId_sentAt_idx" ON "DiscordMessage"("discordId", "sentAt");

-- CreateIndex
CREATE INDEX "DiscordMessage_userId_sentAt_idx" ON "DiscordMessage"("userId", "sentAt");

-- CreateIndex
CREATE INDEX "Discord_serverId_idx" ON "Discord"("serverId");

-- CreateIndex
CREATE INDEX "MemberBadge_memberId_idx" ON "MemberBadge"("memberId");

-- AddForeignKey
ALTER TABLE "DiscordMessage" ADD CONSTRAINT "DiscordMessage_discordId_fkey" FOREIGN KEY ("discordId") REFERENCES "Discord"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DiscordMessage" ADD CONSTRAINT "DiscordMessage_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "DiscordMember"("id") ON DELETE SET NULL ON UPDATE CASCADE;
