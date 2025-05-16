-- AlterTable
ALTER TABLE "ChatSession" ADD COLUMN     "sessionType" TEXT DEFAULT 'coreagent';

-- CreateTable
CREATE TABLE "DKGFile" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "hash" TEXT NOT NULL,
    "filename" TEXT,
    "projectId" TEXT NOT NULL,

    CONSTRAINT "DKGFile_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DKGFile_projectId_idx" ON "DKGFile"("projectId");

-- CreateIndex
CREATE INDEX "Project_privyId_idx" ON "Project"("privyId");

-- CreateIndex
CREATE INDEX "Project_referralCode_idx" ON "Project"("referralCode");

-- AddForeignKey
ALTER TABLE "DKGFile" ADD CONSTRAINT "DKGFile_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
