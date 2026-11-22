import { describe, expect, it } from "vitest";

import {
  etagMatches,
  isCanonicalUuid,
  notFoundHeaders,
  parseMediaRequest,
  photoEtag,
  photoHeaders,
} from "@/features/photos/domain/media-request";

const ID = "0b6f3a52-7c41-4b7e-9d0a-1c2d3e4f5a6b";

describe("parseMediaRequest (E4-2b, S5)", () => {
  it("accepts a place photo with a canonical UUID and a known size", () => {
    expect(parseMediaRequest("p", ID, "main")).toEqual({ photoId: ID, size: "main" });
    expect(parseMediaRequest("p", ID, "w400")).toEqual({ photoId: ID, size: "w400" });
  });

  it("refuses the explorer kind until E4-4, and every other kind", () => {
    expect(parseMediaRequest("e", ID, "main")).toBeNull();
    expect(parseMediaRequest("P", ID, "main")).toBeNull();
    expect(parseMediaRequest("place", ID, "main")).toBeNull();
    expect(parseMediaRequest("", ID, "main")).toBeNull();
  });

  it.each([
    ["traversal", ".."],
    ["encoded traversal", "%2e%2e"],
    ["encoded slash", "a%2fb"],
    ["slash", "../etc/passwd"],
    ["upper case UUID", ID.toUpperCase()],
    ["mixed case UUID", `${ID.slice(0, 8).toUpperCase()}${ID.slice(8)}`],
    ["too short", ID.slice(0, 35)],
    ["without dashes", ID.replaceAll("-", "")],
    ["trailing space", `${ID} `],
    ["newline", `${ID}\n`],
    ["over 64 characters", "a".repeat(65)],
    ["very long", `${ID}${"0".repeat(500)}`],
    ["empty", ""],
  ])("refuses a photo id that is %s", (_name, photoId) => {
    expect(parseMediaRequest("p", photoId, "main")).toBeNull();
  });

  it.each(["og", "MAIN", "w800", "", "main.webp", "main/", "..", "%2e%2e", "a".repeat(65)])(
    "refuses the size %j",
    (size) => {
      expect(parseMediaRequest("p", ID, size)).toBeNull();
    },
  );
});

describe("isCanonicalUuid", () => {
  it("accepts lower case only", () => {
    expect(isCanonicalUuid(ID)).toBe(true);
    expect(isCanonicalUuid(ID.toUpperCase())).toBe(false);
  });
});

describe("photoEtag and etagMatches", () => {
  it("is 16 hex characters of a SHA-256 in quotes, never the key itself", () => {
    const etag = photoEtag(ID, "main");

    expect(etag).toMatch(/^"[0-9a-f]{16}"$/);
    expect(etag).not.toContain(ID);
  });

  it("differs per size and per key, and is stable", () => {
    expect(photoEtag(ID, "main")).toBe(photoEtag(ID, "main"));
    expect(photoEtag(ID, "main")).not.toBe(photoEtag(ID, "w400"));
    expect(photoEtag(ID, "main")).not.toBe(
      photoEtag("1b6f3a52-7c41-4b7e-9d0a-1c2d3e4f5a6b", "main"),
    );
  });

  it("matches the header the way RFC 9110 says (weak comparison, list, star)", () => {
    const etag = photoEtag(ID, "w400");

    expect(etagMatches(null, etag)).toBe(false);
    expect(etagMatches(etag, etag)).toBe(true);
    expect(etagMatches(`W/${etag}`, etag)).toBe(true);
    expect(etagMatches(`"other", ${etag}`, etag)).toBe(true);
    expect(etagMatches("*", etag)).toBe(true);
    expect(etagMatches('"other"', etag)).toBe(false);
    expect(etagMatches("", etag)).toBe(false);
  });
});

describe("response headers", () => {
  it("makes a photo anyone may see cacheable for a day and embeddable cross-origin", () => {
    const headers = photoHeaders("public", '"abc"');

    expect(headers["Cache-Control"]).toBe("public, max-age=86400");
    expect(headers["Cross-Origin-Resource-Policy"]).toBe("cross-origin");
    expect(headers.ETag).toBe('"abc"');
  });

  it("keeps a photo of a draft out of every cache and same-origin", () => {
    const headers = photoHeaders("private", '"abc"');

    expect(headers["Cache-Control"]).toBe("private, no-store");
    expect(headers["Cross-Origin-Resource-Policy"]).toBe("same-origin");
  });

  it("sends the hardening headers of 5.4 in both cases", () => {
    for (const visibility of ["public", "private"] as const) {
      const headers = photoHeaders(visibility, '"abc"');

      expect(headers["Content-Type"]).toBe("image/webp");
      expect(headers["X-Content-Type-Options"]).toBe("nosniff");
      expect(headers["Content-Disposition"]).toBe("inline");
      expect(headers["Content-Security-Policy"]).toBe("default-src 'none'; sandbox");
    }
  });

  it("gives every refusal the same uncacheable headers", () => {
    const headers = notFoundHeaders();

    expect(headers["Cache-Control"]).toBe("private, no-store");
    expect(headers["Content-Security-Policy"]).toBe("default-src 'none'; sandbox");
    expect(headers).not.toHaveProperty("ETag");
  });
});
