/*
  Warnings:

  - You are about to drop the column `description` on the `Project` table. All the data in the column will be lost.
  - You are about to drop the column `name` on the `Project` table. All the data in the column will be lost.
  - You are about to drop the column `vision` on the `Project` table. All the data in the column will be lost.
  - A unique constraint covering the columns `[discordId]` on the table `BioUser` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[twitterId]` on the table `BioUser` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[privyId]` on the table `Project` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[referralCode]` on the table `Project` will be added. If there are existing duplicate values, this will fail.

*/
-- DropForeignKey
ALTER TABLE "ChatSession" DROP CONSTRAINT "ChatSession_projectId_fkey";

-- DropForeignKey
ALTER TABLE "Discord" DROP CONSTRAINT "Discord_projectId_fkey";

-- DropForeignKey
ALTER TABLE "NFT" DROP CONSTRAINT "NFT_projectId_fkey";

-- DropIndex
DROP INDEX "Discord_verificationToken_key";

-- AlterTable
ALTER TABLE "BioUser" ADD COLUMN     "discordAccessToken" TEXT,
ADD COLUMN     "discordAvatar" TEXT,
ADD COLUMN     "discordConnectedAt" TIMESTAMP(3),
ADD COLUMN     "discordId" TEXT,
ADD COLUMN     "discordRefreshToken" TEXT,
ADD COLUMN     "discordUsername" TEXT,
ADD COLUMN     "twitterAccessToken" TEXT,
ADD COLUMN     "twitterAvatar" TEXT,
ADD COLUMN     "twitterConnectedAt" TIMESTAMP(3),
ADD COLUMN     "twitterId" TEXT,
ADD COLUMN     "twitterName" TEXT,
ADD COLUMN     "twitterRefreshToken" TEXT,
ADD COLUMN     "twitterUsername" TEXT;

-- AlterTable
ALTER TABLE "Discord" ALTER COLUMN "qualityScore" SET DEFAULT 0;

-- AlterTable
ALTER TABLE "Project" DROP COLUMN "description",
DROP COLUMN "name",
DROP COLUMN "vision",
ADD COLUMN     "privyId" TEXT,
ADD COLUMN     "projectDescription" TEXT,
ADD COLUMN     "projectName" TEXT,
ADD COLUMN     "projectVision" TEXT,
ADD COLUMN     "referralCode" TEXT,
ADD COLUMN     "referredById" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "BioUser_discordId_key" ON "BioUser"("discordId");

-- CreateIndex
CREATE UNIQUE INDEX "BioUser_twitterId_key" ON "BioUser"("twitterId");

-- CreateIndex
CREATE UNIQUE INDEX "Project_privyId_key" ON "Project"("privyId");

-- CreateIndex
CREATE UNIQUE INDEX "Project_referralCode_key" ON "Project"("referralCode");

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_referredById_fkey" FOREIGN KEY ("referredById") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NFT" ADD CONSTRAINT "NFT_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Discord" ADD CONSTRAINT "Discord_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatSession" ADD CONSTRAINT "ChatSession_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
