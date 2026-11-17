import { describe, expect, it } from "vitest";

import { validatePlaceInput } from "@/features/catalog/domain/place";

const valid = { name: " Wieża ", latitude: 54.09, longitude: 18.78 };

describe("validatePlaceInput", () => {
  it("accepts the minimum and applies defaults (radius 200 m)", () => {
    expect(validatePlaceInput(valid)).toEqual({
      ok: true,
      value: {
        name: "Wieża",
        description: "",
        address: "",
        accessInfo: "",
        latitude: 54.09,
        longitude: 18.78,
        visitRadiusM: 200,
      },
    });
  });

  it("accepts texts and the radius limits 50 m and 2 km", () => {
    const full = {
      ...valid,
      description: "Opis\r\nlinia",
      address: "ul. Długa 1",
      accessInfo: "Wejście od podwórza",
    };

    expect(validatePlaceInput({ ...full, visitRadiusM: 50 }).ok).toBe(true);
    expect(validatePlaceInput({ ...full, visitRadiusM: 2000 })).toMatchObject({
      ok: true,
      value: { description: "Opis\nlinia", visitRadiusM: 2000 },
    });
  });

  it.each([
    [{ visitRadiusM: 49 }, "visitRadiusM"],
    [{ visitRadiusM: 2001 }, "visitRadiusM"],
    [{ visitRadiusM: 100.5 }, "visitRadiusM"],
    [{ visitRadiusM: "200" }, "visitRadiusM"],
    [{ latitude: 90.1 }, "latitude"],
    [{ latitude: Number.NaN }, "latitude"],
    [{ latitude: "54" }, "latitude"],
    [{ longitude: -180.5 }, "longitude"],
    [{ longitude: Number.POSITIVE_INFINITY }, "longitude"],
    [{ name: "" }, "name"],
    [{ name: 5 }, "name"],
    [{ name: "x".repeat(121) }, "name"],
    [{ description: "x".repeat(4001) }, "description"],
    [{ address: "x".repeat(201) }, "address"],
    [{ accessInfo: "x".repeat(1001) }, "accessInfo"],
    [{ accessInfo: 7 }, "accessInfo"],
  ])("rejects %j", (patch, field) => {
    expect(validatePlaceInput({ ...valid, ...patch })).toEqual({ ok: false, errors: [field] });
  });

  it("names every missing required field", () => {
    expect(validatePlaceInput({})).toEqual({
      ok: false,
      errors: ["name", "latitude", "longitude"],
    });
  });
});
