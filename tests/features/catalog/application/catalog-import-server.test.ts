import { readFileSync } from "node:fs";

import { describe, expect, it, vi } from "vitest";

import {
  resultOfFailure,
  resultOfOutcome,
  sha256Hex,
  startDetails,
  type ImportAuditBatch,
} from "@/features/catalog/application/catalog-import-audit";
import {
  runCatalogImport,
  type CatalogImportCommandDeps,
  type CatalogImportRunner,
  type ImportAuditGateway,
} from "@/features/catalog/application/catalog-import-command";
import type { CatalogImportOutcome } from "@/features/catalog/application/catalog-import-types";

const publicFixture = readFileSync("tests/fixtures/curation/minimal-public.ndjson", "utf8");

const host = "krajozbior.pl";
const done: CatalogImportOutcome = {
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
};
const serverFlags = [
  "--target",
  "server",
  "--confirm-host",
  host,
  "--profile",
  "public",
  "--org-slug",
  "gmina-a",
  "--curator-email",
  "Kurator@Example.com",
];
const writeFlags = ["--operator", "Mariusz", "--reason", "Pierwsza fala"];

function setup(
  options: Readonly<{
    outcome?: CatalogImportOutcome;
    runError?: Error;
    startError?: boolean;
    finishError?: boolean;
    prompt?: string;
    serverHost?: string | undefined;
  }> = {},
) {
  const calls: string[] = [];
  const run = vi.fn(async () => {
    calls.push("run");

    if (options.runError !== undefined) {
      throw options.runError;
    }

    return options.outcome ?? done;
  });
  const close = vi.fn(async () => undefined);
  const connectServer = vi.fn(async (): Promise<CatalogImportRunner> => {
    calls.push("connect");

    return { run, close };
  });
  const connectLocal = vi.fn(async (): Promise<CatalogImportRunner> => ({ run, close }));
  const start = vi.fn(async () => {
    calls.push("start");

    if (options.startError === true) {
      throw new Error("db down postgres://secret");
    }

    return { entryId: "entry-1", organizationId: "org-1", subjectUserId: "user-1" };
  });
  const finish = vi.fn(async (...args: unknown[]) => {
    void args;
    calls.push("finish");

    if (options.finishError === true) {
      throw new Error("db down");
    }
  });
  const audit: ImportAuditGateway = { start, finish } as unknown as ImportAuditGateway;
  const promptHost = vi.fn(async () => options.prompt ?? host);
  const deps = (withPrompt: boolean): CatalogImportCommandDeps => ({
    readFile: async () => publicFixture,
    connect: connectLocal,
    server: {
      host: "serverHost" in options ? options.serverHost : host,
      ...(withPrompt ? { promptHost } : {}),
      connect: connectServer,
      audit,
    },
  });

  return { run, close, connectServer, connectLocal, start, finish, promptHost, calls, deps };
}

describe("catalog:import --target server: refusals before any connection", () => {
  it("refuses --publish on the server (E11-Q5 A)", async () => {
    const t = setup();
    const result = await runCatalogImport(
      ["--file", "x", ...serverFlags, ...writeFlags, "--publish"],
      t.deps(false),
    );

    expect(result.exitCode).toBe(3);
    expect(JSON.parse(result.stdout[0]!)).toMatchObject({ code: "publish_on_server" });
    expect(t.connectServer).not.toHaveBeenCalled();
  });

  it("requires the public profile (default and full are refused)", async () => {
    const t = setup();
    const noProfile = serverFlags.filter((_, i) => i !== 4 && i !== 5);
    const full = serverFlags.map((value) => (value === "public" ? "full" : value));

    for (const flags of [noProfile, full]) {
      const result = await runCatalogImport(
        ["--file", "x", ...flags, ...writeFlags],
        t.deps(false),
      );

      expect(result.exitCode).toBe(3);
      expect(JSON.parse(result.stdout[0]!)).toMatchObject({ code: "profile_not_public" });
    }
    expect(t.connectServer).not.toHaveBeenCalled();
  });

  it("refuses without --confirm-host, with a wrong host and without a configured host", async () => {
    const t = setup();
    const without = serverFlags.filter((_, i) => i !== 2 && i !== 3);
    const wrong = serverFlags.map((value) => (value === host ? "example.com" : value));

    for (const flags of [without, wrong]) {
      const result = await runCatalogImport(
        ["--file", "x", ...flags, ...writeFlags],
        t.deps(false),
      );

      expect(result.exitCode).toBe(3);
      expect(JSON.parse(result.stdout[0]!)).toMatchObject({ code: "host_mismatch" });
    }

    for (const missing of [undefined, ""]) {
      const unset = setup({ serverHost: missing });
      const result = await runCatalogImport(
        ["--file", "x", ...serverFlags, ...writeFlags],
        unset.deps(false),
      );

      expect(result.exitCode).toBe(3);
      expect(JSON.parse(result.stdout[0]!)).toMatchObject({ code: "host_not_configured" });
      expect(unset.connectServer).not.toHaveBeenCalled();
    }

    expect(t.connectServer).not.toHaveBeenCalled();
    expect(t.start).not.toHaveBeenCalled();
  });

  it("matches the host regardless of letter case", async () => {
    const t = setup();
    const upper = serverFlags.map((value) => (value === host ? host.toUpperCase() : value));
    const result = await runCatalogImport(["--file", "x", ...upper, ...writeFlags], t.deps(false));

    expect(result.exitCode).toBe(0);
  });

  it("at a terminal also needs the retyped host", async () => {
    const wrong = setup({ prompt: "nie-ten-host.pl" });
    const refused = await runCatalogImport(
      ["--file", "x", ...serverFlags, ...writeFlags],
      wrong.deps(true),
    );

    expect(refused.exitCode).toBe(3);
    expect(JSON.parse(refused.stdout[0]!)).toMatchObject({ code: "host_not_retyped" });
    expect(wrong.connectServer).not.toHaveBeenCalled();

    const good = setup({ prompt: ` ${host.toUpperCase()} ` });
    const accepted = await runCatalogImport(
      ["--file", "x", ...serverFlags, ...writeFlags],
      good.deps(true),
    );

    expect(accepted.exitCode).toBe(0);
    expect(good.promptHost).toHaveBeenCalledTimes(1);
  });

  it("needs operator and reason for a write, with the audit rules", async () => {
    const t = setup();
    const missing = await runCatalogImport(["--file", "x", ...serverFlags], t.deps(false));
    const email = await runCatalogImport(
      ["--file", "x", ...serverFlags, "--operator", "M", "--reason", "Wniosek a@b.pl"],
      t.deps(false),
    );

    expect(missing.exitCode).toBe(2);
    expect(email.exitCode).toBe(2);
    expect(t.connectServer).not.toHaveBeenCalled();
  });

  it("refuses when this run has no server support", async () => {
    const t = setup();
    const deps: CatalogImportCommandDeps = { ...t.deps(false), server: undefined };
    const result = await runCatalogImport(["--file", "x", ...serverFlags, ...writeFlags], deps);

    expect(result.exitCode).toBe(3);
    expect(JSON.parse(result.stdout[0]!)).toMatchObject({ code: "server_unavailable" });
  });

  it("refuses the server flags without --target server (local stays local)", async () => {
    const t = setup();

    for (const extra of [
      ["--confirm-host", host],
      ["--operator", "M"],
      ["--reason", "Powód"],
    ]) {
      const result = await runCatalogImport(
        ["--dry-run", "--file", "x", "--org-slug", "a", "--curator-email", "a@b.pl", ...extra],
        t.deps(false),
      );

      expect(result.exitCode).toBe(2);
    }
    expect(t.connectServer).not.toHaveBeenCalled();
    expect(t.connectLocal).not.toHaveBeenCalled();
  });

  it("validates the file alone (no organization flags) without the server dependencies", async () => {
    const t = setup();
    const result = await runCatalogImport(
      ["--dry-run", "--file", "x", "--target", "server", "--profile", "public"],
      t.deps(false),
    );

    expect(result.exitCode).toBe(0);
    expect(t.connectServer).not.toHaveBeenCalled();
  });
});

describe("catalog:import --target server: preview and load", () => {
  it("previews after the host confirmation, writes no audit entry", async () => {
    const preview: CatalogImportOutcome = {
      kind: "preview",
      preview: {
        collections: { create: 1 },
        places: { create: 1 },
        orphanedKeys: { collection: 0, place: 0 },
        collectionLimitExceeded: false,
      },
    };
    const t = setup({ outcome: preview });
    const result = await runCatalogImport(
      ["--dry-run", "--file", "x", ...serverFlags],
      t.deps(false),
    );

    expect(result.exitCode).toBe(0);
    expect(t.run).toHaveBeenCalledWith(expect.objectContaining({ preview: true }));
    expect(t.start).not.toHaveBeenCalled();
    expect(t.finish).not.toHaveBeenCalled();
    expect(t.close).toHaveBeenCalled();
  });

  it("writes the start entry before the load and the result entry after it", async () => {
    const t = setup();
    const result = await runCatalogImport(
      ["--file", "x", ...serverFlags, ...writeFlags],
      t.deps(false),
    );

    expect(result.exitCode).toBe(0);
    expect(t.calls).toEqual(["connect", "start", "run", "finish"]);
    expect(t.start).toHaveBeenCalledWith(
      expect.objectContaining({
        operator: "Mariusz",
        reason: "Pierwsza fala",
        orgSlug: "gmina-a",
        curatorEmail: "kurator@example.com",
        batch: expect.objectContaining({
          operation: "catalog_import",
          fileSha256: sha256Hex(publicFixture),
        }),
      }),
    );
    expect(t.finish).toHaveBeenCalledWith(
      expect.objectContaining({ entryId: "entry-1" }),
      expect.objectContaining({ result: expect.objectContaining({ outcome: "applied" }) }),
    );
    expect(t.run).toHaveBeenCalledWith(expect.objectContaining({ publish: false }));
  });

  it("puts the detailed report on stdout only, never in a file report", async () => {
    const t = setup();
    const result = await runCatalogImport(
      ["--file", "x", ...serverFlags, ...writeFlags],
      t.deps(false),
    );

    expect(result.report).toBeUndefined();
    expect(JSON.parse(result.stdout[1]!)).toHaveProperty("report.collections");
    expect(result.stdout.join("")).not.toContain("@");
  });

  it("uses catalog_remove for --remove", async () => {
    const removed: CatalogImportOutcome = {
      kind: "removed",
      reports: [{ importKey: "col:a", kind: "collection", line: 2, result: "removed" }],
    };
    const t = setup({ outcome: removed });
    const result = await runCatalogImport(
      ["--file", "x", ...serverFlags, ...writeFlags, "--remove"],
      t.deps(false),
    );

    expect(result.exitCode).toBe(0);
    expect(t.start).toHaveBeenCalledWith(
      expect.objectContaining({ batch: expect.objectContaining({ operation: "catalog_remove" }) }),
    );
  });

  it("a failing audit blocks the load: nothing is written", async () => {
    const t = setup({ startError: true });
    const result = await runCatalogImport(
      ["--file", "x", ...serverFlags, ...writeFlags],
      t.deps(false),
    );

    expect(result.exitCode).toBe(1);
    expect(t.run).not.toHaveBeenCalled();
    expect(t.finish).not.toHaveBeenCalled();
    expect(result.stderr.join(" ")).toContain("nic nie wgrano");
    // No connection string or driver message reaches the output.
    expect(result.stderr.join(" ")).not.toContain("postgres://");
    expect(t.close).toHaveBeenCalled();
  });

  it("records a failure of the load as a rejected entry and exits 1", async () => {
    const t = setup({ runError: Object.assign(new Error("boom"), { code: "57014" }) });
    const result = await runCatalogImport(
      ["--file", "x", ...serverFlags, ...writeFlags],
      t.deps(false),
    );

    expect(result.exitCode).toBe(1);
    expect(t.finish).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        result: expect.objectContaining({ outcome: "rejected", code: "import_failed" }),
      }),
    );
  });

  it("survives a failing result entry after a failed load (the original error wins)", async () => {
    const t = setup({ runError: new Error("boom"), finishError: true });
    const result = await runCatalogImport(
      ["--file", "x", ...serverFlags, ...writeFlags],
      t.deps(false),
    );

    expect(result.exitCode).toBe(1);
  });

  it("reports a missing result entry after a successful load as a failure to the owner", async () => {
    const t = setup({ finishError: true });
    const result = await runCatalogImport(
      ["--file", "x", ...serverFlags, ...writeFlags],
      t.deps(false),
    );

    expect(result.exitCode).toBe(1);
    expect(result.stderr.join(" ")).toContain("wpis z wynikiem");
    expect(JSON.parse(result.stdout[0]!)).toMatchObject({ outcome: "applied" });
  });

  it("records a refusal of the use case as a rejected entry (exit 3)", async () => {
    const t = setup({ outcome: { kind: "refused", code: "organization_unavailable" } });
    const result = await runCatalogImport(
      ["--file", "x", ...serverFlags, ...writeFlags],
      t.deps(false),
    );

    expect(result.exitCode).toBe(3);
    expect(t.finish).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        result: expect.objectContaining({ outcome: "rejected", code: "import_refused" }),
      }),
    );
  });
});

describe("the audit entries of the loader", () => {
  const batch: ImportAuditBatch = {
    operation: "catalog_import",
    batchId: "batch-1",
    fileSha256: sha256Hex("abc"),
    collections: 2,
    places: 5,
  };

  it("hashes the file with SHA-256", () => {
    expect(sha256Hex("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });

  it("describes the start with numbers and identifiers only", () => {
    expect(startDetails(batch)).toEqual({
      phase: "start",
      batch_id: "batch-1",
      file_sha256: sha256Hex("abc"),
      profile: "public",
      collections: 2,
      places: 5,
    });
  });

  it("counts the results of a load, including a partial one", () => {
    const result = resultOfOutcome(batch, "e1", {
      kind: "done",
      batchId: "batch-1",
      collections: [
        {
          importKey: "col:a",
          line: 2,
          result: "created",
          composition: "synced",
          places: [
            { importKey: "ext:1", result: "created" },
            { importKey: "ext:2", result: "created" },
          ],
        },
        { importKey: "col:b", line: 3, result: "refused", composition: null, places: [] },
      ],
    });

    expect(result.outcome).toBe("applied");
    expect(result.code).toBeNull();
    expect(result.details).toMatchObject({
      phase: "finish",
      start_entry_id: "e1",
      collection_results: { created: 1, refused: 1 },
      place_results: { created: 2 },
    });
  });

  it("counts the results of a removal by kind", () => {
    const result = resultOfOutcome(batch, "e1", {
      kind: "removed",
      reports: [
        { importKey: "col:a", kind: "collection", line: 2, result: "removed" },
        { importKey: "ext:1", kind: "place", line: 3, result: "removed" },
        { importKey: "ext:2", kind: "place", line: 4, result: "noop" },
      ],
    });

    expect(result.details).toMatchObject({
      collection_results: { removed: 1 },
      place_results: { removed: 1, noop: 1 },
    });
  });

  it("maps refusals to rejected entries and never keeps a preview", () => {
    expect(
      resultOfOutcome(batch, "e1", { kind: "refused", code: "curator_not_found" }),
    ).toMatchObject({ outcome: "rejected", code: "import_refused" });
    expect(
      resultOfOutcome(batch, "e1", { kind: "rejected", code: "unknown_external_key", count: 3 }),
    ).toMatchObject({
      outcome: "rejected",
      details: { refusal: "unknown_external_key", count: 3 },
    });
    expect(() =>
      resultOfOutcome(batch, "e1", {
        kind: "preview",
        preview: {
          collections: {},
          places: {},
          orphanedKeys: { collection: 0, place: 0 },
          collectionLimitExceeded: false,
        },
      }),
    ).toThrow();
  });

  it("keeps only the SQLSTATE class of a failure", () => {
    expect(
      resultOfFailure(batch, "e1", Object.assign(new Error("secret@x.pl"), { code: "57014" })),
    ).toMatchObject({
      outcome: "rejected",
      code: "import_failed",
      details: { sqlstate_class: "57" },
    });

    const plain = resultOfFailure(batch, "e1", new Error("secret@x.pl"));

    expect(plain.details).not.toHaveProperty("sqlstate_class");
    expect(JSON.stringify(plain)).not.toContain("secret");
  });
});
