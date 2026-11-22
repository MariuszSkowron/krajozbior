import "server-only";

import type { TransactionContext } from "@/lib/db/user-context";

import type { PhotoReadRepository } from "../application/serve-photo";

// Surowe SQL na transakcji przypadku użycia (kontekst gościa albo użytkownika), jak katalog. RLS
// tabeli `place_photos` sam rozstrzyga, czy wiersz jest widoczny: gość widzi zdjęcie gotowe i
// nieukryte z opublikowanej kolekcji zatwierdzonej organizacji, kurator także zdjęcia szkiców swojej
// organizacji. Aplikacja nie ma uprawnienia do kolumn `hidden_*`, więc zapytanie ich nie czyta.
export const postgresPhotoReadRepository: PhotoReadRepository = {
  async findReadyPhotoKey(tx: TransactionContext, photoId: string) {
    const rows = await tx.em.execute<{ storageKey: string }[]>(
      `select storage_key::text as "storageKey"
         from public.place_photos
        where id = ? and file_state = 'ready' and storage_key is not null`,
      [photoId],
    );

    return rows[0]?.storageKey ?? null;
  },
};
