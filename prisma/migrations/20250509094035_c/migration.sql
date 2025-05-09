-- AlterTable
ALTER TABLE "Twitter" ADD COLUMN     "blogpostDate" TIMESTAMP(3),
ADD COLUMN     "blogpostUrl" TEXT,
ADD COLUMN     "twitterThreadDate" TIMESTAMP(3),
ADD COLUMN     "twitterThreadUrl" TEXT;
