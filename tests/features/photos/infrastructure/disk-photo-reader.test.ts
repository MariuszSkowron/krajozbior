import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createDiskPhotoReader } from "@/features/photos/infrastructure/disk-photo-reader";

const KEY = "5a6b7c8d-1111-4222-8333-444455556666";
let root = "";

async function readAll(stream: ReadableStream<Uint8Array>): Promise<string> {
  const chunks: Uint8Array[] = [];

  for await (const chunk of stream as unknown as AsyncIterable<Uint8Array>) {
    chunks.push(chunk);
  }

  return Buffer.concat(chunks).toString("utf8");
}

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "kz-photo-reader-"));
  mkdirSync(join(root, "p", "5a", KEY), { recursive: true });
  writeFileSync(join(root, "p", "5a", KEY, "main.webp"), "main-bytes");
  // `w400.webp` is a directory: it must not be served as a file.
  mkdirSync(join(root, "p", "5a", KEY, "w400.webp"));
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

const OG_KEY = "7c8d9e0f-2222-4333-8444-555566667777";

async function readBytes(stream: ReadableStream<Uint8Array>): Promise<Buffer> {
  const chunks: Uint8Array[] = [];

  for await (const chunk of stream as unknown as AsyncIterable<Uint8Array>) {
    chunks.push(chunk);
  }

  return Buffer.concat(chunks);
}

describe("createDiskPhotoReader og size (E4-3)", () => {
  it("makes the JPEG from the main file on the first request and keeps it next to it", async () => {
    const directory = join(root, "p", "7c", OG_KEY);
    const main = await sharp({
      create: { width: 1600, height: 900, channels: 3, background: { r: 40, g: 90, b: 140 } },
    })
      .webp()
      .toBuffer();

    mkdirSync(directory, { recursive: true });
    writeFileSync(join(directory, "main.webp"), main);

    const reader = createDiskPhotoReader(root);
    const first = await reader.open(OG_KEY, "og");
    const bytes = await readBytes(first!.body);
    const meta = await sharp(bytes).metadata();

    expect(first?.length).toBe(bytes.length);
    expect(meta.format).toBe("jpeg");
    expect(meta.width).toBe(1200);
    expect(bytes.length).toBeLessThanOrEqual(200 * 1024);
    // The result stays on disk: the second request reads the file, it does not encode again.
    expect(existsSync(join(directory, "og.jpg"))).toBe(true);
    expect(readdirSync(directory).filter((name) => name.endsWith(".tmp"))).toEqual([]);

    const second = await reader.open(OG_KEY, "og");

    expect(await readBytes(second!.body)).toEqual(bytes);
  });

  it("serves the og answer even when it cannot be written next to the main file", async () => {
    const key = "8d9e0f1a-3333-4444-8555-666677778888";
    const directory = join(root, "p", "8d", key);
    const main = await sharp({
      create: { width: 800, height: 600, channels: 3, background: { r: 1, g: 2, b: 3 } },
    })
      .webp()
      .toBuffer();

    mkdirSync(directory, { recursive: true });
    writeFileSync(join(directory, "main.webp"), main);
    // `og.jpg` is a directory, so a rename onto it fails; the answer must still come out.
    mkdirSync(join(directory, "og.jpg"));

    const file = await createDiskPhotoReader(root).open(key, "og");

    expect(file).not.toBeNull();
    expect((await sharp(await readBytes(file!.body)).metadata()).format).toBe("jpeg");
  });

  it("is null when there is no main file to make it from", async () => {
    expect(
      await createDiskPhotoReader(root).open("9e0f1a2b-4444-4555-8666-777788889999", "og"),
    ).toBeNull();
  });

  it("is null for a main file that is not an image it can encode, and for one over the budget", async () => {
    const broken = "ab0f1a2b-5555-4666-8777-88889999aaaa";
    const big = "bc1f2a3b-6666-4777-8888-9999aaaabbbb";

    mkdirSync(join(root, "p", "ab", broken), { recursive: true });
    writeFileSync(join(root, "p", "ab", broken, "main.webp"), "to nie jest obraz");
    mkdirSync(join(root, "p", "bc", big), { recursive: true });
    writeFileSync(join(root, "p", "bc", big, "main.webp"), Buffer.alloc(400 * 1024));

    const reader = createDiskPhotoReader(root);

    expect(await reader.open(broken, "og")).toBeNull();
    expect(await reader.open(big, "og")).toBeNull();
  });
});

describe("createDiskPhotoReader", () => {
  it("streams the file with its length", async () => {
    const file = await createDiskPhotoReader(root).open(KEY, "main");

    expect(file?.length).toBe(10);
    expect(await readAll(file!.body)).toBe("main-bytes");
  });

  it("returns null for a missing file, a missing root and a directory", async () => {
    const reader = createDiskPhotoReader(root);

    expect(await createDiskPhotoReader(join(root, "nie-ma")).open(KEY, "main")).toBeNull();
    expect(await reader.open("11111111-1111-4111-8111-111111111111", "main")).toBeNull();
    expect(await reader.open(KEY, "w400")).toBeNull();
  });

  it("builds the path only from a canonical UUID key", async () => {
    const reader = createDiskPhotoReader(root);

    expect(await reader.open("../../../etc/passwd", "main")).toBeNull();
    expect(await reader.open(KEY.toUpperCase(), "main")).toBeNull();
    expect(await reader.open(`${KEY}/../${KEY}`, "main")).toBeNull();
  });
});
