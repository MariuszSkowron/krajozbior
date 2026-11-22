"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";

import {
  BookmarkIcon,
  CardsIcon,
  HomeIcon,
  NewsIcon,
  ProfileIcon,
} from "@/design-system/icons/icons";

import styles from "../app-shell.module.css";
import { activeNavHref, isCuratorPath, navItems, type NavIconName } from "./nav-items";

const icons = {
  home: HomeIcon,
  cards: CardsIcon,
  bookmark: BookmarkIcon,
  profile: ProfileIcon,
  news: NewsIcon,
} satisfies Record<NavIconName, typeof HomeIcon>;

// Główna nawigacja zalogowanego odkrywcy: na telefonie dolny pasek, od progu komputera menu
// boczne (ten sam DOM, jeden próg 48 rem). Bieżąca pozycja ma aria-current="page"; jej napis
// jest w kolorze strong, a akcentem są tylko ikona i kropka (D-23: akcentowy napis na szkle
// nie zawsze ma 4,5:1). Link nie ma podkreślenia: rozpoznaje się go po kształcie i położeniu.
export function MainNav() {
  const pathname = usePathname() ?? "";
  const active = activeNavHref(pathname);
  const navRef = useRef<HTMLElement>(null);

  // Przy tekście powiększonym do 200% etykiety zawijają się i pasek rośnie ponad stałe minimum,
  // więc rezerwę pod pasek (`--shell-bottom-bar-height`) ustawiamy na jego zmierzoną wysokość.
  // Do pierwszego pomiaru i bez JavaScriptu obowiązuje minimum z CSS. Na komputerze menu jest
  // boczne, więc zmienna wraca do wartości z CSS.
  useEffect(() => {
    const nav = navRef.current;
    if (nav === null) {
      return;
    }

    const root = document.documentElement;
    const phone = window.matchMedia("(max-width: 47.99rem)");
    const update = () => {
      // Ukryty pasek (ekran miejsca z przypiętym przyciskiem) nie rezerwuje miejsca: wtedy
      // zmienną ustawia CSS z wysokości przycisku.
      if (phone.matches && getComputedStyle(nav).display !== "none") {
        root.style.setProperty(
          "--shell-bottom-bar-height",
          `${nav.getBoundingClientRect().height}px`,
        );
      } else {
        root.style.removeProperty("--shell-bottom-bar-height");
      }
    };

    update();
    const observer = new ResizeObserver(update);
    observer.observe(nav);
    phone.addEventListener("change", update);

    return () => {
      observer.disconnect();
      phone.removeEventListener("change", update);
      root.style.removeProperty("--shell-bottom-bar-height");
    };
  }, []);

  return (
    <nav
      ref={navRef}
      className={styles.nav}
      aria-label="Główna"
      data-area={isCuratorPath(pathname) ? "curator" : undefined}
    >
      <ul className={styles.navList}>
        {navItems.map((item) => {
          const Icon = icons[item.icon];
          const current = item.href === active;

          return (
            <li key={item.href}>
              <Link
                className={styles.navLink}
                href={item.href}
                aria-current={current ? "page" : undefined}
              >
                {current ? <span className={styles.navDot} aria-hidden="true" /> : null}
                <Icon className={styles.navIcon} />
                <span>{item.label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
