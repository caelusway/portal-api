-- CreateTable
CREATE TABLE "sheets_sync_queue" (
    "id" SERIAL NOT NULL,
    "record_id" TEXT NOT NULL,
    "record_type" TEXT NOT NULL,
    "operation" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "processed_at" TIMESTAMPTZ(6),
    "status" TEXT,

    CONSTRAINT "sheets_sync_queue_pkey" PRIMARY KEY ("id")
); 