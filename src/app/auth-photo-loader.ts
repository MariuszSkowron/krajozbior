import { connection } from "next/server";

import { logReadFailure } from "@/app/request-actor";
import { getHomeBanner } from "@/features/catalog/application/public-catalog";
import { getCatalogDeps } from "@/features/catalog/infrastructure/catalog-deps";

// Zdjęcie drugiej kolumny ekranów wejścia: losowanie z puli banera strony głównej (publiczny
// odczyt, ten sam dla wszystkich). Nieudany odczyt albo pusta pula daje `null`, a ekran
// zostaje z tłem zastępczym.
export async function loadAuthPhoto() {
  await connection();

  try {
    return await getHomeBanner(getCatalogDeps());
  } catch (error) {
    logReadFailure("Auth photo read", error);

    return null;
  }
}
