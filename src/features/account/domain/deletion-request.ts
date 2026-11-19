import { z } from "zod";

// The body of POST /api/me/account/deletion: the confirmation word and nothing
// else. The request never names an account (the actor comes from the session),
// so any other field is refused rather than ignored.
const deletionRequestSchema = z.strictObject({ confirmation: z.string().max(100) });

export type DeletionRequest = Readonly<{ confirmation: string }>;

export function parseDeletionRequest(body: unknown): DeletionRequest | null {
  const parsed = deletionRequestSchema.safeParse(body);

  return parsed.success ? { confirmation: parsed.data.confirmation } : null;
}
