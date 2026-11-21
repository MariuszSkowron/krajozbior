import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Wymuszamy błąd drugiej podmiany (`rename` do pliku docelowego), żeby sprawdzić przywracanie.
const control = vi.hoisted(() => ({ failTargetsMatching: "" }));

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    rename: async (from: string, to: string) => {
      if (
        control.failTargetsMatching &&
        String(from).endsWith(".tmp") &&
        String(to).endsWith(control.failTargetsMatching)
      ) {
        throw new Error("wymuszony błąd rename");
      }
      return actual.rename(from, to);
    },
  };
});

const { DiskMediaStorage } = await import("@/features/media/infrastructure/disk-media-storage");

const KEY = "a1b2c3d4-e5f6-4789-8abc-0123456789ab";
const bytes = (text: string) => new TextEncoder().encode(text);

describe("DiskMediaStorage: nadpisanie przy błędzie", () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "krajozbior-rollback-"));
    control.failTargetsMatching = "";
  });

  afterEach(async () => {
    control.failTargetsMatching = "";
    await rm(root, { recursive: true, force: true });
  });

  it("zostawia wcześniejsze zdjęcie w całości, gdy podmiana pada w połowie", async () => {
    const storage = new DiskMediaStorage(root);
    await storage.store("place", KEY, { main: bytes("stary-glowny"), w400: bytes("stara-mini") });
    control.failTargetsMatching = "w400.webp";
    await expect(
      storage.store("place", KEY, { main: bytes("nowy-glowny"), w400: bytes("nowa-mini") }),
    ).rejects.toThrow("wymuszony błąd rename");
    control.failTargetsMatching = "";
    const dir = join(root, "p", "a1", KEY);
    expect(await readFile(join(dir, "main.webp"), "utf8")).toBe("stary-glowny");
    expect(await readFile(join(dir, "w400.webp"), "utf8")).toBe("stara-mini");
    expect(await readdir(storage.tmpDirectory)).toEqual([]);
  });

  it("dla nowego klucza po błędzie nie zostawia żadnych plików", async () => {
    const storage = new DiskMediaStorage(root);
    control.failTargetsMatching = "w400.webp";
    await expect(
      storage.store("place", KEY, { main: bytes("a"), w400: bytes("b") }),
    ).rejects.toThrow();
    expect(await storage.exists("place", KEY, "main")).toBe(false);
    expect(await storage.exists("place", KEY, "w400")).toBe(false);
    expect(await readdir(storage.tmpDirectory)).toEqual([]);
  });
});
