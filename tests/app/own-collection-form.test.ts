import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));

const { OwnCollectionForm } = await import("@/app/my/collections/own/own-collection-form");

describe("OwnCollectionForm region", () => {
  it("starts a new collection with the empty option, so the required field must be chosen", () => {
    const html = renderToStaticMarkup(createElement(OwnCollectionForm, { mode: "create" }));
    const select = html.match(/<select[^>]*name="region"[^>]*>/)?.[0] ?? "";

    expect(select).toContain("required");
    expect(html).toMatch(/<option value="" disabled(="")?[^>]*>Wybierz region<\/option>/);
    expect(html).not.toMatch(/<option[^>]*selected[^>]*>Pomorskie/);
  });

  it("shows no empty option when an existing collection has its region", () => {
    const html = renderToStaticMarkup(
      createElement(OwnCollectionForm, {
        mode: "edit",
        collection: {
          id: "c1",
          version: 1,
          title: "Wieże",
          summary: "",
          region: "pomorskie",
        },
      }),
    );

    expect(html).not.toContain("Wybierz region");
  });
});
