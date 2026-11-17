import { describe, expect, it } from "vitest";

import { REGION_LABELS, REGIONS } from "@/features/catalog/domain/collection";

describe("region labels", () => {
  it("names every voivodeship in Polish", () => {
    expect(Object.keys(REGION_LABELS).sort()).toEqual([...REGIONS].sort());
    expect(REGION_LABELS.lodzkie).toBe("Łódzkie");
    expect(REGION_LABELS.pomorskie).toBe("Pomorskie");
  });
});
