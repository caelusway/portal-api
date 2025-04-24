-- AlterTable
ALTER TABLE "Discord" ADD COLUMN     "botAdded" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "botAddedAt" TIMESTAMP(3);
