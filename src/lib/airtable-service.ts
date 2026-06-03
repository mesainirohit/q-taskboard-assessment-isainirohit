/**
 * Airtable Service for exporting tasks
 * 
 * Handles:
 * - Connecting to Airtable API
 * - Transforming tasks to records
 * - Batch creating records with partial failure handling
 * - Retrying transient failures
 */

import Airtable from "airtable";
import {
  retryWithBackoff,
  getAirtableErrorMessage,
  isTransientError,
  AirtableRecord,
  formatDateForAirtable,
} from "./airtable-errors";

interface AirtableTask {
  id: string;
  title: string;
  status: string;
  description?: string;
  assignee?: { name?: string };
  createdBy?: { name?: string };
  createdAt: Date;
  updatedAt: Date;
  position: number;
}

interface ExportResult {
  success: boolean;
  successCount: number;
  failureCount: number;
  failedRecords: Array<{
    taskId: string;
    title: string;
    error: string;
    transient: boolean;
  }>;
  airtableTableId?: string;
  totalRecords: number;
}

/**
 * Initialize Airtable client
 */
function initAirtable(): Airtable {
  const apiKey = process.env.AIRTABLE_API_KEY;
  if (!apiKey) {
    throw new Error("AIRTABLE_API_KEY environment variable is not set");
  }

  return new Airtable({ apiKey });
}

/**
 * Transform task to Airtable record
 */
function transformTaskToRecord(task: AirtableTask): AirtableRecord {
  return {
    fields: {
      Title: task.title,
      Status: task.status.toUpperCase(),
      Description: task.description || "",
      Assignee: task.assignee?.name || "",
      "Created By": task.createdBy?.name || "",
      "Created At": formatDateForAirtable(task.createdAt),
      "Updated At": formatDateForAirtable(task.updatedAt),
      Position: task.position,
      "Taskboard ID": task.id,
    },
  };
}

/**
 * Export tasks to Airtable
 * 
 * Handles:
 * - Partial failures (doesn't fail entire export if one record fails)
 * - Retry of transient failures
 * - Tracking of permanent failures
 */
export async function exportTasksToAirtable(
  tasks: AirtableTask[],
  baseId: string,
  tableName: string
): Promise<ExportResult> {
  const airtable = initAirtable();
  const base = airtable.base(baseId);
  const table = base(tableName);

  const failedRecords: ExportResult["failedRecords"] = [];
  let successCount = 0;
  let airtableTableId: string | undefined;

  // Transform tasks to records
  const records = tasks.map((task) => transformTaskToRecord(task));

  // Batch create records (Airtable allows up to 10 at a time)
  const batchSize = 10;
  for (let i = 0; i < records.length; i += batchSize) {
    const batch = records.slice(i, i + batchSize);
    const correspondingTasks = tasks.slice(i, i + batchSize);

    // Create batch with per-record error handling
    for (let j = 0; j < batch.length; j++) {
      const record = batch[j];
      const task = correspondingTasks[j];

      try {
        // Retry transient failures
        const createdRecord = await retryWithBackoff(async () => {
          const created = await table.create([record]);
          return created[0];
        });

        // Store first record ID as table reference
        if (!airtableTableId) {
          airtableTableId = createdRecord.id;
        }

        successCount++;
      } catch (error) {
        const errorMessage = getAirtableErrorMessage(error);
        const transient = isTransientError(error);

        failedRecords.push({
          taskId: task.id,
          title: task.title,
          error: errorMessage,
          transient,
        });
      }
    }
  }

  return {
    success: failedRecords.length === 0,
    successCount,
    failureCount: failedRecords.length,
    failedRecords,
    airtableTableId,
    totalRecords: records.length,
  };
}

/**
 * Check if Airtable credentials are valid
 */
export async function validateAirtableConnection(baseId: string): Promise<boolean> {
  try {
    const airtable = initAirtable();
    const base = airtable.base(baseId);

    // Try to list tables (non-destructive API call)
    await retryWithBackoff(async () => {
      await base.table("Tasks").select({ maxRecords: 1 }).firstPage();
    });

    return true;
  } catch (error) {
    console.error("Airtable connection validation failed:", error);
    return false;
  }
}
