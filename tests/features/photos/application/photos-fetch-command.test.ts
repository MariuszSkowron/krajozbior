import { describe, expect, it, vi } from "vitest";

import type { PhotoFetchDeps } from "@/features/photos/application/fetch-photos";
import {
  parsePhotosFetchArgs,
  runPhotosFetch,
  type PhotosSession,
} from "@/features/photos/application/photos-fetch-command";
import type { AuditEntry } from "@/lib/db/operations-audit";

const REQUIRED = ["--operator", "wlasciciel", "--reason", "Pobranie zdjec z Commons"];

function setup(
  options: {
    locked?: boolean;
    pending?: number;
    listPending?: () => Promise<never[]>;
    open?: () => Promise<void>;
    audit?: (entry: AuditEntry) => Promise<void>;
  } = {},
) {
  const entries: AuditEntry[] = [];
  const session: PhotosSession = {
    tryLock: vi.fn(async () => options.locked ?? true),
    writeAudit: vi.fn(async (entry) => {
      await options.audit?.(entry);
      entries.push(entry);
    }),
    close: vi.fn(async () => undefined),
  };
  const fetch = {
    repository: {
      listPending: options.listPending ?? vi.fn(async () => []),
      markReady: vi.fn(),
      recordFailure: vi.fn(),
      countPending: vi.fn(async () => options.pending ?? 0),
      listReady: vi.fn(async () => [{ id: "x", storageKey: "k" }]),
      requeue: vi.fn(async () => undefined),
    },
    download: vi.fn(),
    process: vi.fn(),
    storage: {
      store: vi.fn(),
      remove: vi.fn(),
      exists: vi.fn(async () => false),
      read: vi.fn(async (_kind: string, _key: string, variant: string) =>
        variant === "main" ? new Uint8Array([1]) : null,
      ),
      storeOg: vi.fn(async () => undefined),
      diskSpace: vi.fn(),
    },
    makeOg: vi.fn(async () => new Uint8Array([9])),
    checkSpace: vi.fn(async () => ({ ok: true as const, freePercent: 50 })),
    sleep: vi.fn(),
  } as unknown as PhotoFetchDeps;
  const openSession = vi.fn(async () => {
    await options.open?.();

    return { session, fetch };
  });

  return { entries, session, fetch, openSession };
}

describe("parsePhotosFetchArgs", () => {
  it("reads the options", () => {
    expect(
      parsePhotosFetchArgs([
        "--",
        ...REQUIRED,
        "--limit",
        "50",
        "--org-slug",
        "gmina-a",
        "--retry-failed",
        "--refetch-missing",
      ]),
    ).toEqual({
      ok: true,
      args: {
        operator: "wlasciciel",
        reason: "Pobranie zdjec z Commons",
        limit: 50,
        retryFailed: true,
        refetchMissing: true,
        backfillOg: false,
        organizationSlug: "gmina-a",
      },
    });
  });

  it("uses the default limit and no switches", () => {
    expect(parsePhotosFetchArgs(REQUIRED)).toMatchObject({
      ok: true,
      args: { limit: 300, retryFailed: false, refetchMissing: false, backfillOg: false },
    });
  });

  it("reads the --backfill-og switch", () => {
    expect(parsePhotosFetchArgs([...REQUIRED, "--backfill-og"])).toMatchObject({
      ok: true,
      args: { backfillOg: true },
    });
  });

  it.each([
    ["no operator", ["--reason", "powod"]],
    ["no reason", ["--operator", "ja"]],
    ["an e-mail in the reason", ["--operator", "ja", "--reason", "a@b.pl"]],
    ["an unknown flag", [...REQUIRED, "--force"]],
    ["a flag without a value", [...REQUIRED, "--limit"]],
    ["a flag followed by a flag", [...REQUIRED, "--limit", "--retry-failed"]],
    ["a limit of zero", [...REQUIRED, "--limit", "0"]],
    ["a limit above the maximum", [...REQUIRED, "--limit", "5001"]],
    ["a limit that is not an integer", [...REQUIRED, "--limit", "2.5"]],
    ["a bad slug", [...REQUIRED, "--org-slug", "Gmina A"]],
  ])("refuses %s", (_name, argv) => {
    expect(parsePhotosFetchArgs(argv).ok).toBe(false);
  });
});

describe("runPhotosFetch", () => {
  it("refuses bad arguments before opening anything", async () => {
    const { openSession } = setup();
    const output = await runPhotosFetch(["--limit", "x"], { openSession });

    expect(output.exitCode).toBe(2);
    expect(openSession).not.toHaveBeenCalled();
  });

  it("answers with code 1 when the session cannot be opened", async () => {
    const { openSession } = setup({
      open: async () => {
        throw new Error("no database");
      },
    });

    expect((await runPhotosFetch(REQUIRED, { openSession })).exitCode).toBe(1);
  });

  it("refuses a second run while the lock is held, and writes no audit entry", async () => {
    const { openSession, entries, session } = setup({ locked: false });
    const output = await runPhotosFetch(REQUIRED, { openSession });

    expect(output.exitCode).toBe(3);
    expect(output.stderr.join(" ")).toContain("Poprzednie pobieranie jeszcze trwa");
    expect(entries).toHaveLength(0);
    expect(session.close).toHaveBeenCalled();
  });

  it("fills in the og files only with --backfill-og and reports the numbers", async () => {
    const without = setup();

    await runPhotosFetch(REQUIRED, { openSession: without.openSession });

    expect(without.fetch.storage.storeOg).not.toHaveBeenCalled();
    expect(without.entries[0]?.details).not.toHaveProperty("og_created");

    const { openSession, entries, fetch } = setup();
    const output = await runPhotosFetch([...REQUIRED, "--backfill-og"], { openSession });

    expect(output.exitCode).toBe(0);
    expect(fetch.makeOg).toHaveBeenCalledTimes(1);
    expect(fetch.storage.storeOg).toHaveBeenCalledWith("place", "k", new Uint8Array([9]));
    expect(JSON.parse(output.stdout[0]!)).toMatchObject({ ogCreated: 1, ogFailed: 0 });
    expect(entries[0]?.details).toMatchObject({ og_created: 1, og_failed: 0 });
  });

  it("runs, writes one audit entry with numbers only and prints the summary", async () => {
    const { openSession, entries, session } = setup({ pending: 7 });
    const output = await runPhotosFetch([...REQUIRED, "--refetch-missing"], { openSession });

    expect(output.exitCode).toBe(0);
    expect(JSON.parse(output.stdout[0]!)).toMatchObject({
      outcome: "applied",
      fetched: 0,
      remaining: 7,
      requeued: 1,
    });
    expect(output.stderr.join(" ")).toContain("Zostało 7");
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      operation: "photos_fetch",
      operator: "wlasciciel",
      outcome: "applied",
      code: null,
      details: { phase: "finish", fetched: 0, remaining: 7, requeued: 1, retry_failed: false },
    });
    expect(session.close).toHaveBeenCalled();
  });

  it("says when the run was paused for lack of disk space", async () => {
    const { openSession, fetch } = setup();

    (fetch.repository.listPending as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: "a", commonsFile: "A.jpg", sourceWidth: 3000, fetchAttempts: 0 },
    ]);
    (fetch.checkSpace as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      reason: "uploads_paused",
      freePercent: 3,
    });

    const output = await runPhotosFetch(REQUIRED, { openSession });

    expect(output.exitCode).toBe(0);
    expect(output.stderr.join(" ")).toContain("wstrzymano");
  });

  it("writes a rejected entry with the SQLSTATE class only when the run fails", async () => {
    const { openSession, entries } = setup({
      listPending: async () => {
        throw Object.assign(new Error("secret detail"), { code: "57014" });
      },
    });
    const output = await runPhotosFetch(REQUIRED, { openSession });

    expect(output.exitCode).toBe(1);
    expect(output.stderr.join(" ")).not.toContain("secret");
    expect(entries[0]).toMatchObject({
      outcome: "rejected",
      code: "photos_fetch_failed",
      details: { phase: "finish", sqlstate_class: "57" },
    });
  });

  it("does not let a failing audit write hide the failure", async () => {
    const { openSession } = setup({
      listPending: async () => {
        throw new Error("boom");
      },
      audit: async () => {
        throw new Error("audit down");
      },
    });

    expect((await runPhotosFetch(REQUIRED, { openSession })).exitCode).toBe(1);
  });
});
