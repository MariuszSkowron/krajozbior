"use client";

import { CatalogError } from "@/app/catalog-error";

export default function Error({ retry }: { error: unknown; retry: () => void }) {
  return <CatalogError retry={retry} />;
}
