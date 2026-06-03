import { z } from "zod";

export const createCommentSchema = z.object({
  body: z.string().min(1, "comment cannot be empty").max(5000, "comment must be less than 5000 characters"),
});

export type CreateCommentInput = z.infer<typeof createCommentSchema>;
