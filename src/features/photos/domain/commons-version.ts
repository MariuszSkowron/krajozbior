import { z } from "zod";

import { normalizeCommonsLicense } from "@/features/catalog/domain/commons-license";

import { commonsFileName } from "./commons-url";

// Kontrola wersji pliku z Commons tuż przed pobraniem miniatury (E4-2a, poprawka przypięcia
// wersji). Każdy może wgrać na Commons nową wersję pod tą samą nazwą, a miniatura zawsze pochodzi
// z wersji bieżącej. Dlatego pytamy API o bieżącą wersję i pobieramy tylko wtedy, gdy nie jest
// nowsza niż `retrieved_at` wiersza, plik się nie przeniósł, a licencja i szerokość są te same.
// Przy każdej wątpliwości zdjęcia nie pobieramy.

export const COMMONS_API_HOST = "commons.wikimedia.org";
export const COMMONS_API_PATH = "/w/api.php";

/** Kody powodów odrzucenia (trafiają do podsumowania przebiegu, bez nazw plików i adresów). */
export type VersionRejection = "file_changed" | "file_gone" | "license_changed";

/** Dane bieżącej wersji pliku z odpowiedzi API. */
export type CommonsVersionInfo = Readonly<{
  /** Chwila wgrania bieżącej wersji (ms od epoki). */
  timestamp: number;
  width: number;
  licenseShort: string;
  licenseUrl: string | null;
  /** Nazwa pliku z adresu oryginału (rozpoznanie przekierowania nazwy). */
  fileName: string;
}>;

/** `api_error` to zwykła nieudana próba (liczy się do trzech); reszta kończy wiersz od razu. */
export type CommonsVersionLookup =
  | Readonly<{ ok: true; info: CommonsVersionInfo }>
  | Readonly<{ ok: false; reason: "file_gone" | "api_error" }>;

export type VersionVerdict =
  Readonly<{ ok: true }> | Readonly<{ ok: false; reason: VersionRejection | "api_error" }>;

/** Adres zapytania o bieżącą wersję pliku; host i ścieżka są stałe, nazwa to zakodowany parametr. */
export function buildCommonsApiUrl(commonsFile: string): string | null {
  const name = commonsFileName(commonsFile).replace(/_/g, " ");

  if (name === "" || name.includes("/") || name.includes("|")) {
    return null;
  }

  const params = new URLSearchParams({
    action: "query",
    format: "json",
    formatversion: "2",
    prop: "imageinfo",
    iiprop: "timestamp|url|size|mime|extmetadata",
    iiextmetadatafilter: "LicenseShortName|LicenseUrl",
    titles: `File:${name}`,
  });

  return `https://${COMMONS_API_HOST}${COMMONS_API_PATH}?${params.toString()}`;
}

const metadataValue = z.object({ value: z.union([z.string(), z.number()]).optional() });

const responseSchema = z.object({
  query: z.object({
    pages: z
      .array(
        z.object({
          missing: z.boolean().optional(),
          invalid: z.boolean().optional(),
          imageinfo: z
            .array(
              z.object({
                timestamp: z.string(),
                url: z.string(),
                width: z.number().int(),
                extmetadata: z
                  .object({
                    LicenseShortName: metadataValue.optional(),
                    LicenseUrl: metadataValue.optional(),
                  })
                  .optional(),
              }),
            )
            .optional(),
        }),
      )
      .length(1),
  }),
});

function fileNameFromUrl(address: string): string | null {
  try {
    const last = new URL(address).pathname.split("/").pop();

    return last === undefined || last === "" ? null : decodeURIComponent(last);
  } catch {
    return null;
  }
}

/**
 * Odpowiedź API → bieżąca wersja. Brak strony, strona bez `imageinfo` albo więcej niż jedna wersja
 * to `file_gone`; odpowiedź w innym kształcie to `api_error` (próba do powtórzenia).
 */
export function parseCommonsVersionResponse(json: unknown): CommonsVersionLookup {
  const parsed = responseSchema.safeParse(json);

  if (!parsed.success) {
    return { ok: false, reason: "api_error" };
  }

  const page = parsed.data.query.pages[0]!;

  if (page.missing === true || page.invalid === true || page.imageinfo?.length !== 1) {
    return { ok: false, reason: "file_gone" };
  }

  const version = page.imageinfo[0]!;
  const timestamp = Date.parse(version.timestamp);
  const fileName = fileNameFromUrl(version.url);

  if (Number.isNaN(timestamp) || fileName === null) {
    return { ok: false, reason: "file_gone" };
  }

  const license = version.extmetadata?.LicenseUrl?.value;

  return {
    ok: true,
    info: {
      timestamp,
      width: version.width,
      licenseShort: String(version.extmetadata?.LicenseShortName?.value ?? ""),
      licenseUrl: license === undefined ? null : String(license),
      fileName,
    },
  };
}

export type VersionExpectation = Readonly<{
  commonsFile: string;
  sourceWidth: number | null;
  licenseCode: string;
  /** Dzień przebiegu doboru (`retrieved_at`); `null` = nie wiemy, więc blokujemy. */
  retrievedAt: Date | null;
  /** Bieżąca chwila (ms); domyślnie `Date.now()`. `retrieved_at` z przyszłości jest odrzucane. */
  now?: number;
}>;

/** Decyzja: pobierać (`ok`) albo odrzucić z powodem. Kolejność powodów jest stała. */
export function decideVersion(
  lookup: CommonsVersionLookup,
  expected: VersionExpectation,
): VersionVerdict {
  if (!lookup.ok) {
    return { ok: false, reason: lookup.reason };
  }

  const { info } = lookup;

  // Przekierowanie nazwy: API zwraca dane pliku docelowego, a nazwa w adresie oryginału jest inna.
  if (info.fileName !== commonsFileName(expected.commonsFile)) {
    return { ok: false, reason: "file_gone" };
  }

  // Dzień doboru z przyszłości (błędne `--as-of`) otwierałby okno podmiany bez ograniczeń.
  if (
    expected.retrievedAt === null ||
    expected.retrievedAt.getTime() > (expected.now ?? Date.now()) ||
    info.timestamp > expected.retrievedAt.getTime()
  ) {
    return { ok: false, reason: "file_changed" };
  }

  if (expected.sourceWidth === null || info.width !== expected.sourceWidth) {
    return { ok: false, reason: "file_changed" };
  }

  const license = normalizeCommonsLicense(info.licenseShort, info.licenseUrl);

  if (!license.ok || license.license.code !== expected.licenseCode) {
    return { ok: false, reason: "license_changed" };
  }

  return { ok: true };
}
