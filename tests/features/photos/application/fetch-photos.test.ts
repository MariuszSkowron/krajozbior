import { describe, expect, it, vi } from "vitest";

import { MediaProcessingError } from "@/features/media/domain/processing-error";
import type { ProcessedImage } from "@/features/media/infrastructure/image-processor";
import {
  fetchCommonsPhotos,
  MAX_FETCH_ATTEMPTS,
  MIN_REQUEST_INTERVAL_MS,
  requeueMissingFiles,
  type PendingPhoto,
  type PhotoFetchDeps,
  type PhotoFetchRepository,
} from "@/features/photos/application/fetch-photos";

const processed: ProcessedImage = {
  main: new Uint8Array([1, 2, 3]),
  thumb: new Uint8Array([4]),
  width: 1280,
  height: 853,
  quality: 80,
};

const photo = (overrides: Partial<PendingPhoto> = {}): PendingPhoto => ({
  id: "photo-1",
  commonsFile: "Example.jpg",
  sourceWidth: 3000,
  fetchAttempts: 0,
  ...overrides,
});

function setup(
  rows: PendingPhoto[],
  overrides: Partial<PhotoFetchDeps> = {},
  repositoryOverrides: Partial<PhotoFetchRepository> = {},
) {
  const repository: PhotoFetchRepository = {
    listPending: vi.fn(async () => rows),
    markReady: vi.fn(async () => "ok" as const),
    recordFailure: vi.fn(async () => undefined),
    countPending: vi.fn(async () => 0),
    listReady: vi.fn(async () => []),
    requeue: vi.fn(async () => undefined),
    ...repositoryOverrides,
  };
  const storage = {
    store: vi.fn(async () => undefined),
    remove: vi.fn(async () => undefined),
    exists: vi.fn(async () => true),
    diskSpace: vi.fn(async () => ({ freeBytes: 1, totalBytes: 1 })),
  };
  const deps: PhotoFetchDeps = {
    repository,
    download: vi.fn(async () => ({ ok: true as const, bytes: new Uint8Array([7]) })),
    process: vi.fn(async () => processed),
    storage,
    checkSpace: vi.fn(async () => ({ ok: true as const, freePercent: 50 })),
    sleep: vi.fn(async () => undefined),
    now: () => 0,
    newKey: () => "11111111-1111-4111-8111-111111111111",
    ...overrides,
  };

  return { deps, repository, storage };
}

describe("fetchCommonsPhotos", () => {
  it("downloads the thumbnail built from the file name, processes it and marks the row ready", async () => {
    const { deps, repository, storage } = setup([photo()]);
    const report = await fetchCommonsPhotos(deps, { limit: 10 });

    expect(deps.download).toHaveBeenCalledWith(
      "https://upload.wikimedia.org/wikipedia/commons/thumb/a/a9/Example.jpg/1920px-Example.jpg",
    );
    expect(storage.store).toHaveBeenCalledWith("place", "11111111-1111-4111-8111-111111111111", {
      main: processed.main,
      w400: processed.thumb,
    });
    expect(repository.markReady).toHaveBeenCalledWith(
      "photo-1",
      expect.objectContaining({
        storageKey: "11111111-1111-4111-8111-111111111111",
        width: 1280,
        height: 853,
      }),
    );
    expect(report).toEqual({ fetched: 1, failed: 0, skipped: 0, remaining: 0, reasons: {} });
    expect(repository.listPending).toHaveBeenCalledWith({ limit: 10, retryFailed: false });
  });

  it("passes the options to the list and uses the default limit", async () => {
    const { deps, repository } = setup([]);

    await fetchCommonsPhotos(deps, { retryFailed: true, organizationSlug: "gmina-a" });

    expect(repository.listPending).toHaveBeenCalledWith({
      limit: 300,
      retryFailed: true,
      organizationSlug: "gmina-a",
    });
  });

  it("counts a failed attempt and keeps the row pending until the third one", async () => {
    const download = vi.fn(async () => ({ ok: false as const, reason: "http_error" as const }));
    const { deps, repository } = setup([photo({ fetchAttempts: 1 })], { download });
    const report = await fetchCommonsPhotos(deps);

    expect(repository.recordFailure).toHaveBeenCalledWith("photo-1", 2, "pending_fetch");
    expect(report).toMatchObject({ fetched: 0, failed: 1, reasons: { http_error: 1 } });

    const last = setup([photo({ fetchAttempts: MAX_FETCH_ATTEMPTS - 1 })], { download });

    await fetchCommonsPhotos(last.deps);

    expect(last.repository.recordFailure).toHaveBeenCalledWith("photo-1", 3, "fetch_failed");
  });

  it("fails a row without a usable source width without a request", async () => {
    for (const sourceWidth of [null, 10]) {
      const { deps, repository } = setup([photo({ sourceWidth })]);
      const report = await fetchCommonsPhotos(deps);

      expect(deps.download).not.toHaveBeenCalled();
      expect(report.reasons).toEqual({ bad_source: 1 });
      expect(repository.recordFailure).toHaveBeenCalledWith("photo-1", 1, "pending_fetch");
    }
  });

  it("reports the code of a processing refusal (a WebP, for instance) and any other error", async () => {
    const refused = setup([photo()], {
      process: vi.fn(async () => {
        throw new MediaProcessingError("unsupported_type");
      }),
    });

    expect((await fetchCommonsPhotos(refused.deps)).reasons).toEqual({ unsupported_type: 1 });
    expect(refused.storage.store).not.toHaveBeenCalled();

    const broken = setup([photo()], {
      process: vi.fn(async () => {
        throw new Error("boom");
      }),
    });

    expect((await fetchCommonsPhotos(broken.deps)).reasons).toEqual({ processing_failed: 1 });
  });

  it("fails the attempt when the files cannot be stored", async () => {
    const { deps, repository } = setup([photo()], {
      storage: {
        store: vi.fn(async () => {
          throw new Error("disk");
        }),
        remove: vi.fn(async () => undefined),
        exists: vi.fn(),
        diskSpace: vi.fn(),
      },
    });
    const report = await fetchCommonsPhotos(deps);

    expect(report.reasons).toEqual({ storage_failed: 1 });
    expect(repository.markReady).not.toHaveBeenCalled();
  });

  it("removes the files and ends a duplicate image for good", async () => {
    const { deps, repository, storage } = setup([photo()], undefined, {
      markReady: vi.fn(async () => "duplicate" as const),
    });
    const report = await fetchCommonsPhotos(deps);

    expect(storage.remove).toHaveBeenCalledWith("place", "11111111-1111-4111-8111-111111111111");
    expect(repository.recordFailure).toHaveBeenCalledWith("photo-1", 1, "fetch_failed");
    expect(report.reasons).toEqual({ duplicate: 1 });
  });

  it("removes the files and rethrows when the database refuses the update", async () => {
    const { deps, storage } = setup([photo()], undefined, {
      markReady: vi.fn(async () => {
        throw new Error("db");
      }),
    });

    await expect(fetchCommonsPhotos(deps)).rejects.toThrow("db");
    expect(storage.remove).toHaveBeenCalledTimes(1);
  });

  it("stops before the next file when there is no space and reports what it left", async () => {
    const checkSpace = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, freePercent: 40 })
      .mockResolvedValueOnce({ ok: false, reason: "uploads_paused", freePercent: 5 });
    const { deps } = setup([photo({ id: "a" }), photo({ id: "b" }), photo({ id: "c" })], {
      checkSpace,
    });
    const report = await fetchCommonsPhotos(deps);

    expect(report).toMatchObject({ fetched: 1, skipped: 2, stoppedBy: "uploads_paused" });
  });

  it("keeps at most one request per second", async () => {
    let clock = 10_000;
    const sleep = vi.fn(async (milliseconds: number) => {
      clock += milliseconds;
    });
    const { deps } = setup([photo({ id: "a" }), photo({ id: "b" }), photo({ id: "c" })], {
      now: () => clock,
      sleep,
    });

    await fetchCommonsPhotos(deps);

    // Przed drugim i trzecim plikiem zegar stoi, więc czekamy pełną sekundę; przed pierwszym nie.
    expect(sleep.mock.calls.map(([milliseconds]) => milliseconds)).toEqual([
      MIN_REQUEST_INTERVAL_MS,
      MIN_REQUEST_INTERVAL_MS,
    ]);
  });

  it("does not wait when enough time already passed", async () => {
    const { deps } = setup([photo({ id: "a" }), photo({ id: "b" })], {
      now: vi.fn().mockReturnValueOnce(0).mockReturnValue(5000),
    });

    await fetchCommonsPhotos(deps);

    expect(deps.sleep).not.toHaveBeenCalled();
  });

  it("returns what is still pending", async () => {
    const { deps } = setup([], undefined, { countPending: vi.fn(async () => 42) });

    expect((await fetchCommonsPhotos(deps)).remaining).toBe(42);
  });
});

describe("requeueMissingFiles", () => {
  it("sends back only the rows whose main file is gone", async () => {
    const { repository, storage } = setup([], undefined, {
      listReady: vi.fn(async () => [
        { id: "a", storageKey: "key-a" },
        { id: "b", storageKey: "key-b" },
      ]),
    });

    const exists = vi.fn(async (_kind: string, key: string) => key !== "key-b");

    expect(await requeueMissingFiles(repository, { ...storage, exists })).toBe(1);
    expect(repository.requeue).toHaveBeenCalledTimes(1);
    expect(repository.requeue).toHaveBeenCalledWith("b");
  });
});
