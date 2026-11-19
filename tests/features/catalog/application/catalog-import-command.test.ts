import { readFileSync } from "node:fs";

import { describe, expect, it, vi } from "vitest";

import {
  MAX_IMPORT_FILE_BYTES,
  runCatalogImport,
  type CatalogImportCommandDeps,
  type CatalogImportRunner,
} from "@/features/catalog/application/catalog-import-command";
import {
  assertSafeImportEnvironment,
  UnsafeImportEnvironmentError,
} from "@/features/catalog/application/catalog-import-safety";
import type { CatalogImportOutcome } from "@/features/catalog/application/catalog-import-types";

const fixture = readFileSync("tests/fixtures/curation/minimal.ndjson", "utf8");
const publicFixture = readFileSync("tests/fixtures/curation/minimal-public.ndjson", "utf8");

function setup(outcome?: CatalogImportOutcome, content = fixture) {
  const run = vi.fn(async () => outcome as CatalogImportOutcome);
  const close = vi.fn(async () => undefined);
  const connect = vi.fn(async (): Promise<CatalogImportRunner> => ({ run, close }));
  const deps: CatalogImportCommandDeps = { readFile: async () => content, connect };

  return { run, close, connect, deps };
}

const withOrg = ["--org-slug", "gmina-a", "--curator-email", "Kurator@Example.com"];

describe("catalog:import validation without a database", () => {
  it("validates the fixture without connecting (also in the public profile)", async () => {
    const { connect, deps } = setup();
    const full = await runCatalogImport(["--dry-run", "--file", "x.ndjson"], deps);
    const publicProfile = await runCatalogImport(
      ["--dry-run", "--file", "x.ndjson", "--profile", "public"],
      { ...deps, readFile: async () => publicFixture },
    );

    expect(full.exitCode).toBe(0);
    expect(JSON.parse(full.stdout[0]!)).toMatchObject({
      outcome: "valid",
      collections: 2,
      places: 3,
    });
    expect(publicProfile.exitCode).toBe(0);
    expect(connect).not.toHaveBeenCalled();
  });

  it("notes keys to check in the database", async () => {
    const lines = fixture
      .split("\n")
      .filter((line) => !line.includes('"ext:TEST-0003"') || line.includes('"collection"'));
    const { deps } = setup(undefined, lines.join("\n"));
    const result = await runCatalogImport(["--dry-run", "--file", "x"], deps);

    expect(JSON.parse(result.stdout[0]!).externalKeysToCheck).toBe(1);
    expect(result.stderr[0]).toContain("spoza pliku");
  });

  it("works with the database variables removed from the environment", async () => {
    const saved = { url: process.env.DATABASE_URL, ops: process.env.DATABASE_OPS_URL };

    delete process.env.DATABASE_URL;
    delete process.env.DATABASE_OPS_URL;
    try {
      const { deps } = setup();

      expect((await runCatalogImport(["--dry-run", "--file", "x"], deps)).exitCode).toBe(0);
    } finally {
      if (saved.url !== undefined) process.env.DATABASE_URL = saved.url;
      if (saved.ops !== undefined) process.env.DATABASE_OPS_URL = saved.ops;
    }
  });

  it("reports line numbers and paths of an invalid file, never its content", async () => {
    const broken = fixture.replace('"region":"pomorskie"', '"region":"nigdzie"');
    const { deps } = setup(undefined, broken);
    const result = await runCatalogImport(["--dry-run", "--file", "x"], deps);
    const body = JSON.parse(result.stdout[0]!);

    expect(result.exitCode).toBe(2);
    expect(body.outcome).toBe("invalid");
    expect(body.errors.length).toBeGreaterThan(0);
    expect(result.stdout[0]).not.toContain("nigdzie");
  });

  it.each([
    [["--dry-run"], "file"],
    [["--dry-run", "--file", "x", "--org-slug", "gmina-a"], "razem"],
    [["--dry-run", "--file", "x", "--curator-email", "a@b.pl"], "razem"],
    [["--file", "x"], "wgranie wymaga"],
    [["--dry-run", "--file", "x", "--publish"], "nieznana flaga"],
    [["--dry-run", "--file", "x", "--remove"], "nieznana flaga"],
    [["--dry-run", "--file", "x", "--profile", "inny"], "profile"],
    [
      ["--dry-run", "--file", "x", "--org-slug", "Zła Nazwa", "--curator-email", "a@b.pl"],
      "org-slug",
    ],
    [
      ["--dry-run", "--file", "x", "--org-slug", "a", "--curator-email", "nie-email"],
      "curator-email",
    ],
  ])("refuses arguments %j with exit 2", async (argv, hint) => {
    const { connect, deps } = setup();
    const result = await runCatalogImport(argv, deps);

    expect(result.exitCode).toBe(2);
    expect(result.stderr.join("\n")).toContain(hint);
    expect(connect).not.toHaveBeenCalled();
  });

  it("refuses a file that cannot be read or is too large", async () => {
    const { deps } = setup();
    const unreadable = await runCatalogImport(["--dry-run", "--file", "x"], {
      ...deps,
      readFile: async () => {
        throw new Error("ENOENT secret/path");
      },
    });
    const big = await runCatalogImport(["--dry-run", "--file", "x"], {
      ...deps,
      readFile: async () => "x".repeat(MAX_IMPORT_FILE_BYTES + 1),
    });

    expect(unreadable.exitCode).toBe(2);
    expect(unreadable.stderr.join("")).not.toContain("secret");
    expect(big.exitCode).toBe(2);
  });
});

describe("catalog:import with the database", () => {
  it("connects only with both flags, runs, and closes", async () => {
    const outcome: CatalogImportOutcome = {
      kind: "preview",
      preview: {
        collections: { create: 2 },
        places: { create: 3 },
        orphanedKeys: { collection: 0, place: 0 },
        collectionLimitExceeded: true,
      },
    };
    const { run, close, connect, deps } = setup(outcome);
    const result = await runCatalogImport(["--dry-run", "--file", "x", ...withOrg], deps);

    expect(connect).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenCalledWith(
      expect.objectContaining({
        orgSlug: "gmina-a",
        curatorEmail: "kurator@example.com",
        preview: true,
      }),
    );
    expect(close).toHaveBeenCalled();
    expect(result.exitCode).toBe(0);
    expect(result.stdout[0]).toContain('"outcome":"preview"');
    expect(result.stdout[0]).not.toContain("kurator@");
    expect(result.stderr.join("\n")).toContain("limicie");
  });

  it("prints a preview without a limit warning", async () => {
    const { deps } = setup({
      kind: "preview",
      preview: {
        collections: {},
        places: {},
        orphanedKeys: { collection: 0, place: 0 },
        collectionLimitExceeded: false,
      },
    });
    const result = await runCatalogImport(["--dry-run", "--file", "x", ...withOrg], deps);

    expect(result.stderr).toHaveLength(1);
  });

  it("maps a load to exit 0 with a report", async () => {
    const { run, deps } = setup({
      kind: "done",
      batchId: "b",
      collections: [
        {
          importKey: "col:a",
          line: 2,
          result: "created",
          composition: "synced",
          places: [{ importKey: "ext:1", result: "created" }],
        },
      ],
    });
    const result = await runCatalogImport(["--file", "x", ...withOrg], deps);

    expect(run).toHaveBeenCalledWith(expect.objectContaining({ preview: false }));
    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout[0]!)).toMatchObject({
      outcome: "applied",
      collectionResults: { created: 1 },
      placeResults: { created: 1 },
    });
    expect(result.report).toBeDefined();
  });

  it("maps a refused collection to exit 3", async () => {
    const { deps } = setup({
      kind: "done",
      batchId: "b",
      collections: [
        {
          importKey: "col:a",
          line: 2,
          result: "refused",
          composition: null,
          refusal: "forbidden",
          places: [],
        },
      ],
    });
    const result = await runCatalogImport(["--file", "x", ...withOrg], deps);

    expect(result.exitCode).toBe(3);
    expect(JSON.parse(result.stdout[0]!).outcome).toBe("partial");
  });

  it.each([
    [{ kind: "refused", code: "organization_unavailable" }, 3, "niedostępna"],
    [{ kind: "refused", code: "curator_not_found" }, 3, "nie ma konta"],
    [{ kind: "rejected", code: "unknown_external_key", count: 2 }, 2, "Nic nie zapisano"],
  ] as const)("maps %j to exit %i", async (outcome, exitCode, hint) => {
    const { deps } = setup(outcome);
    const result = await runCatalogImport(["--file", "x", ...withOrg], deps);

    expect(result.exitCode).toBe(exitCode);
    expect(result.stderr.join(" ")).toContain(hint);
  });

  it("shows only the SQLSTATE class of a failure, never the message (23503 included)", async () => {
    const { deps } = setup();
    const failing: CatalogImportCommandDeps = {
      ...deps,
      connect: async () => ({
        run: async () => {
          throw Object.assign(
            new Error('violates foreign key constraint "visits_place_id_fkey" on table "visits"'),
            { code: "23503", constraint: "visits_place_id_fkey" },
          );
        },
        close: async () => undefined,
      }),
    };
    const result = await runCatalogImport(["--file", "x", ...withOrg], failing);
    const text = [...result.stdout, ...result.stderr].join("\n");

    expect(result.exitCode).toBe(1);
    expect(text).toContain("klasa 23");
    expect(text).not.toMatch(/visits|fkey|constraint/);
  });

  it("reports a failure without a SQLSTATE and a configuration error", async () => {
    const { deps } = setup();
    const plain = await runCatalogImport(["--file", "x", ...withOrg], {
      ...deps,
      connect: async () => {
        throw new Error("connect ECONNREFUSED");
      },
    });
    const config = await runCatalogImport(["--file", "x", ...withOrg], {
      ...deps,
      connect: async () => {
        throw Object.assign(new Error("Invalid server configuration: DATABASE_URL"), {
          name: "ServerConfigError",
        });
      },
    });

    expect(plain.stderr.join(" ")).toContain("brak");
    expect(config.stderr).toEqual(["Invalid server configuration: DATABASE_URL"]);
    expect(config.exitCode).toBe(1);
  });

  it("refuses with exit 3 when the environment is unsafe", async () => {
    const { deps } = setup();

    for (const code of ["production", "non_local_database"] as const) {
      const result = await runCatalogImport(["--file", "x", ...withOrg], {
        ...deps,
        connect: async () => {
          throw new UnsafeImportEnvironmentError(code);
        },
      });

      expect(result.exitCode).toBe(3);
    }
  });
});

describe("assertSafeImportEnvironment", () => {
  const local = {
    DATABASE_URL: "postgres://u:p@127.0.0.1:55450/db",
    DATABASE_OPS_URL: "postgres://u:p@localhost:55450/db",
  };

  it("accepts loopback databases outside production", () => {
    expect(() => assertSafeImportEnvironment({ ...local, NODE_ENV: "development" })).not.toThrow();
    expect(() => assertSafeImportEnvironment(local)).not.toThrow();
  });

  it("refuses production", () => {
    expect(() => assertSafeImportEnvironment({ ...local, NODE_ENV: "production" })).toThrow(
      /production/,
    );
  });

  it.each([
    { ...local, DATABASE_URL: "postgres://u:secret@db.example.com/x" },
    { ...local, DATABASE_OPS_URL: "postgres://u:secret@10.0.0.5/x" },
    { ...local, DATABASE_URL: undefined },
    { ...local, DATABASE_OPS_URL: "not a url" },
    { ...local, DATABASE_URL: "postgres://u:secret@localhost/x?host=example.com" },
    { ...local, DATABASE_OPS_URL: "postgres://u:secret@127.0.0.1/x?hostaddr=10.0.0.5" },
    { ...local, DATABASE_OPS_URL: "postgres://u:secret@localhost/x?HOST=example.com" },
    { ...local, DATABASE_URL: "postgres://u:secret@localhost,example.com/x" },
  ])("refuses a database outside localhost without echoing the URL", (env) => {
    try {
      assertSafeImportEnvironment(env);
      throw new Error("should refuse");
    } catch (error) {
      expect(error).toBeInstanceOf(UnsafeImportEnvironmentError);
      expect((error as Error).message).not.toContain("secret");
    }
  });
});
