-- CreateTable
CREATE TABLE "ScientificProfile" (
    "id" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "profileId" TEXT,
    "hIndex" INTEGER,
    "citations" INTEGER,
    "memberId" TEXT NOT NULL,
    "lastScraped" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ScientificProfile_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "ScientificProfile" ADD CONSTRAINT "ScientificProfile_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "DiscordMember"("id") ON DELETE CASCADE ON UPDATE CASCADE;
