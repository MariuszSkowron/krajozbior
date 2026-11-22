import { describe, expect, it, vi } from "vitest";

const getDeps = vi.hoisted(() => vi.fn());

vi.mock("@/features/photos/infrastructure/photo-deps", () => ({ getPhotoDeps: getDeps }));

import { handleMediaRequest } from "@/features/photos/http/media-http";

const ID = "0b6f3a52-7c41-4b7e-9d0a-1c2d3e4f5a6b";
const request = () => new Request(`http://localhost/media/p/${ID}/main`);

describe("handleMediaRequest", () => {
  it("answers a bad address with the uncacheable 404 and never builds the dependencies", async () => {
    for (const parts of [
      ["e", ID, "main"],
      ["p", "..", "main"],
      ["p", ID.toUpperCase(), "main"],
      ["p", ID, "og.jpg"],
      ["p", ID, "OG"],
      // A wrong number of segments (catch-all route): the same 404, never a page.
      [],
      ["p"],
      ["p", "x"],
      ["p", ID, "main", "x"],
      ["a", "b", "c", "d"],
    ]) {
      const response = await handleMediaRequest(request(), parts);

      expect(response.status).toBe(404);
      expect(response.headers.get("cache-control")).toBe("private, no-store");
      expect(response.headers.get("content-type")).toBe("text/plain; charset=utf-8");
      expect(response.headers.get("content-security-policy")).toBe("default-src 'none'; sandbox");
      expect(await response.text()).toBe("Nie znaleziono.");
    }

    expect(getDeps).not.toHaveBeenCalled();
  });

  it("serves the og size as a JPEG and answers 304 with the headers of the same size (E4-3)", async () => {
    const KEY = "5a6b7c8d-1111-4222-8333-444455556666";
    const open = vi.fn(async () => ({
      body: new Response("jpeg-bytes").body!,
      length: 10,
    }));

    getDeps.mockReturnValue({
      withGuestContext: async (work: (tx: unknown) => Promise<unknown>) => work({}),
      withUserContext: async () => null,
      getActor: async () => null,
      repository: { findReadyPhotoKey: async () => KEY },
      files: { open },
    });

    const response = await handleMediaRequest(request(), ["p", ID, "og"]);

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/jpeg");
    expect(response.headers.get("cache-control")).toBe("public, max-age=86400");
    expect(response.headers.get("cross-origin-resource-policy")).toBe("cross-origin");
    expect(open).toHaveBeenCalledWith(KEY, "og");

    const etag = response.headers.get("etag")!;
    const cached = await handleMediaRequest(
      new Request(`http://localhost/media/p/${ID}/og`, { headers: { "if-none-match": etag } }),
      ["p", ID, "og"],
    );

    expect(cached.status).toBe(304);
    expect(cached.headers.get("content-type")).toBeNull();
    expect(cached.headers.get("etag")).toBe(etag);
  });

  it("answers 503 without details when the database fails", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    getDeps.mockReturnValue({
      withGuestContext: async () => {
        throw new Error("connection string postgres://secret");
      },
    });

    const response = await handleMediaRequest(request(), ["p", ID, "main"]);
    const body = await response.text();

    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(body).not.toContain("secret");
    expect(spy.mock.calls.flat().join(" ")).not.toContain("secret");
    spy.mockRestore();
  });
});
