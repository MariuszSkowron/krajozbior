// Wynik akcji ma być widoczny bez ręcznego przewijania: przewija tylko, gdy elementu nie widać,
// łagodnie (bez animacji przy `prefers-reduced-motion`). Przypięty pasek u dołu uwzględnia
// `scroll-padding-bottom` strony (app-shell.module.css), więc wynik nie leży pod paskiem.
//
// Z drugim elementem (`last`) widoczny ma być cały zakres od początku `element` do końca `last`
// (komunikat i lista pod nim). Gdy razem się nie mieszczą w oknie nad paskiem, na górze okna
// stoi początek zakresu, czyli komunikat; nigdy nie chowa się go nad górną krawędzią.
const EDGE_PX = 8;

export function revealResult(element: HTMLElement | null, last: HTMLElement | null = null): void {
  if (element === null) {
    return;
  }

  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const behavior = reduced ? "auto" : "smooth";

  if (last === null) {
    element.scrollIntoView({ block: "nearest", behavior });

    return;
  }

  const first = element.getBoundingClientRect();
  const end = last.getBoundingClientRect();
  const bar = Number.parseFloat(
    getComputedStyle(document.documentElement).getPropertyValue("--pinned-action-height"),
  );
  const limit = window.innerHeight - (Number.isFinite(bar) ? bar : 0) - EDGE_PX;
  const fits = end.bottom - first.top <= limit - EDGE_PX;
  let delta = 0;

  if (first.top < EDGE_PX || !fits) {
    delta = first.top - EDGE_PX;
  } else if (end.bottom > limit) {
    delta = end.bottom - limit;
  }

  if (delta !== 0) {
    window.scrollBy({ top: delta, behavior });
  }
}
