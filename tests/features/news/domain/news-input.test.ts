import { describe, expect, it } from "vitest";

import {
  NEWS_BODY_MAX_LENGTH,
  NEWS_EVENT_MAX_DATE,
  NEWS_EVENT_MIN_DATE,
} from "@/features/news/domain/limits";
import {
  hasForbiddenCharacter,
  isCalendarDate,
  isEventDate,
  parseHiddenReason,
  validateNewsInput,
} from "@/features/news/domain/news-input";

const ID = "3f2b8c1e-5d4a-4b6f-9a7e-1c2d3e4f5a6b";

const valid = {
  kind: "guide",
  title: "Nowy poradnik po szlaku",
  lead: "Krótki opis.",
};

function errorsOf(input: unknown) {
  const result = validateNewsInput(input);

  if (result.ok) {
    throw new Error("expected errors");
  }

  return result.errors;
}

function errorsOfStrict(input: unknown) {
  const result = validateNewsInput(input, { strict: true });

  if (result.ok) {
    throw new Error("expected errors");
  }

  return result.errors;
}

function fieldMessage(input: unknown, field: string) {
  return errorsOf(input).find((error) => error.field === field)?.message;
}

describe("validateNewsInput: accepted input", () => {
  it("accepts the minimum and fills defaults", () => {
    expect(validateNewsInput(valid)).toEqual({
      ok: true,
      value: {
        kind: "guide",
        title: "Nowy poradnik po szlaku",
        lead: "Krótki opis.",
        body: "",
        collectionId: null,
        placeId: null,
        eventStartsOn: null,
        eventEndsOn: null,
      },
    });
  });

  it("normalizes to NFC, trims and turns CRLF into LF", () => {
    const result = validateNewsInput({
      ...valid,
      title: "  Zazółć łódź  ",
      lead: " Linia\r\ndruga ",
      body: "  Akapit\r\n\r\nDrugi  \r\n",
      collectionId: ` ${ID} `,
      placeId: ID,
    });

    expect(result).toMatchObject({
      ok: true,
      value: {
        title: "Zazółć łódź",
        lead: "Linia\ndruga",
        body: "Akapit\n\nDrugi",
        collectionId: ID,
        placeId: ID,
      },
    });
  });

  it("treats empty and missing optional values alike", () => {
    expect(
      validateNewsInput({
        ...valid,
        body: null,
        collectionId: "",
        placeId: "  ",
        eventStartsOn: "",
        eventEndsOn: undefined,
      }),
    ).toMatchObject({
      ok: true,
      value: {
        body: "",
        collectionId: null,
        placeId: null,
        eventStartsOn: null,
        eventEndsOn: null,
      },
    });
  });

  it("accepts an event with a start, with and without an end, and an end equal to the start", () => {
    const event = { ...valid, kind: "event" };

    expect(validateNewsInput({ ...event, eventStartsOn: "2027-05-01" })).toMatchObject({
      ok: true,
      value: { eventStartsOn: "2027-05-01", eventEndsOn: null },
    });
    expect(
      validateNewsInput({ ...event, eventStartsOn: "2027-05-01", eventEndsOn: "2027-05-01" }).ok,
    ).toBe(true);
    expect(
      validateNewsInput({ ...event, eventStartsOn: "2027-05-01", eventEndsOn: "2027-05-03" }).ok,
    ).toBe(true);
  });

  it("accepts the length limits exactly", () => {
    expect(validateNewsInput({ ...valid, title: "a".repeat(5) }).ok).toBe(true);
    expect(validateNewsInput({ ...valid, title: "a".repeat(120) }).ok).toBe(true);
    expect(validateNewsInput({ ...valid, lead: "a" }).ok).toBe(true);
    expect(validateNewsInput({ ...valid, lead: "a".repeat(280) }).ok).toBe(true);
    expect(validateNewsInput({ ...valid, body: "a".repeat(NEWS_BODY_MAX_LENGTH) }).ok).toBe(true);
  });

  it("counts characters, so 120 two-unit characters fit in a title", () => {
    expect(validateNewsInput({ ...valid, title: "\u{1F5FA}".repeat(120) }).ok).toBe(true);
    expect(validateNewsInput({ ...valid, title: "\u{1F5FA}".repeat(121) }).ok).toBe(false);
  });
});

describe("validateNewsInput: shape", () => {
  it("refuses a body that is not an object, with a Polish message on the whole form (S4)", () => {
    for (const input of [null, undefined, [], "tekst", 5, true]) {
      expect(errorsOf(input)).toEqual([
        { field: "form", message: "Formularz ma nieprawidłowy format." },
      ]);
    }
  });

  it("drops an unknown field in the default mode", () => {
    expect(validateNewsInput({ ...valid, evnetStartsOn: "2027-05-01" }).ok).toBe(true);
  });

  it("refuses an unknown field in the strict mode, one error per field", () => {
    expect(validateNewsInput({ ...valid, evnetStartsOn: "2027-05-01" }, { strict: true })).toEqual({
      ok: false,
      errors: [{ field: "form", message: "Nieznane pole: „evnetStartsOn”." }],
    });
    expect(errorsOfStrict({ ...valid, a: 1, b: 2 }).map((error) => error.message)).toEqual([
      "Nieznane pole: „a”.",
      "Nieznane pole: „b”.",
    ]);
    expect(errorsOfStrict({ ...valid, ["x".repeat(100)]: 1 })[0].message).toBe(
      `Nieznane pole: „${"x".repeat(40)}”.`,
    );
  });

  it("accepts every known field in the strict mode and keeps the other rules", () => {
    const full = {
      ...valid,
      body: "Treść",
      collectionId: ID,
      placeId: ID,
      eventStartsOn: null,
      eventEndsOn: null,
    };

    expect(validateNewsInput(full, { strict: true }).ok).toBe(true);
    expect(validateNewsInput(valid, { strict: false }).ok).toBe(true);
    expect(errorsOfStrict({ ...valid, title: "abc" }).map((error) => error.field)).toEqual([
      "title",
    ]);
    expect(errorsOfStrict(null)).toEqual([
      { field: "form", message: "Formularz ma nieprawidłowy format." },
    ]);
  });

  it("reports a missing or wrong kind, title and lead with their own messages", () => {
    const errors = errorsOf({ kind: "nope", title: 5, lead: undefined });

    expect(errors).toEqual([
      { field: "kind", message: "Wybierz rodzaj aktualności." },
      { field: "title", message: "Wpisz tytuł." },
      { field: "lead", message: "Wpisz krótki tekst." },
    ]);
  });

  it("reports one error per field for a wrongly typed optional value", () => {
    const errors = errorsOf({
      ...valid,
      body: 1,
      collectionId: 2,
      placeId: 3,
      eventStartsOn: 4,
      eventEndsOn: 5,
    });

    expect(errors.map((error) => error.field)).toEqual([
      "body",
      "collectionId",
      "placeId",
      "eventStartsOn",
      "eventEndsOn",
    ]);
    expect(errors[0].message).toBe("Treść ma nieprawidłowy format.");
  });

  it("keeps one error per field when a field breaks twice", () => {
    expect(errorsOf({ ...valid, kind: undefined }).filter((e) => e.field === "kind")).toHaveLength(
      1,
    );
  });
});

describe("validateNewsInput: texts", () => {
  it("refuses a title and a lead out of range with the range in the message", () => {
    expect(fieldMessage({ ...valid, title: "abcd" }, "title")).toBe(
      "Tytuł ma mieć od 5 do 120 znaków.",
    );
    expect(fieldMessage({ ...valid, title: "a".repeat(121) }, "title")).toBe(
      "Tytuł ma mieć od 5 do 120 znaków.",
    );
    expect(fieldMessage({ ...valid, title: "     " }, "title")).toBe(
      "Tytuł ma mieć od 5 do 120 znaków.",
    );
    expect(fieldMessage({ ...valid, lead: "   " }, "lead")).toBe(
      "Krótki tekst ma mieć od 1 do 280 znaków.",
    );
    expect(fieldMessage({ ...valid, lead: "a".repeat(281) }, "lead")).toBe(
      "Krótki tekst ma mieć od 1 do 280 znaków.",
    );
  });

  it("refuses control characters in a title, but allows a line feed in a lead and a body", () => {
    expect(fieldMessage({ ...valid, title: "Tytuł\nz łamaniem" }, "title")).toBe(
      "Tytuł zawiera niedozwolone znaki sterujące.",
    );
    expect(fieldMessage({ ...valid, title: "Tytuł\u0000x" }, "title")).toBeDefined();
    expect(fieldMessage({ ...valid, lead: "Lead\ttab" }, "lead")).toBe(
      "Krótki tekst zawiera niedozwolone znaki sterujące.",
    );
    expect(validateNewsInput({ ...valid, lead: "a\nb", body: "c\nd" }).ok).toBe(true);
    expect(fieldMessage({ ...valid, body: "a\u0007b" }, "body")).toBe(
      "Treść zawiera niedozwolone znaki sterujące.",
    );
    expect(fieldMessage({ ...valid, body: "a\tb" }, "body")).toBeDefined();
  });

  it("refuses text direction characters", () => {
    for (const mark of ["‮", "‏", "⁦", "؜"]) {
      expect(fieldMessage({ ...valid, title: `Tytuł${mark}abc` }, "title")).toBeDefined();
    }
  });

  it("refuses a title or a lead made only of invisible characters (S5)", () => {
    // Six characters, so only the visible count rejects it (trim drops the ﻿).
    const zeroWidth = "​‌‍⁠​‌﻿";

    expect(fieldMessage({ ...valid, title: zeroWidth }, "title")).toBe(
      "Tytuł musi mieć co najmniej 5 widocznych znaków.",
    );
    expect(fieldMessage({ ...valid, title: `ab${zeroWidth}` }, "title")).toBe(
      "Tytuł musi mieć co najmniej 5 widocznych znaków.",
    );
    expect(fieldMessage({ ...valid, title: "a­ㅤ  bc" }, "title")).toBe(
      "Tytuł musi mieć co najmniej 5 widocznych znaków.",
    );
    expect(fieldMessage({ ...valid, lead: "​​" }, "lead")).toBe(
      "Krótki tekst musi zawierać widoczne znaki.",
    );
    expect(validateNewsInput({ ...valid, title: "abcd​e" }).ok).toBe(true);
    // A joiner inside an emoji sequence is allowed.
    expect(validateNewsInput({ ...valid, title: "Rodzina 👨‍👩‍👧" }).ok).toBe(true);
  });

  it("refuses a lone surrogate in every text (N2)", () => {
    expect(fieldMessage({ ...valid, title: "Tytuł\ud800x" }, "title")).toBe(
      "Tytuł zawiera niedozwolone znaki sterujące.",
    );
    expect(fieldMessage({ ...valid, lead: "a\udc00" }, "lead")).toBeDefined();
    expect(fieldMessage({ ...valid, body: "a\ud83d" }, "body")).toBe(
      "Treść zawiera niedozwolone znaki sterujące.",
    );
    expect(parseHiddenReason("powód z \ud800 surogatem")).toBeNull();
    expect(hasForbiddenCharacter("pełna para \u{1F5FA}", false)).toBe(false);
  });

  it("cuts the raw length before normalizing (S1)", () => {
    // 236 spaces and 5 letters: 241 units, over twice the title limit, so refused at once;
    // the same text trimmed would be a valid title.
    const padded = `${" ".repeat(236)}abcde`;

    expect(fieldMessage({ ...valid, title: padded }, "title")).toBe(
      "Tytuł ma mieć od 5 do 120 znaków.",
    );
    expect(validateNewsInput({ ...valid, title: `${" ".repeat(235)}abcde` }).ok).toBe(true);
    expect(fieldMessage({ ...valid, lead: `${" ".repeat(556)}abcde` }, "lead")).toBe(
      "Krótki tekst ma mieć od 1 do 280 znaków.",
    );
    expect(fieldMessage({ ...valid, body: "a".repeat(NEWS_BODY_MAX_LENGTH * 2 + 1) }, "body")).toBe(
      "Treść może mieć najwyżej 5000 znaków.",
    );
    expect(parseHiddenReason(`${" ".repeat(796)}powód 1234`)).toBeNull();
  });

  it("answers quickly for a huge text", () => {
    const huge = "a".repeat(5_000_000);
    const errors = errorsOf({ ...valid, title: huge, lead: huge, body: huge });

    expect(errors.map((error) => error.field)).toEqual(["title", "lead", "body"]);
    expect(parseHiddenReason(huge)).toBeNull();
  });

  it("reports the body limit with the number from the constant", () => {
    expect(fieldMessage({ ...valid, body: "a".repeat(NEWS_BODY_MAX_LENGTH + 1) }, "body")).toBe(
      "Treść może mieć najwyżej 5000 znaków.",
    );
  });
});

describe("validateNewsInput: link policy of the body (Q18)", () => {
  it("refuses 6 links, a shortener and credentials with a Polish message", () => {
    const six = Array.from({ length: 6 }, (_, i) => `https://s${i}.example`).join(" ");

    expect(fieldMessage({ ...valid, body: six }, "body")).toBe(
      "Treść może zawierać najwyżej 5 linków.",
    );
    expect(fieldMessage({ ...valid, body: "https://bit.ly/x" }, "body")).toBe(
      "Wpisz pełny adres strony zamiast skróconego.",
    );
    expect(fieldMessage({ ...valid, body: "https://user@host.example" }, "body")).toBe(
      "Adres w treści nie może zawierać nazwy użytkownika ani hasła.",
    );
  });

  it("accepts http: and HTML as plain text", () => {
    expect(
      validateNewsInput({ ...valid, body: "http://example.org <b>x</b> javascript:alert(1)" }).ok,
    ).toBe(true);
  });
});

describe("validateNewsInput: ids", () => {
  it("refuses a collection and a place that are not ids", () => {
    expect(fieldMessage({ ...valid, collectionId: "abc" }, "collectionId")).toBe(
      "Wybierz kolekcję z listy.",
    );
    expect(fieldMessage({ ...valid, placeId: "abc" }, "placeId")).toBe("Wybierz miejsce z listy.");
  });
});

describe("validateNewsInput: dates (Q11)", () => {
  const event = { ...valid, kind: "event" };

  it("requires a start for an event", () => {
    expect(fieldMessage(event, "eventStartsOn")).toBe("Podaj datę rozpoczęcia wydarzenia.");
  });

  it("refuses dates in a wrong form or that do not exist", () => {
    for (const bad of ["2027-02-30", "2027-13-01", "01.05.2027", "2027-5-1", "x"]) {
      expect(fieldMessage({ ...event, eventStartsOn: bad }, "eventStartsOn")).toBe(
        "Podaj poprawną datę rozpoczęcia.",
      );
      expect(
        fieldMessage({ ...event, eventStartsOn: "2027-05-01", eventEndsOn: bad }, "eventEndsOn"),
      ).toBe("Podaj poprawną datę zakończenia.");
    }
  });

  it("accepts the edges of the range 2000-01-01 to 2100-12-31 and refuses beyond it (S3)", () => {
    for (const edge of [NEWS_EVENT_MIN_DATE, NEWS_EVENT_MAX_DATE]) {
      expect(validateNewsInput({ ...event, eventStartsOn: edge }).ok).toBe(true);
    }

    for (const outside of ["1999-12-31", "2101-01-01", "0000-01-01", "0001-01-01", "9999-12-31"]) {
      expect(fieldMessage({ ...event, eventStartsOn: outside }, "eventStartsOn")).toBe(
        "Podaj poprawną datę rozpoczęcia.",
      );
      expect(
        fieldMessage(
          { ...event, eventStartsOn: "2027-05-01", eventEndsOn: outside },
          "eventEndsOn",
        ),
      ).toBe("Podaj poprawną datę zakończenia.");
    }
  });

  it("refuses an end before the start", () => {
    expect(
      fieldMessage(
        { ...event, eventStartsOn: "2027-05-02", eventEndsOn: "2027-05-01" },
        "eventEndsOn",
      ),
    ).toBe("Data zakończenia nie może być wcześniejsza niż data rozpoczęcia.");
  });

  it("does not compare an end with a missing or wrong start", () => {
    expect(fieldMessage({ ...event, eventEndsOn: "2027-05-01" }, "eventEndsOn")).toBeUndefined();
    expect(
      fieldMessage({ ...event, eventStartsOn: "bad", eventEndsOn: "2027-05-01" }, "eventEndsOn"),
    ).toBeUndefined();
  });

  it("refuses dates for a kind other than an event", () => {
    const errors = errorsOf({ ...valid, eventStartsOn: "2027-05-01", eventEndsOn: "2027-05-02" });

    expect(errors).toEqual([
      { field: "eventStartsOn", message: "Datę rozpoczęcia ma tylko wydarzenie." },
      { field: "eventEndsOn", message: "Datę zakończenia ma tylko wydarzenie." },
    ]);
    expect(errorsOf({ ...valid, eventEndsOn: "2027-05-02" })).toEqual([
      { field: "eventEndsOn", message: "Datę zakończenia ma tylko wydarzenie." },
    ]);
  });

  it("returns errors in the order of the form", () => {
    expect(
      errorsOf({
        kind: "event",
        title: "x",
        lead: "",
        body: "https://bit.ly/a",
        collectionId: "z",
      }).map((error) => error.field),
    ).toEqual(["title", "lead", "body", "collectionId", "eventStartsOn"]);
  });
});

describe("isCalendarDate", () => {
  it("accepts real dates, including a leap day, and refuses the rest", () => {
    expect(isCalendarDate("2028-02-29")).toBe(true);
    expect(isCalendarDate("2027-02-29")).toBe(false);
    expect(isCalendarDate("0050-01-01")).toBe(true);
    expect(isCalendarDate("2027-04-31")).toBe(false);
    expect(isCalendarDate("2027-01-32")).toBe(false);
    expect(isCalendarDate("")).toBe(false);
  });
});

describe("isEventDate", () => {
  it("is a real date inside the range of the constants", () => {
    expect(NEWS_EVENT_MIN_DATE).toBe("2000-01-01");
    expect(NEWS_EVENT_MAX_DATE).toBe("2100-12-31");
    expect(isEventDate("2000-01-01")).toBe(true);
    expect(isEventDate("2100-12-31")).toBe(true);
    expect(isEventDate("1999-12-31")).toBe(false);
    expect(isEventDate("2101-01-01")).toBe(false);
    expect(isEventDate("2027-02-30")).toBe(false);
  });
});

describe("hasForbiddenCharacter", () => {
  it("allows a line feed only when asked to", () => {
    expect(hasForbiddenCharacter("a\nb", true)).toBe(false);
    expect(hasForbiddenCharacter("a\nb", false)).toBe(true);
    expect(hasForbiddenCharacter("a\u007fb", true)).toBe(true);
    expect(hasForbiddenCharacter("a\u0085b", true)).toBe(true);
    expect(hasForbiddenCharacter("zażółć gęślą jaźń \u{1F5FA}", false)).toBe(false);
  });
});

describe("parseHiddenReason", () => {
  it("accepts 10 to 400 characters and returns the trimmed text", () => {
    expect(parseHiddenReason("  Zgłoszenie od odbiorcy  ")).toBe("Zgłoszenie od odbiorcy");
    expect(parseHiddenReason("a".repeat(10))).toBe("a".repeat(10));
    expect(parseHiddenReason("a".repeat(400))).toBe("a".repeat(400));
  });

  it("refuses a reason that is too short, too long, not text or with control characters", () => {
    expect(parseHiddenReason("a".repeat(9))).toBeNull();
    expect(parseHiddenReason("a".repeat(401))).toBeNull();
    expect(parseHiddenReason(undefined)).toBeNull();
    expect(parseHiddenReason(12345678901)).toBeNull();
    expect(parseHiddenReason("powód\nz łamaniem linii")).toBeNull();
  });
});
