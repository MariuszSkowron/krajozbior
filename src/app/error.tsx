"use client";

import { CatalogError } from "@/app/catalog-error";

// Globalna granica błędów (QA-5): każda strona bez własnego `error.tsx` pokazuje polski
// komunikat w powłoce zamiast domyślnego ekranu Next.js. Tekst nic nie mówi o przyczynie.
export default function Error({ retry }: { error: unknown; retry: () => void }) {
  return <CatalogError retry={retry} />;
}
