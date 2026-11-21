import { CURRENT_TERMS_VERSION, TERMS_DRAFT_DATE } from "@/features/terms/domain/terms-version";

import type { LegalSlug } from "../domain/legal-pages";
import { OSWIADCZENIE_O_ZDJECIACH } from "./oswiadczenie-o-zdjeciach";
import { POLITYKA_PRYWATNOSCI } from "./polityka-prywatnosci";
import { REGULAMIN } from "./regulamin";
import { ZASADY } from "./zasady";

// Teksty prawne wdrożone w aplikacji (F-K3). Wszystkie cztery mają ten sam numer i datę
// wersji roboczej; regulamin jest dokumentem, który odkrywca akceptuje (CURRENT_TERMS_VERSION).
export type LegalDocument = Readonly<{
  slug: LegalSlug;
  version: string;
  date: string;
  markdown: string;
}>;

export const LEGAL_DOCUMENTS: Readonly<Record<LegalSlug, LegalDocument>> = {
  regulamin: {
    slug: "regulamin",
    version: CURRENT_TERMS_VERSION,
    date: TERMS_DRAFT_DATE,
    markdown: REGULAMIN,
  },
  "polityka-prywatnosci": {
    slug: "polityka-prywatnosci",
    version: "0.2",
    date: TERMS_DRAFT_DATE,
    markdown: POLITYKA_PRYWATNOSCI,
  },
  zasady: { slug: "zasady", version: "0.2", date: TERMS_DRAFT_DATE, markdown: ZASADY },
  "oswiadczenie-o-zdjeciach": {
    slug: "oswiadczenie-o-zdjeciach",
    version: "0.2",
    date: TERMS_DRAFT_DATE,
    markdown: OSWIADCZENIE_O_ZDJECIACH,
  },
};
