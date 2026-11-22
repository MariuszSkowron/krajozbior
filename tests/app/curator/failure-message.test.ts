import { describe, expect, it } from "vitest";

import { describeFailure, fieldHints, parseNumberField } from "@/app/curator/failure-message";

describe("describeFailure", () => {
  it("lists the fields the server refused", () => {
    expect(describeFailure(400, { fields: ["title", 5, "summary"] }, "collection")).toEqual({
      message: "Popraw zaznaczone pola i zapisz jeszcze raz.",
      fields: ["title", "summary"],
      stale: false,
    });
    expect(describeFailure(400, {}, "place").fields).toEqual([]);
  });

  it("offers a reload for a stale version, with text for the subject", () => {
    const collection = describeFailure(409, { reason: "stale_version" }, "collection");
    const place = describeFailure(409, { reason: "stale_version" }, "place");

    expect(collection).toMatchObject({
      message: "Ktoś zmienił tę kolekcję, odśwież.",
      stale: true,
    });
    expect(place).toMatchObject({ message: "Ktoś zmienił to miejsce, odśwież.", stale: true });
  });

  it("explains the other conflicts", () => {
    expect(describeFailure(409, { reason: "was_published" }, "collection").message).toContain(
      "Wycofaj jej publikację",
    );
    expect(
      describeFailure(409, { reason: "last_place_of_published_collection" }, "collection").message,
    ).toBe("To ostatnie miejsce opublikowanej kolekcji. Najpierw wycofaj publikację.");
    expect(describeFailure(409, { reason: "already_in_collection" }, "place").message).toBe(
      "To miejsce jest już w kolekcji.",
    );
    expect(describeFailure(409, { reason: "too_many_places" }, "place").message).toBe(
      "Kolekcja ma już 500 miejsc, to najwięcej. Usuń któreś, by dodać nowe.",
    );
    expect(describeFailure(409, { reason: "too_many_collections" }, "collection").message).toBe(
      "Organizacja ma już 200 kolekcji, to najwięcej. Nie da się utworzyć kolejnej.",
    );
    expect(describeFailure(409, { reason: "other" }, "place").message).toContain(
      "Spróbuj ponownie",
    );
  });

  it("tells why a publication was refused", () => {
    expect(describeFailure(422, { reason: "no_places" }, "collection").message).toContain(
      "co najmniej jedno miejsce",
    );
    expect(describeFailure(422, { reason: "already_published" }, "collection")).toMatchObject({
      stale: true,
    });
  });

  it.each([
    [401, "Zaloguj się ponownie"],
    [403, "Nie masz uprawnień"],
    [404, "Nie znaleziono"],
    [413, "zbyt duże"],
    [429, "Za dużo zapisów"],
    [503, "Nie udało się zapisać"],
  ])("maps status %i to a Polish message", (status, text) => {
    expect(describeFailure(status, {}, "collection").message).toContain(text);
  });
});

describe("fieldHints", () => {
  it("has a hint for every field of the two forms", () => {
    for (const name of [
      "title",
      "summary",
      "region",
      "name",
      "description",
      "address",
      "accessInfo",
      "accessRestriction",
      "latitude",
      "longitude",
      "visitRadiusM",
    ]) {
      expect(fieldHints[name]).toBeTruthy();
    }
  });
});

describe("parseNumberField", () => {
  it("accepts a comma or a dot as the decimal mark", () => {
    expect(parseNumberField("54,0928")).toBe(54.0928);
    expect(parseNumberField(" -18.79 ")).toBe(-18.79);
    expect(parseNumberField("200")).toBe(200);
  });

  it("leaves text that is not a number as typed, for the server to refuse", () => {
    expect(parseNumberField("")).toBe("");
    expect(parseNumberField("abc")).toBe("abc");
    expect(parseNumberField("1e5")).toBe("1e5");
  });
});
