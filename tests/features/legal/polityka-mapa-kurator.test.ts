import { describe, expect, it } from "vitest";

import { LEGAL_DOCUMENTS } from "@/features/legal/content";

// Paczka R (K-39): the map of the place editor passes the IP of the curator to OpenStreetMap,
// so points 7 and 8 of the privacy policy say so and name the substitute (the coordinate fields).
describe("the privacy policy about the map in the place editor", () => {
  const policy = LEGAL_DOCUMENTS["polityka-prywatnosci"].markdown;

  it("names the editor map in point 7 and the substitute of the map for a curator", () => {
    expect(policy).toContain(
      "To samo dzieje się w edytorze miejsca w panelu kuratora, gdy kurator wybierze „Pokaż mapę”",
    );
    expect(policy).toContain(
      "nie wybiera „Pokaż mapę” i ustawia położenie miejsca, wpisując współrzędne w polach formularza.",
    );
  });

  it("keeps the sentence about the list of places for the explorer's view only", () => {
    expect(policy).toContain(
      "nie wybieraj widoku „Mapa”; lista miejsc zawiera te same informacje.\n\nTo samo dzieje się w edytorze",
    );
    expect(policy).not.toMatch(/kurator[^.]*lista miejsc zawiera/);
  });

  it("lists the editor map among the transfers outside the EEA in point 8", () => {
    expect(policy).toContain(
      "- gdy wybierzesz widok „Mapa” albo, jako kurator, „Pokaż mapę” w edytorze miejsca (punkt 7);",
    );
  });
});
