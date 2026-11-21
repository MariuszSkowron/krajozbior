import { describe, expect, it } from "vitest";

import { parseCreateAdminArgs } from "@/features/identity/application/create-admin-args";

describe("parseCreateAdminArgs", () => {
  const base = ["--email", " Admin@Example.com ", "--reason", " Nowy administrator "];

  it("accepts an e-mail and a reason, lowercases and trims, and takes the default operator", () => {
    expect(parseCreateAdminArgs(base, "jan")).toEqual({
      ok: true,
      args: { email: "admin@example.com", operator: "jan", reason: "Nowy administrator" },
    });
  });

  it("takes --operator and --name when given", () => {
    expect(
      parseCreateAdminArgs([...base, "--operator", "ola", "--name", "Ola Admin"], "jan"),
    ).toEqual({
      ok: true,
      args: {
        email: "admin@example.com",
        name: "Ola Admin",
        operator: "ola",
        reason: "Nowy administrator",
      },
    });
  });

  it("refuses a missing, empty or control-character reason before anything is written", () => {
    for (const argv of [
      ["--email", "a@example.com"],
      ["--email", "a@example.com", "--reason", "   "],
      ["--email", "a@example.com", "--reason", "a\nb"],
      // DB-8: the audit is permanent, so no e-mail address in the reason.
      ["--email", "a@example.com", "--reason", "Prośba jan.kowalski@example.com"],
    ]) {
      const result = parseCreateAdminArgs(argv, "jan");

      expect(result).toMatchObject({ ok: false });
      expect(result.ok ? "" : result.message).toContain("--reason");
    }
  });

  it("refuses a bad e-mail, a missing operator and unknown flags without echoing values", () => {
    expect(parseCreateAdminArgs(["--email", "nope", "--reason", "x"], "jan")).toMatchObject({
      ok: false,
    });
    expect(parseCreateAdminArgs(["--email", "a@example.com", "--reason", "x"])).toMatchObject({
      ok: false,
    });
    expect(parseCreateAdminArgs([...base, "--unknown", "x"], "jan")).toMatchObject({ ok: false });

    const result = parseCreateAdminArgs(["--email", "secret-value", "--reason", "x"], "jan");

    expect(result.ok ? "" : result.message).not.toContain("secret-value");
  });
});
