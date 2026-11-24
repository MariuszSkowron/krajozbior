import { expect, type Locator } from "@playwright/test";

// The short credit under a photo is one sentence with inline links. WCAG 2.5.8 exempts links in a
// sentence from the 24 px target, and `docs/design/accessibility.md` records the same exception
// for the project's own 44 px (links of the credit). What stays under test instead: every link
// has an accessible name, can be reached with the keyboard, shows a focus outline, and its box is
// not smaller than the text line it sits in.
export async function expectCreditLinksUsable(caption: Locator): Promise<void> {
  const links = caption.getByRole("link");
  const count = await links.count();

  expect(count).toBeGreaterThan(0);

  for (let index = 0; index < count; index += 1) {
    const link = links.nth(index);

    await expect(link).toHaveAccessibleName(/\S/);
    await expect(link).not.toHaveAttribute("tabindex", "-1");

    await link.focus();
    await expect(link).toBeFocused();

    const outline = await link.evaluate((element) => {
      const style = getComputedStyle(element);

      return {
        width: Number.parseFloat(style.outlineWidth),
        style: style.outlineStyle,
        fontSize: Number.parseFloat(style.fontSize),
      };
    });

    expect(outline.style).not.toBe("none");
    expect(outline.width).toBeGreaterThan(0);

    const box = (await link.boundingBox())!;

    // An inline link is as tall as its text; it must not be squeezed below the font size.
    expect(box.height).toBeGreaterThanOrEqual(outline.fontSize);
    expect(box.width).toBeGreaterThan(0);
  }

  // Leave the page as it was: no focus ring over the text and no scroll, so the contrast
  // measurements that follow in the same test see the same pixels as without this check.
  await caption.page().evaluate(() => {
    (document.activeElement as HTMLElement | null)?.blur();
    window.scrollTo(0, 0);
  });
}
