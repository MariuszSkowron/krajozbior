import { describe, expect, it } from "vitest";

import {
  buildCommonsApiUrl,
  decideVersion,
  parseCommonsVersionResponse,
  type CommonsVersionInfo,
  type VersionExpectation,
} from "@/features/photos/domain/commons-version";

const RETRIEVED = new Date("2026-11-20T00:00:00Z");

const page = (overrides: Record<string, unknown> = {}) => ({
  query: {
    pages: [
      {
        pageid: 1,
        title: "File:Example.jpg",
        imageinfo: [
          {
            timestamp: "2026-01-02T03:04:05Z",
            url: "https://upload.wikimedia.org/wikipedia/commons/a/a9/Example.jpg",
            width: 3000,
            extmetadata: {
              LicenseShortName: { value: "CC BY-SA 4.0" },
              LicenseUrl: { value: "https://creativecommons.org/licenses/by-sa/4.0/" },
            },
          },
        ],
        ...overrides,
      },
    ],
  },
});

const info = (overrides: Partial<CommonsVersionInfo> = {}): CommonsVersionInfo => ({
  timestamp: Date.parse("2026-01-02T03:04:05Z"),
  width: 3000,
  licenseShort: "CC BY-SA 4.0",
  licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0/",
  fileName: "Example.jpg",
  ...overrides,
});

const expected = (overrides: Partial<VersionExpectation> = {}): VersionExpectation => ({
  commonsFile: "File:Example.jpg",
  sourceWidth: 3000,
  licenseCode: "cc-by-sa-4.0",
  retrievedAt: RETRIEVED,
  ...overrides,
});

describe("buildCommonsApiUrl", () => {
  it("builds a fixed-host address with the file name as an encoded parameter", () => {
    const address = new URL(buildCommonsApiUrl("File:Zamek w Malborku & więcej.jpg")!);

    expect(address.origin + address.pathname).toBe("https://commons.wikimedia.org/w/api.php");
    expect(address.searchParams.get("titles")).toBe("File:Zamek w Malborku & więcej.jpg");
    expect(address.searchParams.get("prop")).toBe("imageinfo");
    expect(address.searchParams.get("iiprop")).toBe("timestamp|url|size|mime|extmetadata");
    expect(address.searchParams.get("redirects")).toBeNull();
    expect(address.searchParams.has("iilimit")).toBe(false);
  });

  it("accepts a name with underscores and refuses an empty, slashed or piped one", () => {
    expect(new URL(buildCommonsApiUrl("A_b.jpg")!).searchParams.get("titles")).toBe("File:A b.jpg");
    expect(buildCommonsApiUrl("File:")).toBeNull();
    expect(buildCommonsApiUrl("a/b.jpg")).toBeNull();
    expect(buildCommonsApiUrl("a|b.jpg")).toBeNull();
  });
});

describe("parseCommonsVersionResponse", () => {
  it("reads the current version", () => {
    expect(parseCommonsVersionResponse(page())).toEqual({ ok: true, info: info() });
  });

  it("decodes the file name from the original address and tolerates missing metadata", () => {
    const result = parseCommonsVersionResponse(
      page({
        imageinfo: [
          {
            timestamp: "2026-01-02T03:04:05Z",
            url: "https://upload.wikimedia.org/wikipedia/commons/a/a9/Zamek_%C5%81%C3%B3d%C5%BA.jpg",
            width: 10,
          },
        ],
      }),
    );

    expect(result).toMatchObject({
      ok: true,
      info: { fileName: "Zamek_Łódź.jpg", licenseShort: "", licenseUrl: null },
    });
  });

  it.each([
    ["a missing page", { missing: true, imageinfo: undefined }],
    ["an invalid title", { invalid: true, imageinfo: undefined }],
    ["a page without imageinfo (a redirect page, for instance)", { imageinfo: undefined }],
    ["an empty imageinfo", { imageinfo: [] }],
    [
      "two versions",
      {
        imageinfo: [page().query.pages[0]!.imageinfo![0], page().query.pages[0]!.imageinfo![0]],
      },
    ],
    [
      "an unreadable timestamp",
      { imageinfo: [{ ...page().query.pages[0]!.imageinfo![0], timestamp: "wczoraj" }] },
    ],
    [
      "an address without a file name",
      { imageinfo: [{ ...page().query.pages[0]!.imageinfo![0], url: "https://x.test/" }] },
    ],
    [
      "an address that is not one",
      { imageinfo: [{ ...page().query.pages[0]!.imageinfo![0], url: "nie adres" }] },
    ],
  ])("treats %s as gone", (_name, overrides) => {
    expect(parseCommonsVersionResponse(page(overrides))).toEqual({
      ok: false,
      reason: "file_gone",
    });
  });

  it.each([
    ["not an object", "x"],
    ["an error answer", { error: { code: "internal_api_error" } }],
    ["two pages", { query: { pages: [{}, {}] } }],
    ["no pages", { query: { pages: [] } }],
    [
      "a bad width",
      page({ imageinfo: [{ timestamp: "2026-01-02T03:04:05Z", url: "u", width: "x" }] }),
    ],
  ])("treats %s as an API error", (_name, json) => {
    expect(parseCommonsVersionResponse(json)).toEqual({ ok: false, reason: "api_error" });
  });
});

describe("decideVersion", () => {
  const found = (overrides: Partial<CommonsVersionInfo> = {}) => ({
    ok: true as const,
    info: info(overrides),
  });

  it("accepts the same, an older or an equal version", () => {
    expect(decideVersion(found(), expected())).toEqual({ ok: true });
    expect(decideVersion(found({ timestamp: RETRIEVED.getTime() }), expected())).toEqual({
      ok: true,
    });
  });

  it("rejects a version newer than the day of the selection", () => {
    expect(decideVersion(found({ timestamp: RETRIEVED.getTime() + 1000 }), expected())).toEqual({
      ok: false,
      reason: "file_changed",
    });
  });

  it("rejects a day of the selection that lies in the future", () => {
    const now = RETRIEVED.getTime() - 1000;

    expect(decideVersion(found(), expected({ now }))).toEqual({
      ok: false,
      reason: "file_changed",
    });
    expect(decideVersion(found(), expected({ now: RETRIEVED.getTime() }))).toEqual({ ok: true });
  });

  it("reads the real API shape: original address with utm parameters, licence without slash", () => {
    const result = parseCommonsVersionResponse(
      page({
        imageinfo: [
          {
            timestamp: "2026-01-02T03:04:05Z",
            url: "https://upload.wikimedia.org/wikipedia/commons/a/a9/Example.jpg?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=original",
            width: 3000,
            extmetadata: {
              LicenseShortName: { value: "CC BY-SA 3.0" },
              LicenseUrl: { value: "https://creativecommons.org/licenses/by-sa/3.0" },
            },
          },
        ],
      }),
    );

    expect(result).toMatchObject({ ok: true, info: { fileName: "Example.jpg" } });
    expect(decideVersion(result, expected({ licenseCode: "cc-by-sa-3.0" }))).toEqual({ ok: true });
  });

  it("rejects when the day of the selection or the source width is unknown or different", () => {
    expect(decideVersion(found(), expected({ retrievedAt: null }))).toEqual({
      ok: false,
      reason: "file_changed",
    });
    expect(decideVersion(found({ width: 4000 }), expected())).toEqual({
      ok: false,
      reason: "file_changed",
    });
    expect(decideVersion(found(), expected({ sourceWidth: null }))).toEqual({
      ok: false,
      reason: "file_changed",
    });
  });

  it("rejects a file that moved (the original address has another name)", () => {
    expect(decideVersion(found({ fileName: "Other.jpg" }), expected())).toEqual({
      ok: false,
      reason: "file_gone",
    });
    expect(
      decideVersion(
        found({ fileName: "Zamek_Łódź.jpg" }),
        expected({ commonsFile: "Plik:Zamek Łódź.jpg" }),
      ),
    ).toEqual({
      ok: true,
    });
  });

  it("passes on a missing file and an API error, as they are", () => {
    expect(decideVersion({ ok: false, reason: "file_gone" }, expected())).toEqual({
      ok: false,
      reason: "file_gone",
    });
    expect(decideVersion({ ok: false, reason: "api_error" }, expected())).toEqual({
      ok: false,
      reason: "api_error",
    });
  });

  it("rejects another licence, one that cannot be read and a missing one", () => {
    const changed = found({
      licenseShort: "CC BY 4.0",
      licenseUrl: "https://creativecommons.org/licenses/by/4.0/",
    });

    expect(decideVersion(changed, expected())).toEqual({ ok: false, reason: "license_changed" });
    expect(decideVersion(found({ licenseShort: "CC BY-NC 4.0" }), expected())).toEqual({
      ok: false,
      reason: "license_changed",
    });
    expect(decideVersion(found({ licenseShort: "", licenseUrl: null }), expected())).toEqual({
      ok: false,
      reason: "license_changed",
    });
  });

  it("treats the same licence with another country as the same code", () => {
    // Kod w bazie nie niesie kraju (kraj jest tylko w adresie i nazwie).
    expect(
      decideVersion(
        found({
          licenseShort: "CC BY-SA 3.0 PL",
          licenseUrl: "https://creativecommons.org/licenses/by-sa/3.0/pl/",
        }),
        expected({ licenseCode: "cc-by-sa-3.0" }),
      ),
    ).toEqual({ ok: true });
  });
});
