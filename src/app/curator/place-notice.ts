// The message a curator sees at a place after returning to the collection (K-40). The address
// carries `?saved=<placeId>` or `?added=<placeId>`; an id that is not on the list is ignored.

export type PlaceNotice = Readonly<{ placeId: string; message: string }>;

export const PLACE_SAVED_MESSAGE = "Zapisano zmiany miejsca";
export const PLACE_ADDED_MESSAGE = "Dodano miejsce";

type Params = Readonly<Record<string, string | string[] | undefined>>;

export function placeNotice(params: Params, placeIds: readonly string[]): PlaceNotice | null {
  const candidates = [
    { value: params.saved, message: PLACE_SAVED_MESSAGE },
    { value: params.added, message: PLACE_ADDED_MESSAGE },
  ];

  for (const { value, message } of candidates) {
    if (typeof value === "string" && placeIds.includes(value)) {
      return { placeId: value, message };
    }
  }

  return null;
}
