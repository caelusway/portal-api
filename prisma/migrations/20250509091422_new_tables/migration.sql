-- AlterTable
ALTER TABLE "Project" ADD COLUMN     "verifiedScientistCount" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "Twitter" ADD COLUMN     "twitterSpaceDate" TIMESTAMP(3),
ADD COLUMN     "twitterSpaceUrl" TEXT;
