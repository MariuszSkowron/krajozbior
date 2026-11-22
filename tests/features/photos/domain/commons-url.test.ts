import { describe, expect, it } from "vitest";

import {
  buildCommonsThumbUrl,
  commonsFileName,
  pickThumbWidth,
} from "@/features/photos/domain/commons-url";

describe("pickThumbWidth", () => {
  it("takes the largest standard step strictly below the source width, never above 1920", () => {
    expect(pickThumbWidth(5000)).toBe(1920);
    expect(pickThumbWidth(1921)).toBe(1920);
    expect(pickThumbWidth(1500)).toBe(1280);
    expect(pickThumbWidth(400)).toBe(330);
    expect(pickThumbWidth(21)).toBe(20);
  });

  it("never picks a step equal to the source width (Wikimedia does not scale to the same width)", () => {
    expect(pickThumbWidth(1920)).toBe(1280);
    expect(pickThumbWidth(1280)).toBe(960);
    expect(pickThumbWidth(960)).toBe(500);
    expect(pickThumbWidth(500)).toBe(330);
  });

  it("gives null for a source not wider than the smallest step or a bad width", () => {
    expect(pickThumbWidth(20)).toBeNull();
    expect(pickThumbWidth(19)).toBeNull();
    expect(pickThumbWidth(0)).toBeNull();
    expect(pickThumbWidth(-5)).toBeNull();
    expect(pickThumbWidth(1.5)).toBeNull();
  });
});

describe("commonsFileName", () => {
  it("drops the File: prefix and turns spaces into underscores", () => {
    expect(commonsFileName("  File:Wieża na górze.jpg ")).toBe("Wieża_na_górze.jpg");
    expect(commonsFileName("Plik:A b.png")).toBe("A_b.png");
    expect(commonsFileName("A b.png")).toBe("A_b.png");
  });
});

describe("buildCommonsThumbUrl", () => {
  it("builds the thumb address with the MD5 directory (the known Example.jpg)", () => {
    expect(buildCommonsThumbUrl("Example.jpg", 5000)).toBe(
      "https://upload.wikimedia.org/wikipedia/commons/thumb/a/a9/Example.jpg/1920px-Example.jpg",
    );
  });

  it("encodes every segment, also the characters encodeURIComponent leaves", () => {
    const url = buildCommonsThumbUrl("Wieża (2) 'x'*!.jpg", 3000)!;

    expect(url).toContain(
      "/Wie%C5%BCa_%282%29_%27x%27%2A%21.jpg/1920px-Wie%C5%BCa_%282%29_%27x%27%2A%21.jpg",
    );
    expect(url.startsWith("https://upload.wikimedia.org/wikipedia/commons/thumb/")).toBe(true);
  });

  it("refuses an empty name, a name with a slash and a source without a usable width", () => {
    expect(buildCommonsThumbUrl("   ", 3000)).toBeNull();
    expect(buildCommonsThumbUrl("a/b.jpg", 3000)).toBeNull();
    expect(buildCommonsThumbUrl("Example.jpg", 10)).toBeNull();
  });
});
