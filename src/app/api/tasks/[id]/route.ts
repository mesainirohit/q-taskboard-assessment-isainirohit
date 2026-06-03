import { NextRequest, NextResponse } from "next/server";
import { airtableTable } from "@/lib/airtable";
import { prisma } from "@/lib/prisma";
import {
  getCurrentUser,
  unauthorized,
  forbidden,
  notFound,
  badRequest,
  getProjectMembership,
  canEditTasks,
} from "@/lib/auth";
import { updateTaskSchema } from "@/schemas/task";

type Params = { params: Promise<{ id: string }> };

const mapStatusToAirtable = (status: string): string => {
  const statusMap: Record<string, string> = {
    "todo": "Todo",
    "in_progress": "In Progress",
    "review": "In Review",
    "done": "Done",
  };
  return statusMap[status.toLowerCase()] || status.toLowerCase();
};

export async function PATCH(req: NextRequest, { params }: Params) {
  const user = await getCurrentUser(req);
  if (!user) return unauthorized();

  const { id } = await params;

  const body = await req.json().catch(() => null);
  const parsed = updateTaskSchema.safeParse(body);
  if (!parsed.success) return badRequest("invalid input", parsed.error.flatten());

  const existing = await prisma.task.findUnique({ where: { id } });
  if (!existing) return notFound("task not found");

  const membership = await getProjectMembership(user.id, existing.projectId);
  if (!membership) return forbidden("you are not a member of this project");
  if (!canEditTasks(membership.role)) {
    return forbidden("viewers cannot delete tasks");
  }


  const task = await prisma.task.update({
    where: { id },
    data: parsed.data,
    include: {
      assignee: { select: { id: true, name: true, email: true } },
    },
  });

  if (existing.airtableId) {
    try {
      await airtableTable.update(existing.airtableId, {
        Name: task.title,
        Description: task.description || "",
        Status: mapStatusToAirtable(task.status),
        Assignee: task.assignee?.name || "",
      });
    } catch (error) {
      console.error("Airtable sync error:", error);
    }
  }

  return NextResponse.json({ task });
}

export async function DELETE(req: NextRequest, { params }: Params) {
  const user = await getCurrentUser(req);
  if (!user) return unauthorized();

  const { id } = await params;

  const existing = await prisma.task.findUnique({ where: { id } });
  if (!existing) return notFound("task not found");

  const membership = await getProjectMembership(user.id, existing.projectId);
  if (!membership) return forbidden("you are not a member of this project");
  if (!canEditTasks(membership.role)) {
    return forbidden("viewers cannot delete tasks");
  }

  await prisma.task.delete({ where: { id } });

  if (existing.airtableId) {
    try {
      await airtableTable.destroy(existing.airtableId);
    } catch (error) {
      console.error("Airtable delete error:", error);
    }
  }

  return NextResponse.json({ ok: true });
}