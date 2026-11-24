import { z } from "zod";

import { slugBase } from "@/features/catalog/domain/collection-slug";
import { isUuid } from "@/features/catalog/domain/uuid";
import { auditReasonSchema } from "@/lib/db/operations-audit";
import {
  isOrganizationSlug,
  normalizeOrganizationName,
} from "@/features/organizations/domain/organization";

// The decision of the administrator (spec "Rola kuratora", 5.1 point 2 and 5.3): approve into a
// new organization or into an existing approved one, or reject with a reason the applicant reads.

export const REJECTION_REASON_MAX = 400;

const CONTROL_CHARACTER = /\p{Cc}/u;

// The reason of a rejection is shown to the applicant and is not written to the audit, so an
// address is allowed (N5 of the review); control characters are refused, like in the CHECK.
const rejectionReason = z
  .string()
  .transform((value) => value.trim())
  .pipe(
    z
      .string()
      .min(1)
      .max(REJECTION_REASON_MAX)
      .refine((value) => !CONTROL_CHARACTER.test(value)),
  );

/** The reason of taking the role goes to the audit: no e-mail address, no control characters. */
export const revocationReasonSchema = auditReasonSchema;

export type DecisionInput =
  | Readonly<{
      decision: "approve";
      target:
        | Readonly<{ kind: "new"; name: string; slug: string }>
        | Readonly<{ kind: "existing"; organizationId: string }>;
    }>
  | Readonly<{ decision: "reject"; reason: string }>;

export type DecisionValidation =
  Readonly<{ ok: true; value: DecisionInput }> | Readonly<{ ok: false }>;

const decisionSchema = z.discriminatedUnion("decision", [
  z.object({
    decision: z.literal("reject"),
    reason: rejectionReason,
  }),
  z.object({
    decision: z.literal("approve"),
    organizationId: z.string().refine(isUuid).optional(),
    organizationName: z.string().optional(),
    organizationSlug: z.string().optional(),
  }),
]);

/**
 * Reads the body of the decision route. `approve` names either `organizationId` (an existing
 * organization) or `organizationName` with `organizationSlug` (a new one), never both.
 */
export function validateDecisionInput(input: unknown): DecisionValidation {
  const parsed = decisionSchema.safeParse(input);

  if (!parsed.success) {
    return { ok: false };
  }

  const data = parsed.data;

  if (data.decision === "reject") {
    return { ok: true, value: { decision: "reject", reason: data.reason } };
  }

  const isExisting = data.organizationId !== undefined;
  const isNew = data.organizationName !== undefined || data.organizationSlug !== undefined;

  if (isExisting === isNew) {
    return { ok: false };
  }
  if (data.organizationId !== undefined) {
    return {
      ok: true,
      value: {
        decision: "approve",
        target: { kind: "existing", organizationId: data.organizationId },
      },
    };
  }

  const name = normalizeOrganizationName(data.organizationName);

  if (name === null || CONTROL_CHARACTER.test(name) || !isOrganizationSlug(data.organizationSlug)) {
    return { ok: false };
  }

  return {
    ok: true,
    value: { decision: "approve", target: { kind: "new", name, slug: data.organizationSlug } },
  };
}

/** The address proposed for a new organization: the name in ASCII, without a random suffix. */
export function suggestOrganizationSlug(organizationName: string): string {
  return slugBase(organizationName);
}

/** Name of an approved organization that looks like the proposed one (case, spaces, marks). */
export function findSimilarOrganizationName(
  organizationName: string,
  approvedNames: readonly string[],
): string | null {
  const key = slugBase(organizationName);

  return approvedNames.find((candidate) => slugBase(candidate) === key) ?? null;
}
