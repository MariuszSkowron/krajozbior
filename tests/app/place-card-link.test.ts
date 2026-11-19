import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const replace = vi.hoisted(() => vi.fn());

vi.mock("next/navigation", () => ({ useRouter: () => ({ replace }) }));

const { PlaceCardLink } = await import("@/app/collections/[slug]/place-card-link");

type LinkElement = { props: { onClick: (event: unknown) => void } };

const props = {
  href: "/places/p1",
  selectHref: "/collections/k?miejsce=p1",
  className: "card",
  selected: false,
  children: "Most",
};

function click(event: Record<string, unknown> = {}) {
  const fake = {
    defaultPrevented: false,
    button: 0,
    metaKey: false,
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    preventDefault: vi.fn(),
    ...event,
  };

  (PlaceCardLink(props) as unknown as LinkElement).props.onClick(fake);

  return fake;
}

function screen(desktop: boolean) {
  vi.stubGlobal("window", {
    matchMedia: (query: string) => ({ matches: desktop && query === "(min-width: 48rem)" }),
  });
}

beforeEach(() => replace.mockReset());
afterEach(() => vi.unstubAllGlobals());

describe("PlaceCardLink", () => {
  it("is a plain link to the page of the place, marked when selected", () => {
    expect(renderToStaticMarkup(createElement(PlaceCardLink, props))).toBe(
      '<a class="card" href="/places/p1">Most</a>',
    );
    expect(renderToStaticMarkup(createElement(PlaceCardLink, { ...props, selected: true }))).toBe(
      '<a class="card" aria-current="true" href="/places/p1">Most</a>',
    );
  });

  it("on a desktop screen takes over a plain click and only changes the address, without scrolling", () => {
    screen(true);

    const event = click();

    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(replace).toHaveBeenCalledWith("/collections/k?miejsce=p1", { scroll: false });
  });

  it("on a phone leaves the click to the link (the page of the place)", () => {
    screen(false);

    const event = click();

    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(replace).not.toHaveBeenCalled();
  });

  it.each([
    ["middle button", { button: 1 }],
    ["Ctrl", { ctrlKey: true }],
    ["Cmd", { metaKey: true }],
    ["Shift", { shiftKey: true }],
    ["Alt", { altKey: true }],
    ["a click already handled", { defaultPrevented: true }],
  ])("leaves a click with %s to the browser", (_name, event) => {
    screen(true);

    const fake = click(event);

    expect(fake.preventDefault).not.toHaveBeenCalled();
    expect(replace).not.toHaveBeenCalled();
  });
});
