"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { BookmarkIcon, CardsIcon, HomeIcon, ProfileIcon } from "@/design-system/icons/icons";

import styles from "../app-shell.module.css";
import { activeNavHref, isCuratorPath, navItems, type NavIconName } from "./nav-items";

const icons = {
  home: HomeIcon,
  cards: CardsIcon,
  bookmark: BookmarkIcon,
  profile: ProfileIcon,
} satisfies Record<NavIconName, typeof HomeIcon>;

// Główna nawigacja zalogowanego odkrywcy: na telefonie dolny pasek, od progu komputera menu
// boczne (ten sam DOM, jeden próg 48 rem). Bieżąca pozycja ma aria-current="page"; jej napis
// jest w kolorze strong, a akcentem są tylko ikona i kropka (D-23: akcentowy napis na szkle
// nie zawsze ma 4,5:1). Link nie ma podkreślenia: rozpoznaje się go po kształcie i położeniu.
export function MainNav() {
  const pathname = usePathname() ?? "";
  const active = activeNavHref(pathname);

  return (
    <nav
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
                <span className={styles.navLabel}>{item.label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
