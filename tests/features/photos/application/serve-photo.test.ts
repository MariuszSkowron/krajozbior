import { describe, expect, it, vi } from "vitest";

import {
  servePhoto,
  type PhotoDeps,
  type PhotoFile,
  type PhotoFileReader,
} from "@/features/photos/application/serve-photo";
import { photoEtag } from "@/features/photos/domain/media-request";
import type { TransactionContext } from "@/lib/db/user-context";

const request = { photoId: "0b6f3a52-7c41-4b7e-9d0a-1c2d3e4f5a6b", size: "main" } as const;
const KEY = "5a6b7c8d-1111-4222-8333-444455556666";
const tx = {} as TransactionContext;
const file: PhotoFile = { body: new ReadableStream<Uint8Array>(), length: 7 };

function makeDeps(over: {
  guest?: string | null;
  user?: string | null;
  actor?: { id: string; role: "user" | "admin" } | null;
  files?: PhotoFileReader | null;
}) {
  const reads: string[] = [];
  const deps: PhotoDeps = {
    withGuestContext: async (work) => {
      reads.push("guest");
      return work(tx);
    },
    withUserContext: async (_actor, work) => {
      reads.push("user");
      return work(tx);
    },
    getActor: vi.fn(async () => over.actor ?? null),
    repository: {
      findReadyPhotoKey: async () =>
        reads.at(-1) === "guest" ? (over.guest ?? null) : (over.user ?? null),
    },
    files: over.files === undefined ? { open: async () => file } : over.files,
  };

  return { deps, reads };
}

describe("servePhoto", () => {
  it("serves a photo a guest may see as public, without asking for the session", async () => {
    const { deps, reads } = makeDeps({ guest: KEY });
    const result = await servePhoto(request, null, deps);

    expect(result).toMatchObject({
      status: "ok",
      visibility: "public",
      etag: photoEtag(KEY, "main"),
    });
    expect(reads).toEqual(["guest"]);
    expect(deps.getActor).not.toHaveBeenCalled();
  });

  it("falls back to the user context only after the guest read missed", async () => {
    const { deps, reads } = makeDeps({ guest: null, user: KEY, actor: { id: "u1", role: "user" } });
    const result = await servePhoto(request, null, deps);

    expect(result).toMatchObject({ status: "ok", visibility: "private" });
    expect(reads).toEqual(["guest", "user"]);
  });

  it("answers not_found for a guest when the guest read missed", async () => {
    const { deps, reads } = makeDeps({ guest: null });

    expect(await servePhoto(request, null, deps)).toEqual({ status: "not_found" });
    expect(reads).toEqual(["guest"]);
  });

  it("answers not_found for a signed-in user who cannot see the photo either", async () => {
    const { deps } = makeDeps({ guest: null, user: null, actor: { id: "u1", role: "user" } });

    expect(await servePhoto(request, null, deps)).toEqual({ status: "not_found" });
  });

  it("answers 304 only after the access decision", async () => {
    const etag = photoEtag(KEY, "main");
    const open = vi.fn(async () => file);
    const allowed = makeDeps({ guest: KEY, files: { open } });

    expect(await servePhoto(request, etag, allowed.deps)).toEqual({
      status: "not_modified",
      visibility: "public",
      etag,
      size: "main",
    });
    expect(open).not.toHaveBeenCalled();

    const denied = makeDeps({ guest: null });

    expect(await servePhoto(request, etag, denied.deps)).toEqual({ status: "not_found" });
  });

  it("answers not_found, never an error, when MEDIA_ROOT is missing", async () => {
    const { deps } = makeDeps({ guest: KEY, files: null });

    expect(await servePhoto(request, null, deps)).toEqual({ status: "not_found" });
  });

  it("answers not_found when the file is missing on disk", async () => {
    const { deps } = makeDeps({ guest: KEY, files: { open: async () => null } });

    expect(await servePhoto(request, null, deps)).toEqual({ status: "not_found" });
  });
});
