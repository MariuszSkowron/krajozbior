import { describe, expect, it } from "vitest";

import {
  UNAVAILABLE_PLACE_LABEL,
  entryState,
  removedPlaceLabel,
  unavailablePlaceLabel,
} from "@/features/own-collections/domain/entry";

const PLACE = "11111111-1111-4111-8111-111111111111";

describe("entryState (E8-S2, E8-Q19)", () => {
  it("is available while the place is public", () => {
    expect(entryState(PLACE, PLACE)).toBe("available");
  });

  it("is unavailable when the place exists but is not public now", () => {
    expect(entryState(PLACE, null)).toBe("unavailable");
  });

  it("is removed once the curator deleted the place", () => {
    expect(entryState(null, null)).toBe("removed");
  });
});

describe("labels of entries", () => {
  it("say that the place is unavailable, and who removed it, with the name", () => {
    expect(UNAVAILABLE_PLACE_LABEL).toBe("Miejsce chwilowo niedostępne");
    expect(removedPlaceLabel("Wieża ciśnień")).toBe(
      "Miejsce usunięte przez kuratora: Wieża ciśnień",
    );
  });

  it("shows the name taken at add time next to the unavailable label, if there is one", () => {
    expect(unavailablePlaceLabel("Wieża ciśnień")).toBe(
      "Miejsce chwilowo niedostępne: Wieża ciśnień",
    );
    expect(unavailablePlaceLabel(null)).toBe("Miejsce chwilowo niedostępne");
    expect(unavailablePlaceLabel("  ")).toBe("Miejsce chwilowo niedostępne");
  });
});
