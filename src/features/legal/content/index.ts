import { CURRENT_TERMS_VERSION, TERMS_EFFECTIVE_DATE } from "@/features/terms/domain/terms-version";

import type { LegalSlug } from "../domain/legal-pages";
import { OSWIADCZENIE_O_ZDJECIACH } from "./oswiadczenie-o-zdjeciach";
import { POLITYKA_PRYWATNOSCI } from "./polityka-prywatnosci";
import { REGULAMIN } from "./regulamin";
import { UMOWA_POWIERZENIA } from "./umowa-powierzenia";
import { ZASADY } from "./zasady";

// Teksty prawne wdrożone w aplikacji (F-K3). Wszystkie pięć ma ten sam numer i datę wersji;
// regulamin jest dokumentem, który odkrywca akceptuje (CURRENT_TERMS_VERSION).
export type LegalDocument = Readonly<{
  slug: LegalSlug;
  version: string;
  date: string;
  markdown: string;
}>;

function document(slug: LegalSlug, markdown: string): LegalDocument {
  return { slug, version: CURRENT_TERMS_VERSION, date: TERMS_EFFECTIVE_DATE, markdown };
}

export const LEGAL_DOCUMENTS: Readonly<Record<LegalSlug, LegalDocument>> = {
  regulamin: document("regulamin", REGULAMIN),
  "polityka-prywatnosci": document("polityka-prywatnosci", POLITYKA_PRYWATNOSCI),
  zasady: document("zasady", ZASADY),
  "oswiadczenie-o-zdjeciach": document("oswiadczenie-o-zdjeciach", OSWIADCZENIE_O_ZDJECIACH),
  "umowa-powierzenia": document("umowa-powierzenia", UMOWA_POWIERZENIA),
};
