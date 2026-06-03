-- CreateTable ProjectExport
CREATE TABLE "project_exports" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "project_id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "airtable_table_id" TEXT,
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "error_message" TEXT,
    "success_count" INTEGER NOT NULL DEFAULT 0,
    "failure_count" INTEGER NOT NULL DEFAULT 0,
    "failed_records" JSONB DEFAULT '[]'::jsonb,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "project_exports_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects" ("id") ON DELETE CASCADE
);

-- CreateIndex
CREATE INDEX "project_exports_project_id_idx" ON "project_exports"("project_id");
CREATE INDEX "project_exports_status_idx" ON "project_exports"("status");
CREATE INDEX "project_exports_created_at_idx" ON "project_exports"("created_at" DESC);
