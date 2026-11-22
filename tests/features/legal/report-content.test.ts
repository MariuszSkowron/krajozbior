import { describe, expect, it } from "vitest";

import {
  reportContentBody,
  reportContentMailto,
  reportContentSubject,
} from "@/features/legal/domain/report-content";

function parts(href: string) {
  const [address, query] = href.replace("mailto:", "").split("?");
  const params = new URLSearchParams(query);

  return { address, subject: params.get("subject")!, body: params.get("body")! };
}

describe("reportContentMailto (E5-0)", () => {
  it("writes to the address from the terms, with the page address in subject and body", () => {
    const href = reportContentMailto(
      { path: "/places/abc", title: "Most Tczewski" },
      "https://krajozbior.example",
    );
    const { address, subject, body } = parts(href);

    expect(href.startsWith("mailto:kontakt@mariuszskowron.pl?")).toBe(true);
    expect(address).toBe("kontakt@mariuszskowron.pl");
    expect(subject).toBe("Zgłoszenie treści: Most Tczewski");
    expect(body).toContain("https://krajozbior.example/places/abc (Most Tczewski)");
  });

  it("encodes the subject, so spaces, diacritics and & cannot break the address", () => {
    const href = reportContentMailto({ path: "/x", title: "Zamek & Ogród? #1" }, "");

    expect(href).toContain(
      "subject=Zg%C5%82oszenie%20tre%C5%9Bci%3A%20Zamek%20%26%20Ogr%C3%B3d%3F%20%231",
    );
    expect(href.split("?")).toHaveLength(2);
    expect(parts(href).subject).toBe("Zgłoszenie treści: Zamek & Ogród? #1");
  });

  it("drops the query and fragment of the address, which may carry a return address", () => {
    const { body, subject } = parts(
      reportContentMailto({ path: "/login?next=/my/profile#a" }, "https://k.example"),
    );

    expect(subject).toBe("Zgłoszenie treści: /login");
    expect(body).toContain("https://k.example/login");
    expect(body).not.toContain("next=");
  });

  it("keeps a full address as it is and shortens a very long title", () => {
    const { body, subject } = parts(
      reportContentMailto(
        { path: "https://a.example/p", title: "x".repeat(200) },
        "https://b.example",
      ),
    );

    expect(body).toContain("https://a.example/p");
    expect(body).not.toContain("https://b.example");
    expect(subject.length).toBeLessThan(120);
    expect(subject.endsWith("…")).toBe(true);
  });

  it("asks for the four points of the terms and contains no personal data", () => {
    const body = reportContentBody("https://k.example/a");

    for (const point of [
      "1. Wskazanie treści",
      "2. Dlaczego",
      "3. Imię i nazwisko",
      "4. Oświadczam",
    ]) {
      expect(body).toContain(point);
    }
    expect(body).not.toMatch(/@(?!mariuszskowron)/);
    expect(reportContentSubject({ path: "/" })).toBe("Zgłoszenie treści: /");
  });
});
