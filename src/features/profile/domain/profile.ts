import { isRegion, type Region } from "@/features/catalog/domain/collection";

// The profile of an explorer (E9-2): first name, the first letter of the family
// name, region and who may see the profile. Pure rules, no framework and no
// database. The database keeps the shape in CHECKs (Migration..._profiles); the
// letters of a name are only checked here.

export const VISIBILITIES = ["private", "public"] as const;

export type Visibility = (typeof VISIBILITIES)[number];

export const FIRST_NAME_MAX_LENGTH = 40;

export type Profile = Readonly<{
  firstName: string | null;
  familyInitial: string | null;
  region: Region | null;
  visibility: Visibility;
}>;

// No row means this (D-E9-2, Q1): a profile that is private, without a name.
export const DEFAULT_PROFILE: Profile = {
  firstName: null,
  familyInitial: null,
  region: null,
  visibility: "private",
};

export type ProfileField = "firstName" | "familyInitial" | "region" | "visibility";

export type ProfileInputResult =
  | Readonly<{ ok: true; value: Profile }>
  // `fields` is empty when the request as a whole is malformed (not an object,
  // or it has a field that does not exist).
  | Readonly<{ ok: false; fields: readonly ProfileField[] }>;

const KNOWN_KEYS: readonly string[] = ["firstName", "familyInitial", "region", "visibility"];

// Letters, with single spaces, hyphens or apostrophes between parts of the name:
// "Anna", "Anna-Maria", "Jan Maria", "O'Brien". No digits, no other symbols.
const NAME_PATTERN = /^\p{L}+(?:[ '’-]\p{L}+)*$/u;
const UPPERCASE_LETTER = /^\p{Lu}$/u;

const codePoints = (text: string): number => [...text].length;

const isVisibility = (value: unknown): value is Visibility =>
  typeof value === "string" && (VISIBILITIES as readonly string[]).includes(value);

// An empty field is a field left blank: undefined, null and a string of spaces
// all mean "not given". Anything else that is not a string is invalid.
function optionalText(value: unknown): string | null | undefined {
  if (value === undefined || value === null) {
    return null;
  }

  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.normalize("NFC").trim();

  return trimmed === "" ? null : trimmed;
}

/**
 * Reads the body of a profile save (JSON or a form) into a profile. A blank
 * first name, initial or region becomes `null`; the visibility must be given.
 * The initial is accepted in lowercase and stored in uppercase; it needs a first
 * name. Nothing that names an owner is read: the owner is the actor.
 */
export function parseProfileInput(raw: unknown): ProfileInputResult {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { ok: false, fields: [] };
  }

  const input = raw as Record<string, unknown>;

  if (Object.keys(input).some((key) => !KNOWN_KEYS.includes(key))) {
    return { ok: false, fields: [] };
  }

  const fields: ProfileField[] = [];

  const firstName = optionalText(input.firstName);

  if (
    firstName === undefined ||
    (firstName !== null &&
      (codePoints(firstName) > FIRST_NAME_MAX_LENGTH || !NAME_PATTERN.test(firstName)))
  ) {
    fields.push("firstName");
  }

  const initialText = optionalText(input.familyInitial);
  const familyInitial =
    typeof initialText === "string" ? initialText.toLocaleUpperCase("pl-PL") : initialText;

  if (
    familyInitial === undefined ||
    (familyInitial !== null && !UPPERCASE_LETTER.test(familyInitial))
  ) {
    fields.push("familyInitial");
  } else if (familyInitial !== null && firstName === null) {
    // An initial has no name to follow; the error is shown at the name.
    fields.push("firstName");
  }

  const regionText = optionalText(input.region);

  if (regionText === undefined || (regionText !== null && !isRegion(regionText))) {
    fields.push("region");
  }

  if (!isVisibility(input.visibility)) {
    fields.push("visibility");
  }

  if (fields.length > 0) {
    return { ok: false, fields };
  }

  return {
    ok: true,
    value: {
      firstName: firstName as string | null,
      familyInitial: familyInitial as string | null,
      region: regionText as Region | null,
      visibility: input.visibility as Visibility,
    },
  };
}
