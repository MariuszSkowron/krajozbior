import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import SourcesPage from "@/app/zrodla/page";

describe("sources page", () => {
  it("states the month the data was retrieved", () => {
    const html = renderToStaticMarkup(createElement(SourcesPage));

    expect(html).toContain("Dane pobrano: listopad 2026.");
  });
});
