"use client";

import { CatalogError } from "@/app/catalog-error";

// Granica błędu dla `/news` i `/news/[slug]` (S5): awaria odczytu to komunikat po polsku,
// bez szczegółów błędu; strony rzucają ogólny błąd po zapisaniu klasy błędu w logu.
export default function Error({ retry }: { error: unknown; retry: () => void }) {
  return <CatalogError retry={retry} />;
}
