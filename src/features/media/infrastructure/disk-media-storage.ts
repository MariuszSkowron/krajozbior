import { randomUUID } from "node:crypto";
import { mkdir, open, rename, rm, stat, statfs, unlink } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";

import type { MediaFiles, MediaStorage } from "../application/media-storage";
import type { DiskSpace } from "../domain/free-space";
import {
  mediaDirectory,
  mediaFilePath,
  type MediaKind,
  type MediaVariant,
} from "../domain/media-key";

const DIRECTORY_MODE = 0o700;
const FILE_MODE = 0o600;

/** Adapter dyskowy: zapis do `tmp/` na tym samym systemie plików, `fsync`, potem `rename` (5.3 krok 7). */
export class DiskMediaStorage implements MediaStorage {
  private readonly root: string;

  constructor(root: string) {
    this.root = resolve(root);
  }

  /** Katalog plików tymczasowych (też wejść procesu potomnego), na tym samym systemie plików. */
  get tmpDirectory(): string {
    return join(this.root, "tmp");
  }

  async store(kind: MediaKind, key: string, files: MediaFiles): Promise<void> {
    const entries: [MediaVariant, Uint8Array][] = [
      ["main", files.main],
      ["w400", files.w400],
    ];
    if (files.og) entries.push(["og", files.og]);
    await mkdir(this.tmpDirectory, { recursive: true, mode: DIRECTORY_MODE });
    await mkdir(this.inside(mediaDirectory(kind, key)), { recursive: true, mode: DIRECTORY_MODE });
    const staged: { tmp: string; target: string; backup?: string; placed: boolean }[] = [];
    try {
      // 1. Komplet do plików tymczasowych; cel może istnieć tylko jako zwykły plik.
      for (const [variant, bytes] of entries) {
        const tmp = join(this.tmpDirectory, `${randomUUID()}.tmp`);
        const target = this.inside(mediaFilePath(kind, key, variant));
        staged.push({ tmp, target, placed: false });
        await writeSynced(tmp, bytes);
        const existing = await stat(target).catch(() => undefined);
        if (existing && !existing.isFile()) throw new Error("Cel zapisu nie jest plikiem.");
      }
      // 2. Podmiana: stare pliki idą do kopii w tmp/, żeby błąd mógł je przywrócić.
      for (const item of staged) {
        if (await exists(item.target)) {
          item.backup = join(this.tmpDirectory, `${randomUUID()}.bak`);
          await rename(item.target, item.backup);
        }
        await rename(item.tmp, item.target);
        item.placed = true;
      }
      await syncDirectory(dirname(staged[0].target));
    } catch (error) {
      for (const item of staged) {
        await unlink(item.tmp).catch(() => undefined);
        if (item.placed) await unlink(item.target).catch(() => undefined);
        if (item.backup) await rename(item.backup, item.target).catch(() => undefined);
      }
      throw error;
    }
    await Promise.all(
      staged.map(({ backup }) => (backup ? unlink(backup).catch(() => undefined) : undefined)),
    );
  }

  async read(kind: MediaKind, key: string, variant: MediaVariant): Promise<Uint8Array | null> {
    try {
      const path = this.inside(mediaFilePath(kind, key, variant));
      // Jeden uchwyt: sprawdzenie i odczyt dotyczą tego samego pliku.
      const handle = await open(path, "r");
      try {
        const info = await handle.stat();
        if (!info.isFile() || info.size === 0) return null;
        return await handle.readFile();
      } finally {
        await handle.close();
      }
    } catch {
      return null;
    }
  }

  async storeOg(kind: MediaKind, key: string, og: Uint8Array): Promise<void> {
    await mkdir(this.tmpDirectory, { recursive: true, mode: DIRECTORY_MODE });
    const target = this.inside(mediaFilePath(kind, key, "og"));
    const tmp = join(this.tmpDirectory, `${randomUUID()}.tmp`);
    try {
      await writeSynced(tmp, og);
      // `rename` pliku na katalog kończy się błędem, więc osobne sprawdzenie celu nie jest potrzebne.
      await rename(tmp, target);
    } catch (error) {
      await unlink(tmp).catch(() => undefined);
      throw error;
    }
    await syncDirectory(dirname(target));
  }

  async remove(kind: MediaKind, key: string): Promise<void> {
    await rm(this.inside(mediaDirectory(kind, key)), { recursive: true, force: true });
  }

  async exists(kind: MediaKind, key: string, variant: MediaVariant): Promise<boolean> {
    try {
      return (await stat(this.inside(mediaFilePath(kind, key, variant)))).isFile();
    } catch {
      return false;
    }
  }

  async diskSpace(): Promise<DiskSpace> {
    await mkdir(this.root, { recursive: true, mode: DIRECTORY_MODE });
    const fsStats = await statfs(this.root);
    return {
      freeBytes: Number(fsStats.bavail) * Number(fsStats.bsize),
      totalBytes: Number(fsStats.blocks) * Number(fsStats.bsize),
    };
  }

  /** Zwraca ścieżkę bezwzględną i pilnuje, żeby leżała w `MEDIA_ROOT`. */
  private inside(relative: string): string {
    const full = resolve(this.root, relative);
    if (!full.startsWith(this.root + sep) && full !== this.root) {
      throw new Error("Ścieżka poza katalogiem zdjęć.");
    }
    return full;
  }
}

async function exists(path: string): Promise<boolean> {
  return (await stat(path).catch(() => undefined)) !== undefined;
}

/** `fsync` katalogu po `rename` (trwałość po zaniku zasilania); na Windows nie jest dostępny. */
async function syncDirectory(path: string): Promise<void> {
  if (process.platform === "win32") return;
  try {
    const handle = await open(path, "r");
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
  } catch {
    // Platforma albo system plików nie pozwala: trwałość katalogu to dodatek, nie warunek zapisu.
  }
}

async function writeSynced(path: string, bytes: Uint8Array): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: DIRECTORY_MODE });
  const handle = await open(path, "wx", FILE_MODE);
  try {
    await handle.writeFile(bytes);
    await handle.sync();
  } finally {
    await handle.close();
  }
}
