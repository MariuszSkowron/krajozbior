import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { evaluateFreeSpace } from "@/features/media/domain/free-space";
import { DiskMediaStorage } from "@/features/media/infrastructure/disk-media-storage";

const KEY = "a1b2c3d4-e5f6-4789-8abc-0123456789ab";
const bytes = (text: string) => new TextEncoder().encode(text);

describe("DiskMediaStorage", () => {
  let root: string;
  let storage: DiskMediaStorage;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "krajozbior-storage-"));
    storage = new DiskMediaStorage(root);
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("zapisuje pliki pod {p|e}/{2 znaki}/{klucz}/ i nie zostawia plików w tmp/", async () => {
    await storage.store("place", KEY, {
      main: bytes("glowny"),
      w400: bytes("mini"),
      og: bytes("og"),
    });
    const dir = join(root, "p", "a1", KEY);
    expect(await readFile(join(dir, "main.webp"), "utf8")).toBe("glowny");
    expect(await readFile(join(dir, "w400.webp"), "utf8")).toBe("mini");
    expect(await readFile(join(dir, "og.jpg"), "utf8")).toBe("og");
    expect(await readdir(storage.tmpDirectory)).toEqual([]);
    expect(await storage.exists("place", KEY, "main")).toBe(true);
    expect(await storage.exists("place", KEY, "og")).toBe(true);
  });

  it("zdjęcia odkrywców idą do katalogu e/, bez og gdy go nie ma", async () => {
    await storage.store("explorer", KEY, { main: bytes("a"), w400: bytes("b") });
    expect(await storage.exists("explorer", KEY, "main")).toBe(true);
    expect(await storage.exists("explorer", KEY, "og")).toBe(false);
    expect(await storage.exists("place", KEY, "main")).toBe(false);
  });

  it("katalogi mają uprawnienia 0700 (poza Windows)", async () => {
    await storage.store("place", KEY, { main: bytes("a"), w400: bytes("b") });
    if (process.platform === "win32") return;
    expect((await stat(join(root, "p", "a1", KEY))).mode & 0o777).toBe(0o700);
    expect((await stat(join(root, "p", "a1", KEY, "main.webp"))).mode & 0o777).toBe(0o600);
  });

  it("nadpisuje istniejące zdjęcie atomowo (rename)", async () => {
    await storage.store("place", KEY, { main: bytes("stary"), w400: bytes("stary") });
    await storage.store("place", KEY, { main: bytes("nowy"), w400: bytes("nowy") });
    expect(await readFile(join(root, "p", "a1", KEY, "main.webp"), "utf8")).toBe("nowy");
  });

  it("remove usuwa katalog zdjęcia, a brak katalogu nie jest błędem", async () => {
    await storage.store("place", KEY, { main: bytes("a"), w400: bytes("b") });
    await storage.remove("place", KEY);
    expect(await storage.exists("place", KEY, "main")).toBe(false);
    await expect(storage.remove("place", KEY)).resolves.toBeUndefined();
  });

  it("przy błędzie zapisu sprząta po sobie i zgłasza błąd", async () => {
    // Plik zamiast katalogu na ścieżce docelowej uniemożliwia rename.
    await storage.store("place", KEY, { main: bytes("a"), w400: bytes("b") });
    await rm(join(root, "p", "a1", KEY), { recursive: true });
    await writeFile(join(root, "p", "a1", KEY), "to jest plik");
    await expect(
      storage.store("place", KEY, { main: bytes("x"), w400: bytes("y") }),
    ).rejects.toThrow();
    expect(await readdir(storage.tmpDirectory)).toEqual([]);
  });

  it("przy błędzie rename usuwa pliki tymczasowe i częściowo zapisane zdjęcie", async () => {
    // Niepusty katalog w miejscu pliku docelowego `w400.webp`: rename pliku na katalog się nie uda.
    await mkdir(join(root, "p", "a1", KEY, "w400.webp", "zajety"), { recursive: true });
    await expect(
      storage.store("place", KEY, { main: bytes("x"), w400: bytes("y") }),
    ).rejects.toThrow();
    expect(await readdir(storage.tmpDirectory)).toEqual([]);
    expect(await storage.exists("place", KEY, "main")).toBe(false);
  });

  it("odrzuca klucze wychodzące poza katalog zdjęć", async () => {
    await expect(
      storage.store("place", "../../../poza", { main: bytes("a"), w400: bytes("b") }),
    ).rejects.toThrow("Nieprawidłowy klucz");
    await expect(storage.remove("place", "../x")).rejects.toThrow("Nieprawidłowy klucz");
    expect(await storage.exists("place", "../x", "main")).toBe(false);
  });

  it("mierzy wolne i całkowite miejsce wolumenu (strażnik)", async () => {
    const space = await storage.diskSpace();
    expect(space.totalBytes).toBeGreaterThan(0);
    expect(space.freeBytes).toBeGreaterThanOrEqual(0);
    expect(space.freeBytes).toBeLessThanOrEqual(space.totalBytes);
    expect(evaluateFreeSpace(space, 0).ok).toBe(true);
    expect(evaluateFreeSpace(space, 101).ok).toBe(false);
  });
});
