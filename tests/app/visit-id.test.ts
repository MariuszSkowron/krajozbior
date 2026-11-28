import { describe, expect, it } from "vitest";

import { newClientVisitId } from "@/app/places/[placeId]/visit-id";

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe("newClientVisitId", () => {
  it("uses randomUUID when the browser has it", () => {
    const source = { randomUUID: () => "11111111-1111-4111-8111-111111111111" } as const;

    expect(newClientVisitId(source as unknown as Partial<Crypto>)).toBe(
      "11111111-1111-4111-8111-111111111111",
    );
  });

  it("builds a version 4 UUID from getRandomValues when randomUUID is missing", () => {
    const source = {
      getRandomValues: (bytes: Uint8Array) => bytes.fill(0xff),
    } as unknown as Partial<Crypto>;

    expect(newClientVisitId(source)).toBe("ffffffff-ffff-4fff-bfff-ffffffffffff");
  });

  it("gives different version 4 ids on real random values", () => {
    const source = {
      getRandomValues: globalThis.crypto.getRandomValues.bind(globalThis.crypto),
    } as unknown as Partial<Crypto>;
    const first = newClientVisitId(source);

    expect(first).toMatch(UUID_V4);
    expect(newClientVisitId(source)).not.toBe(first);
  });

  it("throws when the browser has no source of random values", () => {
    expect(() => newClientVisitId({})).toThrow();
    expect(() => newClientVisitId(undefined)).toThrow();
  });
});
