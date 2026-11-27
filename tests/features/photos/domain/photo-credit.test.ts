import { describe, expect, it } from "vitest";

import {
  buildPhotoCredit,
  buildShortPhotoCredit,
  CHANGES_NOTICE,
  shortPhotoCreditText,
  type PhotoCreditInput,
} from "@/features/photos/domain/photo-credit";

const base: PhotoCreditInput = {
  sourceKind: "commons_import",
  title: "Zamek w Malborku",
  authorText: "Fikcyjny Autor",
  authorUrl: "https://commons.wikimedia.org/wiki/User:Fikcyjny",
  sourceUrl: "https://commons.wikimedia.org/wiki/File:Zamek.jpg",
  licenseCode: "cc-by-sa-3.0",
  licenseUrl: "https://creativecommons.org/licenses/by-sa/3.0/pl/",
  licenseLabel: "CC BY-SA 3.0 PL",
};

describe("buildPhotoCredit", () => {
  it("names author, source and the exact licence version with their links", () => {
    expect(buildPhotoCredit(base)).toEqual({
      title: "Zamek w Malborku",
      author: { text: "Fikcyjny Autor", url: "https://commons.wikimedia.org/wiki/User:Fikcyjny" },
      source: {
        label: "Wikimedia Commons",
        url: "https://commons.wikimedia.org/wiki/File:Zamek.jpg",
      },
      license: {
        heading: "Licencja",
        label: "CC BY-SA 3.0 PL",
        url: "https://creativecommons.org/licenses/by-sa/3.0/pl/",
      },
      notices: [CHANGES_NOTICE, "Tę kopię udostępniamy na tej samej licencji."],
    });
  });

  it("says the file was changed for every CC licence, and about the copy only for BY-SA", () => {
    expect(
      buildPhotoCredit({ ...base, licenseCode: "cc-by-4.0", licenseLabel: "CC BY 4.0" }).notices,
    ).toEqual([CHANGES_NOTICE]);
    expect(
      buildPhotoCredit({ ...base, licenseCode: "cc0-1.0", licenseLabel: "CC0 1.0" }).notices,
    ).toEqual([CHANGES_NOTICE]);
  });

  it("heads the public domain mark with Status, not Licencja (it is not a licence)", () => {
    const credit = buildPhotoCredit({
      ...base,
      licenseCode: "public-domain",
      licenseLabel: "domena publiczna",
    });

    expect(credit.license.heading).toBe("Status");
    expect(buildPhotoCredit(base).license.heading).toBe("Licencja");
  });

  it("adds no notice for the public domain mark, which is not a licence", () => {
    expect(
      buildPhotoCredit({ ...base, licenseCode: "public-domain", licenseLabel: "domena publiczna" })
        .notices,
    ).toEqual([]);
  });

  it("keeps missing optional parts as null", () => {
    const credit = buildPhotoCredit({
      ...base,
      title: null,
      authorUrl: null,
      sourceUrl: null,
      licenseUrl: null,
    });

    expect(credit.title).toBeNull();
    expect(credit.author.url).toBeNull();
    expect(credit.source).toBeNull();
    expect(credit.license.url).toBeNull();
  });

  it("labels the source of a photo that does not come from Commons neutrally", () => {
    expect(buildPhotoCredit({ ...base, sourceKind: "third_party" }).source?.label).toBe("Źródło");
  });
});

describe("buildShortPhotoCredit", () => {
  it("is one line: place, 'fot.' author with source, licence and the change notice", () => {
    expect(shortPhotoCreditText("Zamek w Malborku", buildShortPhotoCredit(base))).toBe(
      "Zamek w Malborku · fot. Fikcyjny Autor, Wikimedia Commons · CC BY-SA 3.0 PL · zdjęcie zmniejszone",
    );
  });

  it("drops the sentence about the licence of the copy and the WebP remark", () => {
    const text = shortPhotoCreditText(null, buildShortPhotoCredit(base));

    expect(text).not.toContain("Tę kopię udostępniamy");
    expect(text).not.toContain("WebP");
    expect(text).not.toContain("skompresowane");
    expect(text).not.toContain("Autor:");
    expect(text.startsWith("fot. Fikcyjny Autor")).toBe(true);
  });

  it("keeps the licence link", () => {
    expect(buildShortPhotoCredit(base).license).toEqual({
      label: "CC BY-SA 3.0 PL",
      url: "https://creativecommons.org/licenses/by-sa/3.0/pl/",
    });
  });

  it("says nothing about changes for the public domain mark and skips a missing source", () => {
    const credit = buildShortPhotoCredit({
      ...base,
      sourceUrl: null,
      licenseCode: "public-domain",
      licenseLabel: "domena publiczna",
    });

    expect(shortPhotoCreditText("Most", credit)).toBe(
      "Most · fot. Fikcyjny Autor · domena publiczna",
    );
  });
});
