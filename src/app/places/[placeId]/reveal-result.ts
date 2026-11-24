// Wynik akcji ma być widoczny bez ręcznego przewijania: przewija tylko, gdy elementu nie widać,
// łagodnie (bez animacji przy `prefers-reduced-motion`). Przypięty pasek u dołu uwzględnia
// `scroll-padding-bottom` strony (app-shell.module.css), więc wynik nie leży pod paskiem.
export function revealResult(element: HTMLElement | null): void {
  if (element === null) {
    return;
  }

  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  element.scrollIntoView({ block: "nearest", behavior: reduced ? "auto" : "smooth" });
}
