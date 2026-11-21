import { describe, expect, it } from "vitest";

import { LEGAL_DOCUMENTS } from "@/features/legal/content";
import { LEGAL_PAGES, isLegalPath } from "@/features/legal/domain/legal-pages";
import { findLegalMarkers } from "@/features/legal/domain/markers";
import { parseMarkdown, type Block, type Inline } from "@/features/legal/domain/markdown";
import { SESSION_LIMIT_MS } from "@/features/identity/domain/session-policy";
import { PROFILE_DRAFT_MAX_AGE_SECONDS } from "@/features/profile/domain/profile-draft";
import { CURRENT_TERMS_VERSION } from "@/features/terms/domain/terms-version";

const documents = Object.values(LEGAL_DOCUMENTS);
const DAY_MS = 24 * 60 * 60 * 1000;

function inlinesOf(blocks: readonly Block[]): Inline[] {
  return blocks.flatMap((block): Inline[] => {
    switch (block.kind) {
      case "heading":
        return [{ kind: "text", text: block.text }];
      case "paragraph":
        return block.inlines;
      case "list":
        return block.items.flatMap((item) => [...item.inlines, ...inlinesOf(item.children)]);
      case "table":
        return [...block.header, ...block.rows.flat()].flat();
    }
  });
}

// K-12: the working markers still open, each with who fills it and when (D-41 pt 2). The list
// may only shrink: a new or changed marker fails the test below, and so does an item that is
// no longer in the texts. The hard gate is `npm run legal:final` (no marker at all), run before
// the password comes off the service (spec 5.4a, docs/deployment.md).
const OPEN_LEGAL_MARKERS: readonly Readonly<{ marker: string; owner: string }>[] = [
  {
    marker: "polityka-prywatnosci: [DO UZUPEŁNIENIA: adres z umowy powierzenia]",
    owner: "właściciel, z umowy powierzenia Brevo (D-41 pkt 2)",
  },
  {
    marker: "polityka-prywatnosci: [DO UZUPEŁNIENIA: potwierdzić w panelu Brevo]",
    owner: "właściciel, z panelu Brevo (D-41 pkt 2)",
  },
  {
    marker: "polityka-prywatnosci: [DO UZUPEŁNIENIA: dostawca skrzynki kontakt@mariuszskowron.pl]",
    owner: "właściciel (D-41 pkt 2)",
  },
  {
    marker: "polityka-prywatnosci: [DO UZUPEŁNIENIA: państwa i zabezpieczenia]",
    owner: "z publicznej polityki prywatności OpenStreetMap Foundation, po sprawdzeniu źródła",
  },
  {
    marker:
      "polityka-prywatnosci: [DO UZUPEŁNIENIA: czy podwykonawcy Brevo przetwarzają dane poza EOG i na jakiej podstawie]",
    owner: "właściciel, z umowy powierzenia Brevo (D-41 pkt 2)",
  },
  {
    marker: "regulamin: [DO UZUPEŁNIENIA: data pierwszego wdrożenia]",
    owner: "w dniu wdrożenia (D-41 pkt 2)",
  },
];

describe("the texts of the legal pages (K-12, E11-Q12)", () => {
  it("have only the working markers on the explicit list of open items", () => {
    expect(findLegalMarkers(documents).sort()).toEqual(
      OPEN_LEGAL_MARKERS.map((item) => item.marker).sort(),
    );
  });

  it("find every kind of working marker, the lawyer's too", () => {
    expect(
      findLegalMarkers([
        { slug: "a", markdown: "x [DO UZUPEŁNIENIA: data] y [PRAWNIK: sprawdzić] z [inne]" },
        { slug: "b", markdown: "bez znaczników" },
      ]),
    ).toEqual(["a: [DO UZUPEŁNIENIA: data]", "a: [PRAWNIK: sprawdzić]"]);
  });

  it.each(documents)("$slug parses into headings and has only known internal links", (document) => {
    const blocks = parseMarkdown(document.markdown);
    const links = inlinesOf(blocks).filter((inline) => inline.kind === "link");

    expect(blocks.some((block) => block.kind === "heading")).toBe(true);

    for (const link of links) {
      if (link.href.startsWith("/")) {
        expect(isLegalPath(link.href), `${document.slug}: ${link.href}`).toBe(true);
      }
    }
  });

  it("covers every legal page with exactly one document", () => {
    expect(documents.map((document) => document.slug).sort()).toEqual(
      LEGAL_PAGES.map((page) => page.slug).sort(),
    );
  });

  it("carry the version the accounts accept: the terms version equals the one of the page", () => {
    expect(LEGAL_DOCUMENTS.regulamin.version).toBe(CURRENT_TERMS_VERSION);
    for (const document of documents) {
      expect(document.version, document.slug).toBe(CURRENT_TERMS_VERSION);
    }
  });

  it("contain none of the draft notes for the lawyer", () => {
    for (const document of documents) {
      expect(document.markdown, document.slug).not.toMatch(
        /PRAWNIK|WERSJA ROBOCZA — nie publikować/,
      );
    }
  });
});

describe("the texts agree with the code (finding 15 of the review)", () => {
  const policy = LEGAL_DOCUMENTS["polityka-prywatnosci"].markdown;

  it("names the session of an explorer as SESSION_LIMIT_MS.user days", () => {
    const days = SESSION_LIMIT_MS.user / DAY_MS;

    expect(Number.isInteger(days)).toBe(true);
    expect(policy).toContain(`| utrzymanie sesji po zalogowaniu | ${days} dni od zalogowania |`);
  });

  it("names the profile draft cookie as long as the code keeps it", () => {
    const minutes = PROFILE_DRAFT_MAX_AGE_SECONDS / 60;

    expect(minutes).toBe(2);
    expect(policy).toContain(`| zapamiętanie niezapisanych zmian w profilu | ${minutes} minuty |`);
  });

  it("gives the agreed periods of the backups and the technical logs (E11-Q12)", () => {
    expect(policy).toContain("| kopie zapasowe | najdłużej 30 dni;");
    expect(policy).toContain("| dane techniczne (adres IP, zapisy błędów) | najdłużej 14 dni |");
    expect(LEGAL_DOCUMENTS.zasady.markdown).toContain("Dane techniczne usuwamy po 14 dniach.");
    expect(LEGAL_DOCUMENTS.zasady.markdown).toContain("Z kopii zapasowych znikną po 30 dniach.");
  });

  it("does not describe the rejected photos, which do not exist before E4", () => {
    for (const document of documents) {
      expect(document.markdown, document.slug).not.toMatch(/odrzucon\w+ przez kuratora/);
    }
  });
});
