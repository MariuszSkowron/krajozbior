import { MAX_COLLECTIONS_PER_LIST } from "@/features/catalog/domain/limits";

// The call behind every "save the collection" button (the page of the collection, the Start page):
// one route of the album, one set of messages, so the wording cannot drift between the buttons.

const MESSAGES: Record<number, string> = {
  401: "Zaloguj się, żeby zapisać kolekcję.",
  404: "Ta kolekcja nie jest już dostępna.",
  409: `Masz już ${MAX_COLLECTIONS_PER_LIST} zapisanych kolekcji, to najwięcej. Usuń którąś, by zapisać nową.`,
  429: "Za dużo prób. Spróbuj za chwilę.",
};

export type SavedCollectionChange =
  Readonly<{ ok: true }> | Readonly<{ ok: false; message: string }>;

/** Saves (`PUT`) or unsaves (`DELETE`) the collection; a refusal or a lost connection gives a message. */
export async function changeSavedCollection(
  collectionId: string,
  method: "PUT" | "DELETE",
): Promise<SavedCollectionChange> {
  try {
    const response = await fetch(`/api/me/saved-collections/${collectionId}`, { method });

    return response.ok
      ? { ok: true }
      : {
          ok: false,
          message: MESSAGES[response.status] ?? "Nie udało się zapisać zmiany. Spróbuj ponownie.",
        };
  } catch {
    return { ok: false, message: "Brak połączenia. Spróbuj ponownie." };
  }
}
