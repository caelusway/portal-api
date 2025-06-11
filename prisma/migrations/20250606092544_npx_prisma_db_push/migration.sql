-- AlterTable
ALTER TABLE "DiscordMember" ADD COLUMN     "lastActivityDate" TIMESTAMP(3),
ADD COLUMN     "lastMonthlyReset" TIMESTAMP(3),
ADD COLUMN     "lastWeeklyReset" TIMESTAMP(3),
ADD COLUMN     "messagePoints" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "monthlyPoints" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "paperPoints" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "qualityMultiplier" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
ADD COLUMN     "rank" INTEGER,
ADD COLUMN     "streak" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "totalPoints" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "weeklyPoints" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "MemberActivity" (
    "id" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "activityType" TEXT NOT NULL,
    "points" INTEGER NOT NULL,
    "description" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MemberActivity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MemberBadge" (
    "id" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "badgeType" TEXT NOT NULL,
    "earnedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "metadata" JSONB,

    CONSTRAINT "MemberBadge_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MemberActivity_memberId_createdAt_idx" ON "MemberActivity"("memberId", "createdAt");

-- CreateIndex
CREATE INDEX "MemberActivity_activityType_idx" ON "MemberActivity"("activityType");

-- CreateIndex
CREATE INDEX "MemberActivity_createdAt_idx" ON "MemberActivity"("createdAt");

-- CreateIndex
CREATE INDEX "MemberBadge_badgeType_idx" ON "MemberBadge"("badgeType");

-- CreateIndex
CREATE UNIQUE INDEX "MemberBadge_memberId_badgeType_key" ON "MemberBadge"("memberId", "badgeType");

-- CreateIndex
CREATE INDEX "DiscordMember_discordServerId_totalPoints_idx" ON "DiscordMember"("discordServerId", "totalPoints");

-- CreateIndex
CREATE INDEX "DiscordMember_discordServerId_weeklyPoints_idx" ON "DiscordMember"("discordServerId", "weeklyPoints");

-- CreateIndex
CREATE INDEX "DiscordMember_discordServerId_monthlyPoints_idx" ON "DiscordMember"("discordServerId", "monthlyPoints");

-- AddForeignKey
ALTER TABLE "MemberActivity" ADD CONSTRAINT "MemberActivity_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "DiscordMember"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MemberBadge" ADD CONSTRAINT "MemberBadge_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "DiscordMember"("id") ON DELETE CASCADE ON UPDATE CASCADE;
