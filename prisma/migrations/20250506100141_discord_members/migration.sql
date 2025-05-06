-- CreateTable
CREATE TABLE "DiscordMember" (
    "id" TEXT NOT NULL,
    "discordId" TEXT NOT NULL,
    "discordUsername" TEXT NOT NULL,
    "discordAvatar" TEXT,
    "linkedinUrl" TEXT,
    "scientificProfileUrl" TEXT,
    "motivationToJoin" TEXT,
    "isOnboarded" BOOLEAN NOT NULL DEFAULT false,
    "paperContributions" INTEGER NOT NULL DEFAULT 0,
    "messageCount" INTEGER NOT NULL DEFAULT 0,
    "discordServerId" TEXT NOT NULL,
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DiscordMember_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DiscordMember_discordId_key" ON "DiscordMember"("discordId");

-- AddForeignKey
ALTER TABLE "DiscordMember" ADD CONSTRAINT "DiscordMember_discordServerId_fkey" FOREIGN KEY ("discordServerId") REFERENCES "Discord"("serverId") ON DELETE CASCADE ON UPDATE CASCADE;
