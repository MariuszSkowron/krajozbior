"use client";

import { useEffect, useRef, type ReactNode } from "react";

import styles from "./visit-confirmation.module.css";

// Przycisk główny ekranu miejsca (stan wyjściowy „Potwierdź wizytę”, po wizycie „Odwiedzone”)
// jest na telefonie przypięty do dolnej krawędzi i zastępuje dolny pasek nawigacji (spec E3,
// 5.6 i 5.8; reguły w app-shell.module.css reagują na atrybut `data-pinned-action`). Od progu
// komputera opakowanie jest przezroczyste (`display: contents`), więc układ karty się nie zmienia.
// Wysokość opakowania (sam przycisk albo znacznik „Odwiedzone”) trafia do
// `--pinned-action-height` na <html>; z niej liczą się `scroll-padding-bottom` i dolny
// margines treści, żeby przypięty przycisk nie zasłaniał fokusu (WCAG 2.4.11).
export function PinnedAction({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const dock = ref.current;

    if (dock === null) {
      return;
    }

    const root = document.documentElement;
    const phone = window.matchMedia("(max-width: 47.99rem)");
    const update = () => {
      if (phone.matches) {
        root.style.setProperty(
          "--pinned-action-height",
          `${dock.getBoundingClientRect().height}px`,
        );
      } else {
        root.style.removeProperty("--pinned-action-height");
      }
    };

    update();
    const observer = new ResizeObserver(update);

    observer.observe(dock);
    phone.addEventListener("change", update);

    return () => {
      observer.disconnect();
      phone.removeEventListener("change", update);
      root.style.removeProperty("--pinned-action-height");
    };
  }, []);

  return (
    <div ref={ref} className={styles.dock} data-pinned-action="">
      {children}
    </div>
  );
}
