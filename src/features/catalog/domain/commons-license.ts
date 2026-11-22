// Licencja zdjęcia z Wikimedia Commons (E4-2a, spec 5.11.4): z pary `license_short` i adresu
// z pliku kolekcji powstaje kod licencji, dokładna nazwa do podpisu i adres kanoniczny.
// Do bazy trafia zawsze adres złożony z kodu i kraju, nigdy tekst z pliku.

export type CommonsLicenseCode =
  | "cc0-1.0"
  | "public-domain"
  | "cc-by-2.0"
  | "cc-by-2.5"
  | "cc-by-3.0"
  | "cc-by-4.0"
  | "cc-by-sa-2.0"
  | "cc-by-sa-2.5"
  | "cc-by-sa-3.0"
  | "cc-by-sa-4.0";

/** Zamrożona lista kodów (kopiowana do `CHECK` migracji); `krajozbior_org_license` dochodzi z E4-1. */
export const COMMONS_LICENSE_CODES: readonly CommonsLicenseCode[] = [
  "cc0-1.0",
  "public-domain",
  "cc-by-2.0",
  "cc-by-2.5",
  "cc-by-3.0",
  "cc-by-4.0",
  "cc-by-sa-2.0",
  "cc-by-sa-2.5",
  "cc-by-sa-3.0",
  "cc-by-sa-4.0",
];

export type NormalizedLicense = Readonly<{
  code: CommonsLicenseCode;
  /** Dokładna nazwa w podpisie, np. „CC BY-SA 3.0 PL”. */
  label: string;
  /** Adres kanoniczny z końcowym ukośnikiem. */
  url: string;
}>;

export type LicenseResult =
  Readonly<{ ok: true; license: NormalizedLicense }> | Readonly<{ ok: false }>;

const REJECTED: LicenseResult = { ok: false };
const CC_HOST = "creativecommons.org";

type Parsed = Readonly<{
  family: "by" | "by-sa" | "zero" | "mark";
  version: string;
  country: string | null;
}>;

/** Kroki 1–5 reguły: z adresu do rodziny, wersji i kraju (albo `null` = nie rozpoznano). */
export function parseLicenseUrl(raw: string): Parsed | null {
  // (1) przytnij; http → https; tylko host creativecommons.org.
  let value = raw.trim();

  if (value.startsWith("http://")) {
    value = `https://${value.slice("http://".length)}`;
  }

  let url: URL;

  try {
    url = new URL(value);
  } catch {
    return null;
  }

  if (url.protocol !== "https:" || url.hostname !== CC_HOST || url.username || url.password) {
    return null;
  }

  // (2) bez fragmentu i zapytania; (3) bez końcowego ukośnika.
  let path = url.pathname.replace(/\/+$/, "");

  // (4) końcowy segment `deed.<język>` albo `legalcode` (z opcjonalnym językiem), znów bez ukośnika.
  path = path.replace(/\/(?:deed(?:\.[A-Za-z_-]+)?|legalcode(?:\.[A-Za-z_-]+)?)$/, "");
  path = path.replace(/\/+$/, "");

  // (5) ścieżka licencji.
  const licence = /^\/licenses\/(by|by-sa)\/([0-9]\.[0-9])(?:\/([a-z]{2}))?$/.exec(path);

  if (licence) {
    return {
      family: licence[1] as "by" | "by-sa",
      version: licence[2]!,
      country: licence[3] ?? null,
    };
  }

  const domain = /^\/publicdomain\/(zero|mark)\/1\.0$/.exec(path);

  return domain ? { family: domain[1] as "zero" | "mark", version: "1.0", country: null } : null;
}

type ParsedShort = Readonly<{
  family: Parsed["family"];
  version: string;
  country: string | null;
}>;

/** `license_short`: przycięcie, pojedyncze spacje, wielkie litery do porównania. */
export function parseLicenseShort(raw: string): ParsedShort | null {
  const value = raw.trim().replace(/\s+/g, " ").toUpperCase();

  if (value === "CC0" || value === "CC0 1.0") {
    return { family: "zero", version: "1.0", country: null };
  }

  if (value === "PUBLIC DOMAIN") {
    return { family: "mark", version: "1.0", country: null };
  }

  const match = /^CC (BY|BY-SA) ([0-9]\.[0-9])(?: ([A-Z]{2}))?$/.exec(value);

  if (!match) {
    return null;
  }

  return {
    family: match[1] === "BY" ? "by" : "by-sa",
    version: match[2]!,
    country: match[3]?.toLowerCase() ?? null,
  };
}

const VERSIONS = new Set(["2.0", "2.5", "3.0", "4.0"]);
// Kod kraju jest dopuszczony tylko dla wersji 2.0–3.0 (krok 7).
const COUNTRY_VERSIONS = new Set(["2.0", "2.5", "3.0"]);

/**
 * Cała reguła (kroki 1–7). Sprzeczność rodziny, wersji albo kraju (kraj musi być w obu miejscach
 * albo w żadnym), obcy host, nieznana wersja i licencje NC, ND, GFDL dają `ok: false`
 * (wynik `skipped_unknown_license`). Pusty adres jest dopuszczony tylko dla domeny publicznej.
 */
export function normalizeCommonsLicense(
  licenseShort: string,
  licenseUrl: string | null | undefined,
): LicenseResult {
  const short = parseLicenseShort(licenseShort);

  if (short === null) {
    return REJECTED;
  }

  const urlText = (licenseUrl ?? "").trim();
  let country = short.country;

  if (urlText === "") {
    if (short.family !== "mark") {
      return REJECTED;
    }
  } else {
    const parsed = parseLicenseUrl(urlText);

    if (
      parsed === null ||
      parsed.family !== short.family ||
      parsed.version !== short.version ||
      parsed.country !== short.country
    ) {
      return REJECTED;
    }

    country = parsed.country;
  }

  if (short.family === "zero") {
    return {
      ok: true,
      license: {
        code: "cc0-1.0",
        label: "CC0 1.0",
        url: "https://creativecommons.org/publicdomain/zero/1.0/",
      },
    };
  }

  if (short.family === "mark") {
    return {
      ok: true,
      license: {
        code: "public-domain",
        label: "domena publiczna",
        url: "https://creativecommons.org/publicdomain/mark/1.0/",
      },
    };
  }

  if (!VERSIONS.has(short.version)) {
    return REJECTED;
  }

  if (country !== null && !COUNTRY_VERSIONS.has(short.version)) {
    return REJECTED;
  }

  const family = short.family === "by" ? "BY" : "BY-SA";
  const code = `cc-${short.family}-${short.version}` as CommonsLicenseCode;
  const countrySuffix = country === null ? "" : `/${country}`;

  return {
    ok: true,
    license: {
      code,
      label: `CC ${family} ${short.version}${country === null ? "" : ` ${country.toUpperCase()}`}`,
      url: `https://creativecommons.org/licenses/${short.family}/${short.version}${countrySuffix}/`,
    },
  };
}
