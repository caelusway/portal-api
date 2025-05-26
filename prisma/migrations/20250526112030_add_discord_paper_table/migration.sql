-- CreateTable
CREATE TABLE "DiscordPaper" (
    "id" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "title" TEXT,
    "authors" TEXT,
    "doi" TEXT,
    "platform" TEXT,
    "messageId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "sharedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "discordId" TEXT NOT NULL,

    CONSTRAINT "DiscordPaper_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DiscordPaper_discordId_idx" ON "DiscordPaper"("discordId");

-- CreateIndex
CREATE INDEX "DiscordPaper_messageId_idx" ON "DiscordPaper"("messageId");

-- CreateIndex
CREATE INDEX "DiscordPaper_sharedAt_idx" ON "DiscordPaper"("sharedAt");

-- AddForeignKey
ALTER TABLE "DiscordPaper" ADD CONSTRAINT "DiscordPaper_discordId_fkey" FOREIGN KEY ("discordId") REFERENCES "Discord"("id") ON DELETE CASCADE ON UPDATE CASCADE;
