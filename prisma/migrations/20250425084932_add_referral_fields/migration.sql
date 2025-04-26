/*
  Warnings:

  - A unique constraint covering the columns `[referralCode]` on the table `Project` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "Project" ADD COLUMN     "referralCode" TEXT,
ADD COLUMN     "referredById" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Project_referralCode_key" ON "Project"("referralCode");

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_referredById_fkey" FOREIGN KEY ("referredById") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;
