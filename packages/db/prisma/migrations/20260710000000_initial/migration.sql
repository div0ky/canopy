CREATE TYPE "OrderStatus" AS ENUM ('draft', 'submitted', 'paid', 'cancelled');
CREATE TYPE "OutboxStatus" AS ENUM ('pending', 'processing', 'published', 'dead');

CREATE TABLE "users" (
  "id" UUID NOT NULL,
  "email" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "password_hash" TEXT NOT NULL,
  "session_version" INTEGER NOT NULL DEFAULT 1,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "orders" (
  "id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "number" TEXT NOT NULL,
  "status" "OrderStatus" NOT NULL DEFAULT 'draft',
  "total_cents" INTEGER NOT NULL,
  "notes" TEXT,
  "version" INTEGER NOT NULL DEFAULT 1,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  "deleted_at" TIMESTAMP(3),
  CONSTRAINT "orders_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "order_attachments" (
  "id" UUID NOT NULL,
  "order_id" UUID NOT NULL,
  "disk" TEXT NOT NULL,
  "path" TEXT NOT NULL,
  "mime_type" TEXT NOT NULL,
  "size" INTEGER NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "order_attachments_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "domain_event_journal" (
  "id" UUID NOT NULL,
  "aggregate_type" TEXT NOT NULL,
  "aggregate_id" UUID NOT NULL,
  "aggregate_version" INTEGER NOT NULL,
  "event_type" TEXT NOT NULL,
  "event_version" INTEGER NOT NULL,
  "payload" JSONB NOT NULL,
  "metadata" JSONB NOT NULL,
  "occurred_at" TIMESTAMP(3) NOT NULL,
  "recorded_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "domain_event_journal_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "framework_outbox" (
  "id" UUID NOT NULL,
  "topic" TEXT NOT NULL,
  "event_type" TEXT NOT NULL,
  "event_version" INTEGER NOT NULL,
  "payload" JSONB NOT NULL,
  "metadata" JSONB NOT NULL,
  "status" "OutboxStatus" NOT NULL DEFAULT 'pending',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "available_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "locked_at" TIMESTAMP(3),
  "locked_by" TEXT,
  "lease_expires_at" TIMESTAMP(3),
  "published_at" TIMESTAMP(3),
  "last_error" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "framework_outbox_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "framework_failed_jobs" (
  "id" UUID NOT NULL,
  "queue" TEXT NOT NULL,
  "job_name" TEXT NOT NULL,
  "job_id" TEXT NOT NULL,
  "payload" JSONB NOT NULL,
  "error" TEXT NOT NULL,
  "failed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "retried_at" TIMESTAMP(3),
  CONSTRAINT "framework_failed_jobs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "notifications" (
  "id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "type" TEXT NOT NULL,
  "data" JSONB NOT NULL,
  "read_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "users_email_key" ON "users"("email");
CREATE UNIQUE INDEX "orders_number_key" ON "orders"("number");
CREATE INDEX "orders_user_id_created_at_id_idx" ON "orders"("user_id", "created_at", "id");
CREATE INDEX "orders_status_updated_at_idx" ON "orders"("status", "updated_at");
CREATE INDEX "order_attachments_order_id_idx" ON "order_attachments"("order_id");
CREATE UNIQUE INDEX "journal_aggregate_version_event_key" ON "domain_event_journal"("aggregate_type", "aggregate_id", "aggregate_version", "event_type");
CREATE INDEX "journal_event_type_recorded_at_idx" ON "domain_event_journal"("event_type", "recorded_at");
CREATE INDEX "outbox_status_available_at_idx" ON "framework_outbox"("status", "available_at");
CREATE INDEX "outbox_lease_expires_at_idx" ON "framework_outbox"("lease_expires_at");
CREATE UNIQUE INDEX "failed_jobs_queue_job_id_key" ON "framework_failed_jobs"("queue", "job_id");
CREATE INDEX "notifications_user_id_created_at_idx" ON "notifications"("user_id", "created_at");

ALTER TABLE "orders" ADD CONSTRAINT "orders_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "order_attachments" ADD CONSTRAINT "order_attachments_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

