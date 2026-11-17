import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

import { describe, expect, it } from "vitest";

// The Better Auth hooks treat a call without an endpoint context as trusted
// server code (see auth-hooks.ts). So in `src/` only the demo seed may call
// these internal functions; a route for people goes through `auth.api.*`.
// CLI scripts (`scripts/`) are audited separately; tests (`tests/`) may call
// them to simulate an OAuth return (spec 2.7), so they are not scanned.
const FUNCTIONS = "createUser|createAccount|createOAuthUser|linkAccount";
const ACCESS = String.raw`\s*(?:\?\.|\.)\s*`;
const DIRECT = new RegExp(String.raw`internalAdapter${ACCESS}(?:${FUNCTIONS})\b`);
const BRACKET = new RegExp(
  String.raw`internalAdapter\s*(?:\?\.)?\s*\[\s*["'` + "`" + String.raw`](?:${FUNCTIONS})`,
);
const DESTRUCTURED = new RegExp(
  String.raw`\{[^}]*\b(?:${FUNCTIONS})\b[^}]*\}\s*=\s*[^;]*internalAdapter`,
);
const ALIAS_DECLARATION =
  /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*[^;\n]*internalAdapter\s*(?:[;\n]|$)/g;

// One detection function for the real scan and the negative controls.
export function usesInternalAccountWrite(source: string): boolean {
  if (DIRECT.test(source) || BRACKET.test(source) || DESTRUCTURED.test(source)) {
    return true;
  }

  for (const [, alias] of source.matchAll(ALIAS_DECLARATION)) {
    const name = alias!.replace(/\$/g, "[$]");
    const viaAlias = new RegExp(String.raw`\b${name}${ACCESS}(?:${FUNCTIONS})\b`);
    const destructuredAlias = new RegExp(
      String.raw`\{[^}]*\b(?:${FUNCTIONS})\b[^}]*\}\s*=\s*${name}\b`,
    );
    if (viaAlias.test(source) || destructuredAlias.test(source)) {
      return true;
    }
  }

  return false;
}

const SEED = "src/features/identity/infrastructure/demo-accounts.ts";

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (name === "node_modules" || name === ".next") {
      return [];
    }

    return statSync(path).isDirectory()
      ? sourceFiles(path)
      : /\.(ts|tsx|mts)$/.test(name)
        ? [path]
        : [];
  });
}

describe("internal Better Auth adapter allowlist", () => {
  it("writes accounts through the internal adapter only from the seed", () => {
    const offenders = sourceFiles("src")
      .map((file) => relative(".", file).split(sep).join("/"))
      .filter((file) => file !== SEED)
      .filter((file) => usesInternalAccountWrite(readFileSync(file, "utf8")));

    expect(offenders).toEqual([]);
  });

  it("still finds the seed (the scan is not empty)", () => {
    expect(usesInternalAccountWrite(readFileSync(SEED, "utf8"))).toBe(true);
  });

  describe("negative controls: each pattern is caught", () => {
    const caught: Record<string, string> = {
      "createUser direct": "await ctx.internalAdapter.createUser(data);",
      "createAccount direct": "await ctx.internalAdapter.createAccount(data);",
      "createOAuthUser direct": "await ctx.internalAdapter.createOAuthUser(a, b);",
      "linkAccount direct": "await ctx.internalAdapter.linkAccount(data);",
      "optional chaining": "await ctx?.internalAdapter?.createUser(data);",
      "bracket access": 'await ctx.internalAdapter["createAccount"](data);',
      destructuring: "const { createUser } = ctx.context.internalAdapter;",
      "destructuring with others": "const { findUserById, linkAccount } = auth.internalAdapter;",
      aliasing: "const ia = ctx.context.internalAdapter;\nawait ia.createUser(data);",
      "aliasing with optional chaining":
        "const ia = ctx.internalAdapter\nawait ia?.createOAuthUser(a);",
      "destructuring an alias": "const ia = ctx.internalAdapter;\nconst { createAccount } = ia;",
    };

    for (const [name, source] of Object.entries(caught)) {
      it(`catches ${name}`, () => {
        expect(usesInternalAccountWrite(source)).toBe(true);
      });
    }

    it("does not flag read-only adapter calls or unrelated names", () => {
      expect(usesInternalAccountWrite("await ctx.internalAdapter.findUserById(id);")).toBe(false);
      expect(
        usesInternalAccountWrite("const ia = ctx.internalAdapter;\nia.findUserByEmail(e);"),
      ).toBe(false);
      expect(usesInternalAccountWrite("repo.createUser(data); const { createUser } = repo;")).toBe(
        false,
      );
    });
  });
});
