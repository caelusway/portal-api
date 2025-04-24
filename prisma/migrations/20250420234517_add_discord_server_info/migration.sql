/*
  Warnings:

  - You are about to alter the column `qualityScore` on the `Discord` table. The data in that column could be lost. The data in that column will be cast from `DoublePrecision` to `Integer`.
  - Made the column `inviteLink` on table `Discord` required. This step will fail if there are existing NULL values in that column.

*/
-- DropIndex
DROP INDEX "Discord_serverId_key";

-- AlterTable
ALTER TABLE "Discord" ADD COLUMN     "serverIcon" TEXT,
ADD COLUMN     "serverName" TEXT,
ALTER COLUMN "qualityScore" SET DEFAULT 0,
ALTER COLUMN "qualityScore" SET DATA TYPE INTEGER,
ALTER COLUMN "inviteLink" SET NOT NULL;
