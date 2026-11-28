import { expect, test, type APIResponse } from "@playwright/test";

// Issue #67: the headers from next.config.ts reach real responses of every
// kind of route, not only the config object checked by the unit test.
function expectSecurityHeaders(response: APIResponse) {
  const headers = response.headers();

  expect(headers["content-security-policy"]).toContain("frame-ancestors 'none'");
  expect(headers["content-security-policy"]).not.toContain("unsafe-eval");
  // E12-5: the collection map loads tiles from this one host; connect-src stays 'self'.
  expect(headers["content-security-policy"]).toContain(
    "img-src 'self' data: blob: https://tile.openstreetmap.org;",
  );
  expect(headers["content-security-policy"]).toContain("connect-src 'self';");
  expect(headers["x-frame-options"]).toBe("DENY");
  expect(headers["x-content-type-options"]).toBe("nosniff");
  expect(headers["referrer-policy"]).toBe("strict-origin-when-cross-origin");
  expect(headers["permissions-policy"]).toContain("geolocation=(self)");
  expect(headers["strict-transport-security"]).toBe("max-age=31536000");
}

test("security headers are sent on pages, API, 404 and static assets", async ({ request }) => {
  const home = await request.get("/");
  expect(home.ok()).toBe(true);
  expectSecurityHeaders(home);

  // Status depends on the database; the headers must be there either way.
  expectSecurityHeaders(await request.get("/api/health"));

  const missing = await request.get("/nie-ma-takiej-strony");
  expect(missing.status()).toBe(404);
  expectSecurityHeaders(missing);

  const asset = (await home.text()).match(/\/_next\/static\/[^"']+\.js/)?.[0];
  expect(asset, "home page references a static script").toBeTruthy();
  const script = await request.get(asset!);
  expect(script.ok()).toBe(true);
  expectSecurityHeaders(script);
});

// RFC 9116: the contact for vulnerability reports is served as a plain static file.
test("security.txt is served from /.well-known/", async ({ request }) => {
  const response = await request.get("/.well-known/security.txt");

  expect(response.status()).toBe(200);
  expect(response.headers()["content-type"]).toContain("text/plain");
  expect(await response.text()).toContain("Contact: mailto:bezpieczenstwo@krajozbior.pl");
});
