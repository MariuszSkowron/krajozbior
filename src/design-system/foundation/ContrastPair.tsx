"use client";

import { useEffect, useRef, useState } from "react";

import { tokenVar, type TokenName } from "../tokens/tokens";
import styles from "./foundation.module.css";

function channels(color: string): number[] {
  return (color.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number);
}

function luminance(color: string): number {
  const [r, g, b] = channels(color).map((value) => {
    const c = value / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Próbka „tekst na tle” z kontrastem policzonym z obliczonych kolorów (bieżący motyw). */
export function ContrastPair({
  foreground,
  background,
  minimum,
}: Readonly<{ foreground: TokenName; background: TokenName; minimum: number }>) {
  const ref = useRef<HTMLLIElement>(null);
  const [ratio, setRatio] = useState<number | null>(null);

  useEffect(() => {
    // Odczyt po zmianie motywu: dekorator zmienia klasę na <html>, więc obserwujemy ją.
    const read = () => {
      if (ref.current === null) return;
      const style = getComputedStyle(ref.current);
      const [light, dark] = [luminance(style.color), luminance(style.backgroundColor)].sort(
        (a, b) => b - a,
      );
      setRatio((light + 0.05) / (dark + 0.05));
    };
    read();
    const observer = new MutationObserver(read);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, [foreground, background]);

  return (
    <li
      className={styles.swatch}
      ref={ref}
      style={{ color: tokenVar(foreground), background: tokenVar(background) }}
    >
      {foreground.replace("color.", "")} / {background.replace("color.", "")}
      <br />
      <span>
        {ratio === null ? "" : `${ratio.toFixed(2)}:1`} (min. {minimum}:1)
      </span>
    </li>
  );
}
