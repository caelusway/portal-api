-- CreateTable
CREATE TABLE "Twitter" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "connected" BOOLEAN NOT NULL DEFAULT false,
    "twitterUsername" TEXT,
    "twitterId" TEXT,
    "introTweetsCount" INTEGER NOT NULL DEFAULT 0,
    "tweetIds" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Twitter_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Twitter_projectId_key" ON "Twitter"("projectId");

-- AddForeignKey
ALTER TABLE "Twitter" ADD CONSTRAINT "Twitter_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
