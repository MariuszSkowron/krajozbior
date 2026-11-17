import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

// The code is public for viewing only: all rights reserved (LICENSE). npm must
// say the same, so nobody reads "no license field" as an open-source license,
// and the package must never be published to the npm registry.
const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");

describe("license consistency", () => {
  it("LICENSE reserves all rights and grants only viewing and forking on GitHub", () => {
    const license = read("LICENSE");
    expect(license).toMatch(/^Copyright \(c\) \S.* All rights reserved\.$/m);
    expect(license).toContain("No license is");
    expect(license).toContain("GitHub Terms of Service");
    expect(license).toContain("WITHOUT WARRANTY OF ANY KIND");
    expect(license).toContain("Wszelkie prawa zastrzeżone.");
  });

  it("package.json is private and UNLICENSED, also in the lockfile", () => {
    const pkg = JSON.parse(read("package.json")) as { private?: boolean; license?: string };
    const lock = JSON.parse(read("package-lock.json")) as {
      packages: Record<string, { license?: string }>;
    };
    expect(pkg.private).toBe(true);
    expect(pkg.license).toBe("UNLICENSED");
    expect(lock.packages[""]?.license).toBe("UNLICENSED");
  });
});
