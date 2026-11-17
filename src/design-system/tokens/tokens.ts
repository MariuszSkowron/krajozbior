/**
 * Kanoniczne nazwy tokenów (kropki) ↔ zmienne CSS z `tokens.css` (`color.brand.primary` → `--color-brand-primary`).
 * Wartości żyją wyłącznie w `tokens.css`; test pilnuje zgodności listy z plikiem CSS i z `docs/design/tokens.md`.
 */
export const tokenNames = [
  "color.brand.primary",
  "color.brand.accent",
  "color.surface.canvas",
  "color.surface.card",
  "color.surface.elevated",
  "color.surface.tint",
  "color.text.primary",
  "color.text.secondary",
  "color.text.inverse",
  "color.border.default",
  "color.border.subtle",
  "color.border.focus",
  "color.feedback.danger",
  "space.xs",
  "space.sm",
  "space.md",
  "space.lg",
  "space.xl",
  "radius.sm",
  "radius.md",
  "radius.lg",
  "radius.pill",
  "shadow.card",
  "shadow.overlay",
  "size.touch.min",
  "size.touch.primary",
  "font.family.base",
  "font.family.display",
  "font.size.sm",
  "font.size.md",
  "font.size.lg",
  "font.size.xl",
  "font.size.2xl",
  "font.size.3xl",
  "font.weight.strong",
  "line.height.body",
  "line.height.heading",
  "focus.ring.width",
  "focus.ring.offset",
  "motion.duration.short",
  "motion.easing.standard",
] as const;

export type TokenName = (typeof tokenNames)[number];

/** Odwołanie do tokenu w stylu inline lub w danych (CSS Modules używają `var(--…)` wprost). */
export function tokenVar(name: TokenName): string {
  return `var(--${name.replace(/\./g, "-")})`;
}
