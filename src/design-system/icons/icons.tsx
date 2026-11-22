import type { ReactNode } from "react";

// Liniowe ikony rysowane w repozytorium (siatka 24 px, kontur 1,7 px, zaokrąglone końce), bez
// biblioteki ikon (docs/design/ui-foundation.md). Ikona jest dekoracją: znaczenie niesie
// zawsze napis obok niej, więc `aria-hidden`. Kolor dziedziczy z `currentColor`, rozmiar
// z `size` (piksele) albo z klasy.
type IconProps = Readonly<{ size?: number; className?: string }>;

function Icon({ size, className, children }: IconProps & Readonly<{ children: ReactNode }>) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}

// Start.
export function HomeIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M4 11 12 4l8 7" />
      <path d="M6 9.5V20h12V9.5" />
      <path d="M10 20v-5h4v5" />
    </Icon>
  );
}

// Moje kolekcje: dwie karty jedna za drugą.
export function CardsIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <rect x="7" y="3.5" width="13" height="13" rx="2.5" />
      <path d="M4 8v9.5A2.5 2.5 0 0 0 6.5 20H16" />
    </Icon>
  );
}

// Chcę zobaczyć: zakładka.
export function BookmarkIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M6.5 4h11a1 1 0 0 1 1 1v15l-6.5-4.5L5.5 20V5a1 1 0 0 1 1-1Z" />
    </Icon>
  );
}

// Konto.
export function ProfileIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="12" cy="8.5" r="3.5" />
      <path d="M5 20c.8-3.6 3.6-5.5 7-5.5s6.2 1.9 7 5.5" />
    </Icon>
  );
}

// Aktualności: złożona gazeta.
export function NewsIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M6 4h12a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H6.5A2.5 2.5 0 0 1 4 17.5V6a2 2 0 0 1 2-2Z" />
      <path d="M8 8.5h8M8 12h8M8 15.5h5" />
    </Icon>
  );
}

// Miejsce: pinezka.
export function PinIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M12 21s6.5-5.6 6.5-11a6.5 6.5 0 0 0-13 0c0 5.4 6.5 11 6.5 11Z" />
      <circle cx="12" cy="10" r="2.3" />
    </Icon>
  );
}
