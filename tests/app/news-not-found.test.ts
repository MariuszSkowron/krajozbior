import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

const notFound = await import("@/app/news/not-found");

describe("news not-found page", () => {
  it("keeps the generic message and leads back to the list of news", () => {
    const html = renderToStaticMarkup(notFound.default());

    expect(html).toContain("<h1>Nie znaleziono</h1>");
    expect(html).toContain("Tej strony nie ma albo nie jest dostępna.");
    expect(html).toContain('href="/news">Zobacz aktualności</a>');
  });

  it("names neither the address nor the reason", () => {
    const html = renderToStaticMarkup(notFound.default());

    expect(html).not.toMatch(/wycofan|szkic|usuni/i);
  });
});
