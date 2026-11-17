import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  RenameInputError,
  renameProject,
  renameText,
  validateNames,
} from "../../scripts/lib/rename-project";

// The template name is spelled in parts so a search for it finds nothing here.
const T = ["star", "ter"].join("");
const D = `${T[0]!.toUpperCase()}${T.slice(1)}`;
const names = { slug: "demo_app", displayName: "Demo App" };

describe("validateNames", () => {
  it.each(["demo_app", "ab", "a1_b2", "a".repeat(31)])("accepts the slug %s", (slug) => {
    expect(validateNames(slug, "Name")).toEqual({ slug, displayName: "Name" });
  });

  it.each([
    "",
    "a",
    "1abc",
    "Demo",
    "demo-app",
    "demo app",
    "a".repeat(32),
    "zażółć",
    T,
    `proba_${T}a`,
    `${T}_kit`,
  ])("rejects the slug %j", (slug) => {
    expect(() => validateNames(slug, "Name")).toThrow(RenameInputError);
  });

  it.each(["", "   ", "x".repeat(61), 'a"b', "a\\b", "a`b", "a<b", "a&b", "a${b", "a\nb"])(
    "rejects the display name %j",
    (displayName) => {
      expect(() => validateNames("demo_app", displayName)).toThrow(RenameInputError);
    },
  );

  it("trims the display name", () => {
    expect(validateNames("demo_app", "  Demo App ").displayName).toBe("Demo App");
  });
});

describe("renameText", () => {
  it("renames identifiers, roles, databases and environment variables", () => {
    const text = `${T}_owner ${T}_integration_test ${T.toUpperCase()}_APP_DB_PASSWORD cookiePrefix: "${T}"`;

    expect(renameText(text, names)).toBe(
      'demo_app_owner demo_app_integration_test DEMO_APP_APP_DB_PASSWORD cookiePrefix: "demo_app"',
    );
  });

  it("renames the repository name in the documentation directory setting", () => {
    expect(renameText(`["../ai-repo-${T}-docs"]`, names)).toBe(`["../demo-app-docs"]`);
  });

  it("renames the GitHub App slug with hyphens, as GitHub names apps", () => {
    expect(renameText(`"appSlug": "${T}-bot" ~/.config/${T}-bot/ ${T}-bot[bot]`, names)).toBe(
      `"appSlug": "demo-app-bot" ~/.config/demo-app-bot/ demo-app-bot[bot]`,
    );
  });

  it("keeps hostnames valid and renames the display name only as a whole word", () => {
    expect(renameText(`user@demo.${T}.local https://${T}.example ${D} ${D}a`, names)).toBe(
      `user@demo.demo-app.local https://demo-app.example Demo App ${D}a`,
    );
  });
});

function fixture(): string {
  const root = mkdtempSync(join(tmpdir(), "rename-project-"));
  const write = (path: string, content: string | Buffer) => {
    const full = join(root, path);

    mkdirSync(join(full, ".."), { recursive: true });
    writeFileSync(full, content);
  };

  write("package.json", JSON.stringify({ name: T, version: "0.1.0" }, null, 2));
  write(
    "package-lock.json",
    `${JSON.stringify(
      {
        name: T,
        version: "0.1.0",
        lockfileVersion: 3,
        packages: { "": { name: T }, "node_modules/x": { name: T } },
      },
      null,
      2,
    )}\n`,
  );
  write("src/app.ts", `export const NAME = "${D}";\nexport const ROLE = "${T}_app";\n`);
  write(
    ".claude/settings.json",
    `{ "additionalDirectories": ["../ai-repo-${T}-docs"] }
`,
  );
  write(".env.example", `DATABASE_ADMIN_URL=postgres://${T}:${T}@localhost:5432/${T}\n`);
  write("node_modules/dep/index.js", `// ${T}\n`);
  write(".next/cache.txt", T);
  write("image.png", Buffer.from([0x89, 0x50, 0x00, 0x01, ...Buffer.from(T)]));

  return root;
}

describe("renameProject", () => {
  it("renames text files, updates the lockfile name fields and skips the rest", () => {
    const root = fixture();
    const result = renameProject(root, names.slug, names.displayName);
    const read = (path: string) => readFileSync(join(root, path), "utf8");

    expect(result.changedFiles.sort()).toEqual([
      ".claude/settings.json",
      ".env.example",
      "package.json",
      "src/app.ts",
    ]);
    expect(result.lockfileUpdated).toBe(true);
    expect(read("src/app.ts")).toBe(
      'export const NAME = "Demo App";\nexport const ROLE = "demo_app_app";\n',
    );
    expect(read(".env.example")).toBe(
      "DATABASE_ADMIN_URL=postgres://demo_app:demo_app@localhost:5432/demo_app\n",
    );
    expect(JSON.parse(read("package.json")).name).toBe("demo_app");
    expect(read(".claude/settings.json")).toContain("../demo-app-docs");

    const lock = JSON.parse(read("package-lock.json"));

    expect(lock.name).toBe("demo_app");
    expect(lock.packages[""].name).toBe("demo_app");
    // Only the name fields of the project change, not those of dependencies.
    expect(lock.packages["node_modules/x"].name).toBe(T);
    expect(read("node_modules/dep/index.js")).toContain(T);
    expect(read(".next/cache.txt")).toBe(T);
    expect(readFileSync(join(root, "image.png")).includes(Buffer.from(T))).toBe(true);
  });

  it("changes nothing for invalid names", () => {
    const root = fixture();

    expect(() => renameProject(root, "Bad Slug", "Name")).toThrow(RenameInputError);
    expect(readFileSync(join(root, "src/app.ts"), "utf8")).toContain(D);
  });

  it("is a no-op the second time", () => {
    const root = fixture();

    renameProject(root, names.slug, names.displayName);

    expect(renameProject(root, "other_app", "Other App")).toEqual({
      changedFiles: [],
      lockfileUpdated: false,
    });
  });
});
