import { describe, expect, it } from "vitest";

import { LEGAL_DOCUMENTS } from "@/features/legal/content";
import { LEGAL_PAGES, isLegalPath } from "@/features/legal/domain/legal-pages";
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

describe("the texts of the legal pages (K-12, E11-Q12)", () => {
  // K-12: no working marker may be shown to the public. While the owner has not given the
  // missing data (the Brevo agreement, the mailbox provider, the effective date, the
  // curator who decides about photos), this test FAILS on purpose and lists what is open;
  // it is the gate in front of the public traffic (spec 5.4a), not something to switch off.
  it("have no working markers left", () => {
    const open = documents.flatMap((document) =>
      [...document.markdown.matchAll(/\[(?:DO UZUPEŁNIENIA|PRAWNIK)[^\]]*\]/g)].map(
        ([marker]) => `${document.slug}: ${marker}`,
      ),
    );

    expect(open).toEqual([]);
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
