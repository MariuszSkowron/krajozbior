import { parseArgs } from "node:util";

import { z } from "zod";

import { auditOperatorSchema, auditReasonSchema } from "@/lib/db/operations-audit";

// Arguments of `npm run auth:create-admin`, validated before anything is
// written: a missing or empty --reason ends the command with a usage error, so
// no account is created and no password changes (D-21 pt 3). The reason and
// the operator label are validated like in `ops:curator`.
export const CREATE_ADMIN_USAGE =
  'Usage: auth:create-admin -- --email <e-mail> --reason "<reason>" [--name <name>] [--operator <label>]';

export type CreateAdminArgs = Readonly<{
  email: string;
  name?: string;
  operator: string;
  reason: string;
}>;

const schema = z.strictObject({
  email: z.email().max(254),
  name: z.string().optional(),
  reason: auditReasonSchema,
  operator: auditOperatorSchema,
});

export type CreateAdminParse =
  Readonly<{ ok: true; args: CreateAdminArgs }> | Readonly<{ ok: false; message: string }>;

export function parseCreateAdminArgs(
  argv: readonly string[],
  defaultOperator?: string,
): CreateAdminParse {
  let values: Record<string, string | undefined>;

  try {
    values = parseArgs({
      args: [...argv],
      options: {
        email: { type: "string" },
        name: { type: "string" },
        reason: { type: "string" },
        operator: { type: "string" },
      },
    }).values;
  } catch {
    return { ok: false, message: CREATE_ADMIN_USAGE };
  }

  const parsed = schema.safeParse({
    ...values,
    email: values.email?.trim().toLowerCase(),
    operator: values.operator ?? defaultOperator,
  });

  if (!parsed.success) {
    // Flag names only: the values may be sensitive.
    const flags = [...new Set(parsed.error.issues.map((issue) => `--${issue.path.join(".")}`))];

    return { ok: false, message: `${CREATE_ADMIN_USAGE}\nInvalid or missing: ${flags.join(", ")}` };
  }

  return {
    ok: true,
    args: {
      email: parsed.data.email,
      ...(parsed.data.name === undefined ? {} : { name: parsed.data.name }),
      operator: parsed.data.operator,
      reason: parsed.data.reason,
    },
  };
}
