import type { Locator, Page } from "@playwright/test";
import sharp from "sharp";

// Contrast of a line of text over the photo, measured as the axe cannot (it does not see through
// a photo): the page is drawn with every text transparent, the brightest pixel under the box of
// the element is taken as the background (the worst case for light text) and compared with the
// colour of the text blended over it.
export async function contrastOver(page: Page, element: Locator): Promise<number> {
  const box = (await element.boundingBox())!;
  const text = await element.evaluate((node) => {
    const probe = document.createElement("canvas").getContext("2d")!;

    probe.fillStyle = "#000";
    probe.fillStyle = getComputedStyle(node).color;
    const value = probe.fillStyle;

    // `fillStyle` gives "#rrggbb" or "rgba(r, g, b, a)".
    if (value.startsWith("#")) {
      return [
        parseInt(value.slice(1, 3), 16),
        parseInt(value.slice(3, 5), 16),
        parseInt(value.slice(5, 7), 16),
        1,
      ];
    }

    const parts = value.match(/[\d.]+/g)!.map(Number);

    // `color(srgb 1 1 1 / 0.92)` (the result of color-mix) has channels 0..1.
    if (value.startsWith("color(")) {
      return [parts[0]! * 255, parts[1]! * 255, parts[2]! * 255, parts[3] ?? 1];
    }

    return [parts[0]!, parts[1]!, parts[2]!, parts[3] ?? 1];
  });
  const hide = await page.addStyleTag({
    content:
      "* { color: transparent !important; text-shadow: none !important; caret-color: transparent !important; } a, button { text-decoration-color: transparent !important; }",
  });
  const clip = {
    x: Math.max(0, box.x),
    y: Math.max(0, box.y),
    width: Math.max(1, box.width),
    height: Math.max(1, box.height),
  };
  const png = await page.screenshot({ clip });

  await hide.evaluate((node) => (node as Element).remove());

  const { data, info } = await sharp(png).raw().toBuffer({ resolveWithObject: true });
  const luminance = (r: number, g: number, b: number) => {
    const lin = (v: number) => {
      const s = v / 255;

      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    };

    return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  };
  let brightest = [0, 0, 0];
  let best = -1;

  for (let i = 0; i < data.length; i += info.channels) {
    const l = luminance(data[i]!, data[i + 1]!, data[i + 2]!);

    if (l > best) {
      best = l;
      brightest = [data[i]!, data[i + 1]!, data[i + 2]!];
    }
  }

  const [tr, tg, tb, ta] = text as [number, number, number, number];
  const blended = [tr, tg, tb].map((v, k) => v * ta + brightest[k]! * (1 - ta)) as [
    number,
    number,
    number,
  ];
  const a = luminance(...blended);
  const b = luminance(brightest[0]!, brightest[1]!, brightest[2]!);

  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}
