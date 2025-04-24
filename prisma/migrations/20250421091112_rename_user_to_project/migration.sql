/*
  Warnings:

  - You are about to drop the column `userId` on the `ChatSession` table. All the data in the column will be lost.
  - You are about to drop the column `userId` on the `Discord` table. All the data in the column will be lost.
  - You are about to drop the column `userId` on the `NFT` table. All the data in the column will be lost.
  - You are about to drop the `User` table. If the table is not empty, all the data it contains will be lost.
  - A unique constraint covering the columns `[projectId]` on the table `Discord` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `projectId` to the `ChatSession` table without a default value. This is not possible if the table is not empty.
  - Added the required column `projectId` to the `Discord` table without a default value. This is not possible if the table is not empty.
  - Added the required column `projectId` to the `NFT` table without a default value. This is not possible if the table is not empty.

*/
-- DropForeignKey
ALTER TABLE "ChatSession" DROP CONSTRAINT "ChatSession_userId_fkey";

-- DropForeignKey
ALTER TABLE "Discord" DROP CONSTRAINT "Discord_userId_fkey";

-- DropForeignKey
ALTER TABLE "NFT" DROP CONSTRAINT "NFT_userId_fkey";

-- DropIndex
DROP INDEX "Discord_userId_key";

-- AlterTable
ALTER TABLE "ChatSession" DROP COLUMN "userId",
ADD COLUMN     "projectId" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "Discord" DROP COLUMN "userId",
ADD COLUMN     "projectId" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "NFT" DROP COLUMN "userId",
ADD COLUMN     "projectId" TEXT NOT NULL;

-- DropTable
DROP TABLE "User";

-- CreateTable
CREATE TABLE "Project" (
    "id" TEXT NOT NULL,
    "wallet" TEXT NOT NULL,
    "privyId" TEXT,
    "level" INTEGER NOT NULL DEFAULT 1,
    "fullName" TEXT,
    "email" TEXT,
    "projectName" TEXT,
    "projectDescription" TEXT,
    "projectVision" TEXT,
    "scientificReferences" TEXT,
    "credentialLinks" TEXT,
    "teamMembers" TEXT,
    "motivation" TEXT,
    "progress" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Project_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Project_wallet_key" ON "Project"("wallet");

-- CreateIndex
CREATE UNIQUE INDEX "Project_privyId_key" ON "Project"("privyId");

-- CreateIndex
CREATE UNIQUE INDEX "Discord_projectId_key" ON "Discord"("projectId");

-- AddForeignKey
ALTER TABLE "NFT" ADD CONSTRAINT "NFT_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Discord" ADD CONSTRAINT "Discord_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatSession" ADD CONSTRAINT "ChatSession_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
