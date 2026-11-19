import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ProfileForm } from "@/app/my/settings/profile-form";
import { REGIONS } from "@/features/catalog/domain/collection";

// E9-2: the "Profil" section of the settings. A native form posting to the
// profile route, with the four fields, all 16 regions, the visibility with one
// sentence about who sees it, and the messages of the result of a save.
const empty = {
  firstName: null,
  familyInitial: null,
  region: null,
  visibility: "private",
} as const;

const render = (
  profile: Parameters<typeof ProfileForm>[0]["profile"] = empty,
  result?: string,
  fields?: string,
) => renderToStaticMarkup(createElement(ProfileForm, { profile, result, fields }));

describe("ProfileForm", () => {
  it("is a native post to the profile route and names no owner", () => {
    const html = render();

    expect(html).toMatch(/<form [^>]*action="\/api\/me\/profile"[^>]*method="post"/);
    expect(html).toContain('name="firstName"');
    expect(html).toContain('name="familyInitial"');
    expect(html).toContain('name="region"');
    expect(html).toContain('name="visibility"');
    expect(html).not.toMatch(/name="(userId|user_id|id)"/);
    expect(html).not.toContain('role="alert"');
    expect(html).not.toContain('role="status"');
  });

  it('offers every voivodeship and "Nie podaję"', () => {
    const html = render();

    for (const region of REGIONS) {
      expect(html).toContain(`value="${region}"`);
    }
    expect(html).toContain("Nie podaję");
  });

  it("explains who sees the profile and keeps the private choice by default", () => {
    const html = render();

    expect(html).toContain("Kto zobaczy Twój profil");
    expect(html).toContain("Nikt poza Tobą nie zobaczy Twojego imienia ani regionu.");
    expect(html).toMatch(/<input [^>]*name="visibility" checked="" value="private"/);
    expect(html).not.toMatch(/<input [^>]*name="visibility" checked="" value="public"/);
  });

  it("fills the form with the saved profile", () => {
    const html = render({
      firstName: "Anna",
      familyInitial: "K",
      region: "pomorskie",
      visibility: "public",
    });

    expect(html).toContain('value="Anna"');
    expect(html).toContain('value="K"');
    expect(html).toMatch(/<option value="pomorskie" selected/);
    expect(html).toMatch(/<input [^>]*name="visibility" checked="" value="public"/);
    expect(html).not.toMatch(/<input [^>]*name="visibility" checked="" value="private"/);
  });

  it("confirms a save with a status message", () => {
    const html = render(empty, "zapisano");

    expect(html).toContain('role="status"');
    expect(html).toContain("Zapisano zmiany w profilu.");
  });

  it("explains every failure and marks the wrong fields invalid", () => {
    for (const [code, text] of [
      ["blad", "Popraw zaznaczone pola"],
      ["limit", "Za dużo zapisów"],
      ["niedostepny", "Nie udało się zapisać profilu"],
    ]) {
      const html = render(empty, code);

      expect(html, code).toContain('role="alert"');
      expect(html, code).toContain(text);
    }

    const html = render(empty, "blad", "firstName,familyInitial,region,visibility,nonsense");

    // The radio group has no single field to mark; the other three are marked.
    expect((html.match(/aria-invalid="true"/g) ?? []).length).toBe(3);
    expect(html).toContain("Imię: wpisz do 40 liter");
    expect(html).toContain("Pierwsza litera nazwiska: wpisz jedną literę.");
    expect(html).toContain("Region: wybierz województwo z listy.");
    expect(html).toContain("Widoczność: wybierz jedną z opcji.");
    expect(html).not.toContain("nonsense");
  });

  it("ignores an unknown result code and shows no field list for a failure without fields", () => {
    expect(render(empty, "nieznany")).not.toContain('role="alert"');
    expect(render(empty, "blad")).not.toContain("<li>");
    expect(render(empty, "limit", "firstName")).not.toContain("aria-invalid");
  });
});
