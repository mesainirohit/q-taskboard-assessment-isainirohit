import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  getCurrentUser,
  unauthorized,
  forbidden,
  notFound,
  badRequest,
  getProjectMembership,
  canPostComments,
} from "@/lib/auth";
import { createCommentSchema } from "@/schemas/comment";

type Params = { params: Promise<{ taskId: string }> };

export async function GET(req: NextRequest, { params }: Params) {
  const user = await getCurrentUser(req);
  if (!user) return unauthorized();

  const { taskId } = await params;

  // Fetch task to get projectId
  const task = await prisma.task.findUnique({
    where: { id: taskId },
    select: { projectId: true },
  });

  if (!task) return notFound("task not found");

  // Check membership
  const membership = await getProjectMembership(user.id, task.projectId);
  if (!membership) return forbidden("you are not a member of this project");

  // Fetch comments with author info, ordered chronologically
  const comments = await prisma.comment.findMany({
    where: { taskId },
    include: {
      author: { select: { id: true, email: true, name: true } },
    },
    orderBy: { createdAt: "asc" },
  });

  return NextResponse.json({ comments });
}

export async function POST(req: NextRequest, { params }: Params) {
  const user = await getCurrentUser(req);
  if (!user) return unauthorized();

  const { taskId } = await params;

  // Fetch task to get projectId
  const task = await prisma.task.findUnique({
    where: { id: taskId },
    select: { projectId: true },
  });

  if (!task) return notFound("task not found");

  // Check membership
  const membership = await getProjectMembership(user.id, task.projectId);
  if (!membership) return forbidden("you are not a member of this project");

  // Check if user can post comments (admin or member, not viewer)
  if (!canPostComments(membership.role)) {
    return forbidden("viewers cannot post comments");
  }

  // Validate input
  const body = await req.json().catch(() => null);
  const parsed = createCommentSchema.safeParse(body);
  if (!parsed.success) return badRequest("invalid input", parsed.error.flatten());

  // Create comment
  const comment = await prisma.comment.create({
    data: {
      taskId,
      authorId: user.id,
      body: parsed.data.body,
    },
    include: {
      author: { select: { id: true, email: true, name: true } },
    },
  });

  return NextResponse.json({ comment }, { status: 201 });
}
