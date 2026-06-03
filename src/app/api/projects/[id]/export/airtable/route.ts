/**
 * POST /api/projects/[projectId]/export/airtable
 * 
 * Export all tasks from a project to Airtable
 * 
 * Authorization: admin or member role required
 * Method: POST
 * 
 * Success: 200 { export, stats }
 * Errors: 401 (unauthorized), 403 (forbidden/not member), 404 (project not found), 500 (server error)
 */

import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { exportTasksToAirtable } from "@/lib/airtable-service";
import { getProjectMembership } from "@/lib/auth";

interface Params {
  params: Promise<{ projectId: string }>;
}

function unauthorized() {
  return NextResponse.json({ error: "unauthorized" }, { status: 401 });
}

function forbidden(message: string) {
  return NextResponse.json({ error: "forbidden", details: message }, { status: 403 });
}

function notFound(message: string) {
  return NextResponse.json({ error: "not_found", details: message }, { status: 404 });
}

function serverError(message: string) {
  return NextResponse.json(
    { error: "internal_server_error", details: message },
    { status: 500 }
  );
}

export async function POST(req: NextRequest, { params }: Params) {
  try {
    // 1. AUTHENTICATION: Check user is logged in
    const user = await getCurrentUser(req);
    if (!user) {
      return unauthorized();
    }

    // 2. GET PROJECT: Validate project exists
    const { projectId } = await params;
    const project = await prisma.project.findUnique({
      where: { id: projectId },
      include: {
        tasks: {
          include: {
            assignee: { select: { id: true, name: true, email: true } },
            createdBy: { select: { id: true, name: true, email: true } },
          },
        },
      },
    });

    if (!project) {
      return notFound("project not found");
    }

    // 3. AUTHORIZATION: Check user is admin or member
    const membership = await getProjectMembership(user.id, projectId);
    if (!membership) {
      return forbidden("you are not a member of this project");
    }

    if (membership.role !== "admin" && membership.role !== "member") {
      return forbidden("only admins and members can export tasks");
    }

    // 4. GET ENVIRONMENT: Verify Airtable config
    const airtableBaseId = process.env.AIRTABLE_BASE_ID;
    const airtableApiKey = process.env.AIRTABLE_API_KEY;

    if (!airtableBaseId || !airtableApiKey) {
      return serverError("Airtable configuration is missing");
    }

    // 5. CREATE EXPORT RECORD: Track export in database
    const exportRecord = await (prisma as any).projectExport.create({
      data: {
        projectId,
        status: "in_progress",
        startedAt: new Date(),
      },
    });

    try {
      // 6. EXPORT TO AIRTABLE: Call Airtable service
      const result = await exportTasksToAirtable(
        project.tasks.map((task) => ({
          id: task.id,
          title: task.title,
          status: task.status,
          description: task.description || undefined,
          assignee: task.assignee ? { name: task.assignee.name } : undefined,
          createdBy: task.createdBy ? { name: task.createdBy.name } : undefined,
          createdAt: task.createdAt,
          updatedAt: task.updatedAt,
          position: task.position,
        })),
        airtableBaseId,
        "Tasks"
      );

      // 7. UPDATE EXPORT RECORD: Store results
      const updatedExport = await (prisma as any).projectExport.update({
        where: { id: exportRecord.id },
        data: {
          status: result.failureCount === 0 ? "completed" : "completed",
          completedAt: new Date(),
          successCount: result.successCount,
          failureCount: result.failureCount,
          airtableTableId: result.airtableTableId,
          failedRecords:
            result.failedRecords.length > 0
              ? JSON.stringify(result.failedRecords)
              : undefined,
          errorMessage: result.failureCount > 0 ? `${result.failureCount} records failed to export` : undefined,
        },
      });

      // 8. RETURN RESPONSE: Report results
      return NextResponse.json(
        {
          export: updatedExport,
          stats: {
            total: result.totalRecords,
            successful: result.successCount,
            failed: result.failureCount,
            successRate: `${((result.successCount / result.totalRecords) * 100).toFixed(1)}%`,
            failedRecords: result.failedRecords,
          },
        },
        { status: 200 }
      );
    } catch (error) {
      // UPDATE EXPORT RECORD: Mark as failed
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error during export";

      await (prisma as any).projectExport.update({
        where: { id: exportRecord.id },
        data: {
          status: "failed",
          completedAt: new Date(),
          errorMessage,
        },
      });

      return serverError(`Export failed: ${errorMessage}`);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return serverError(`Unexpected error: ${message}`);
  }
}
