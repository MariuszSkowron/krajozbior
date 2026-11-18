"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ReactNode } from "react";

// The card of a place is an ordinary link to the page of the place (D-E12-6): without JavaScript
// and on a phone it works as such. On a desktop screen (the same threshold as the layout, 48rem)
// a plain click is taken over and only changes the address to `?miejsce=…`, so the panel next to
// the list shows the place without a new document. A click with a modifier key, a middle click
// and "open in a new tab" stay as the browser has them. The focus stays on the card: the same
// element is rendered again, only its text and the panel change.
const DESKTOP = "(min-width: 48rem)";

export function PlaceCardLink({
  href,
  selectHref,
  selected,
  className,
  children,
}: Readonly<{
  href: string;
  selectHref: string;
  selected: boolean;
  className: string;
  children: ReactNode;
}>) {
  const router = useRouter();

  return (
    <Link
      className={className}
      href={href}
      aria-current={selected ? "true" : undefined}
      onClick={(event) => {
        if (
          event.defaultPrevented ||
          event.button !== 0 ||
          event.metaKey ||
          event.ctrlKey ||
          event.shiftKey ||
          event.altKey ||
          !window.matchMedia(DESKTOP).matches
        ) {
          return;
        }

        event.preventDefault();
        router.replace(selectHref, { scroll: false });
      }}
    >
      {children}
    </Link>
  );
}
