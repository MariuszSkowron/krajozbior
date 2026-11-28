import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { CONTACT_ADDRESSES } from "@/features/legal/domain/legal-pages";

// RFC 9116: the file is served from public/.well-known/ (the proxy skips `.txt` paths).
const file = readFileSync(join(process.cwd(), "public", ".well-known", "security.txt"), "utf8");

function field(name: string): string | undefined {
  return file.match(new RegExp(`^${name}: (.+)$`, "m"))?.[1]?.trim();
}

describe("security.txt", () => {
  it("points the reports at the security address", () => {
    expect(field("Contact")).toBe(`mailto:${CONTACT_ADDRESSES.security}`);
    expect(field("Canonical")).toBe("https://krajozbior.pl/.well-known/security.txt");
    expect(field("Preferred-Languages")).toBe("pl, en");
  });

  // Plik security.txt trzeba odnowić (nowe Expires) przed 27.11.2027, inaczej ten test zacznie padać.
  it("has an expiry date in the future, in ISO 8601", () => {
    const expires = field("Expires");

    expect(expires).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/);
    expect(new Date(expires!).getTime()).toBeGreaterThan(Date.now());
  });
});
