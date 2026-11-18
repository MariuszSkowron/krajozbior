import { beforeEach, describe, expect, it, vi } from "vitest";

const getActor = vi.fn();

vi.mock("@/features/identity/infrastructure", () => ({
  getIdentityProvider: () => ({ getActor }),
}));
vi.mock("@/features/visits/infrastructure/visit-deps", () => ({
  getVisitDeps: () => {
    throw new Error("the use case must not be reached");
  },
}));

import { handlePastVisitsRequest } from "@/features/visits/http/past-visit-http";

describe("handlePastVisitsRequest", () => {
  beforeEach(() => {
    getActor.mockReset();
  });

  it("answers a guest with 401 without reading the body, however large", async () => {
    getActor.mockResolvedValue(null);

    let pulled = false;
    // highWaterMark 0: the stream is pulled only when somebody reads it.
    const body = new ReadableStream<Uint8Array>(
      {
        pull(controller) {
          pulled = true;
          controller.enqueue(new Uint8Array(1024));
        },
      },
      { highWaterMark: 0 },
    );
    const request = new Request("http://localhost/api/me/visits/past", {
      method: "POST",
      body,
      duplex: "half",
    } as RequestInit);

    const response = await handlePastVisitsRequest(request);

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "unauthenticated" });
    expect(pulled).toBe(false);
  });
});
