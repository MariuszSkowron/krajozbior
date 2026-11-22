import { describe, expect, it, vi } from "vitest";

import type { CatalogDeps } from "@/features/catalog/application/catalog-types";
import { setCollectionCover } from "@/features/catalog/application/curator-cover";

// Wybór okładki (E4-3): aktor z sesji, rola organizacji, kształt wejścia i mapowanie odpowiedzi
// bazy. Strażnik w bazie (wyzwalacz) ma osobny test integracyjny (`collection-cover.test.ts`).
const actor = { id: "11111111-1111-4111-8111-111111111111", role: "user" as const };
const collectionId = "22222222-2222-4222-8222-222222222222";
const photoId = "33333333-3333-4333-8333-333333333333";

function setup(result: boolean | "rejected", organizationIds: string[] = ["org"]) {
  const setCover = vi.fn(async () => result);
  const reserve = vi.fn(async () => ({ allowed: true }));
  const deps = {
    withUserContext: (_who: unknown, work: (tx: unknown) => Promise<unknown>) => work({}),
    limiter: { reserve },
    random: () => 0,
    repository: {
      permittedOrganizationIds: async () => organizationIds,
      setCollectionCover: setCover,
    },
  } as unknown as CatalogDeps;

  return { deps, setCover, reserve };
}

describe("setCollectionCover", () => {
  it("answers unauthenticated for a guest, before anything else", async () => {
    const { deps, setCover } = setup(true);

    expect(await setCollectionCover(null, collectionId, { placePhotoId: photoId }, deps)).toEqual({
      status: "unauthenticated",
    });
    expect(setCover).not.toHaveBeenCalled();
  });

  it("answers forbidden for an account that is no curator of an approved organization", async () => {
    const { deps, setCover } = setup(true, []);

    expect(await setCollectionCover(actor, collectionId, { placePhotoId: photoId }, deps)).toEqual({
      status: "forbidden",
    });
    expect(setCover).not.toHaveBeenCalled();
  });

  it("sets the cover and answers with the chosen photo", async () => {
    const { deps, setCover } = setup(true);

    expect(await setCollectionCover(actor, collectionId, { placePhotoId: photoId }, deps)).toEqual({
      status: "ok",
      value: { coverPlacePhotoId: photoId },
    });
    expect(setCover).toHaveBeenCalledWith(expect.anything(), collectionId, photoId);
  });

  it("clears the cover for an empty body or a null id", async () => {
    const { deps, setCover } = setup(true);

    expect(await setCollectionCover(actor, collectionId, {}, deps)).toEqual({
      status: "ok",
      value: { coverPlacePhotoId: null },
    });
    expect(await setCollectionCover(actor, collectionId, { placePhotoId: null }, deps)).toEqual({
      status: "ok",
      value: { coverPlacePhotoId: null },
    });
    expect(setCover).toHaveBeenNthCalledWith(1, expect.anything(), collectionId, null);
    expect(setCover).toHaveBeenNthCalledWith(2, expect.anything(), collectionId, null);
  });

  it.each([42, "", "nie-uuid", {}, ["x"], true])(
    "refuses the photo id %j as invalid",
    async (id) => {
      const { deps, setCover } = setup(true);

      expect(await setCollectionCover(actor, collectionId, { placePhotoId: id }, deps)).toEqual({
        status: "invalid",
        errors: ["placePhotoId"],
      });
      expect(setCover).not.toHaveBeenCalled();
    },
  );

  it("answers unprocessable when the database refuses the photo", async () => {
    const { deps } = setup("rejected");

    expect(await setCollectionCover(actor, collectionId, { placePhotoId: photoId }, deps)).toEqual({
      status: "unprocessable",
      reason: "cover_not_allowed",
    });
  });

  it("answers not_found when no editable collection has this id", async () => {
    const { deps } = setup(false);

    expect(await setCollectionCover(actor, collectionId, { placePhotoId: photoId }, deps)).toEqual({
      status: "not_found",
    });
  });
});
