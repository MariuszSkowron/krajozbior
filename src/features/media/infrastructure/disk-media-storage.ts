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
    const staged: { tmp: string; target: string }[] = [];
    try {
      for (const [variant, bytes] of entries) {
        const tmp = join(this.tmpDirectory, `${randomUUID()}.tmp`);
        staged.push({ tmp, target: this.inside(mediaFilePath(kind, key, variant)) });
        await writeSynced(tmp, bytes);
      }
      for (const { tmp, target } of staged) await rename(tmp, target);
    } catch (error) {
      await Promise.all(staged.map(({ tmp }) => unlink(tmp).catch(() => undefined)));
      await this.remove(kind, key);
      throw error;
    }
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
