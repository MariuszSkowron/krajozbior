// Text of the notice about the grounds of a place (E1-S11, R-14). Calm and informative:
// where to look from and a request not to enter. No alarm wording.

import type { AccessRestriction } from "./place";

export type AccessNotice = Readonly<{ title: string; text: string }>;

const NOTICES: Readonly<Record<Exclude<AccessRestriction, "none">, AccessNotice>> = {
  private: {
    title: "Teren prywatny",
    text: "To miejsce stoi na terenie prywatnym. Obejrzyj je z miejsca publicznego, na przykład z drogi, i nie wchodź na teren bez zgody właściciela.",
  },
  fenced: {
    title: "Teren ogrodzony",
    text: "To miejsce jest ogrodzone lub zamknięte dla zwiedzających. Obejrzyj je z zewnątrz i nie wchodź na teren.",
  },
  ruin: {
    title: "Ruina",
    text: "To miejsce jest ruiną, a wejście na jej teren bywa niebezpieczne lub zabronione. Obejrzyj ją z bezpiecznej odległości i nie wchodź na teren.",
  },
};

/** The notice for a place, or `null` when its grounds carry no restriction. */
export function accessNotice(restriction: AccessRestriction): AccessNotice | null {
  return restriction === "none" ? null : NOTICES[restriction];
}

export const ACCESS_RESTRICTION_LABELS: Readonly<Record<AccessRestriction, string>> = {
  none: "Brak ograniczeń (zwykły dostęp)",
  private: "Teren prywatny",
  fenced: "Teren ogrodzony",
  ruin: "Ruina",
};
