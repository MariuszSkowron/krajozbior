import { z } from "zod";

import { normalizeLineBreaks } from "@/features/catalog/domain/collection";
import {
  ORGANIZATION_NAME_PATTERN,
  ORGANIZATION_KINDS,
  type OrganizationKind,
} from "@/features/organizations/domain/organization";

// The form "Zostań kuratorem" (spec "Rola kuratora", 5.1 and 5.5). The limits are frozen in the
// CHECKs of the migration `curator_applications`; the text is normalized (line breaks, trimming)
// before its length is counted, and a control character (Unicode Cc) is refused, like in the CHECK.

export const ORGANIZATION_NAME_MAX = 120;
export const APPLICANT_ROLE_MAX = 120;
export const CONTACT_MIN = 3;
export const CONTACT_MAX = 120;
export const WEBSITE_URL_MAX = 200;

export const CURATOR_APPLICATION_FIELDS = [
  "organizationName",
  "organizationKind",
  "applicantRole",
  "contact",
  "websiteUrl",
] as const;

export type CuratorApplicationField = (typeof CURATOR_APPLICATION_FIELDS)[number];

export type CuratorApplicationInput = Readonly<{
  organizationName: string;
  organizationKind: OrganizationKind;
  applicantRole: string;
  contact: string;
  websiteUrl: string | null;
}>;

export type CuratorApplicationValidation =
  | Readonly<{ ok: true; value: CuratorApplicationInput }>
  | Readonly<{ ok: false; fields: readonly CuratorApplicationField[] }>;

// Control (Cc) and invisible formatting (Cf: zero-width, right-to-left override, tags) characters.
const CONTROL_CHARACTER = /[\p{Cc}\p{Cf}]/u;

const line = (min: number, max: number) =>
  z
    .string()
    .transform((value) => normalizeLineBreaks(value).normalize("NFC").trim())
    .pipe(
      z
        .string()
        .min(min)
        .max(max)
        .refine((value) => !CONTROL_CHARACTER.test(value)),
    );

const organizationName = line(1, ORGANIZATION_NAME_MAX).refine((value) =>
  ORGANIZATION_NAME_PATTERN.test(value),
);

function isHttpsAddress(value: string): boolean {
  if (!value.startsWith("https://") || /\s/.test(value)) {
    return false;
  }

  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

// An empty field means "no address"; anything else must be a https address.
const websiteUrl = z.preprocess(
  (value) =>
    value === undefined || value === null || (typeof value === "string" && value.trim() === "")
      ? undefined
      : value,
  line(1, WEBSITE_URL_MAX).refine(isHttpsAddress).optional(),
);

const formSchema = z.object({
  organizationName,
  organizationKind: z.enum(ORGANIZATION_KINDS),
  applicantRole: line(1, APPLICANT_ROLE_MAX),
  contact: line(CONTACT_MIN, CONTACT_MAX),
  websiteUrl,
});

const isField = (value: unknown): value is CuratorApplicationField =>
  (CURATOR_APPLICATION_FIELDS as readonly unknown[]).includes(value);

/** Validates the whole form and names every wrong field (none for an input that is no object). */
export function validateCuratorApplicationInput(input: unknown): CuratorApplicationValidation {
  const parsed = formSchema.safeParse(input);

  if (parsed.success) {
    const { websiteUrl: address, ...rest } = parsed.data;

    return { ok: true, value: { ...rest, websiteUrl: address ?? null } };
  }

  const fields = new Set<CuratorApplicationField>();

  for (const issue of parsed.error.issues) {
    const field = issue.path[0];

    if (isField(field)) {
      fields.add(field);
    }
  }

  return {
    ok: false,
    fields: CURATOR_APPLICATION_FIELDS.filter((field) => fields.has(field)),
  };
}
