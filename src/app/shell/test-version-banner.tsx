"use client";

import { useSyncExternalStore } from "react";

import styles from "../app-shell.module.css";

const CLOSED_KEY = "krajozbior.test-banner-closed";

const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);

  return () => {
    listeners.delete(listener);
  };
}

// Closed for the time of the tab: sessionStorage forgets it when the tab closes. Without
// storage (a private window, blocked data) the bar simply stays until the page is left.
let closedWithoutStorage = false;

function isClosed(): boolean {
  try {
    return closedWithoutStorage || sessionStorage.getItem(CLOSED_KEY) === "1";
  } catch {
    return closedWithoutStorage;
  }
}

function close() {
  closedWithoutStorage = true;

  try {
    sessionStorage.setItem(CLOSED_KEY, "1");
  } catch {
    // The flag above keeps it closed until the page is left.
  }

  listeners.forEach((listener) => listener());
}

// The "Wersja konkursowa" bar (D-67 point 6): some functions are launched later, and the bar says
// so on every page. It can be closed for the session. The links are plain anchors on purpose: a
// full page load redraws the shell, so the terms screen cannot be skipped by a soft navigation.
export function TestVersionBanner() {
  const closed = useSyncExternalStore(subscribe, isClosed, () => false);

  if (closed) {
    return null;
  }

  return (
    <div className={styles.testBanner} role="region" aria-label="Wersja konkursowa">
      <p>
        <strong>Wersja konkursowa</strong> — część funkcji uruchomimy później.{" "}
        <a href="/zasady">Najważniejsze zasady</a>
      </p>
      <button type="button" className={styles.testBannerClose} onClick={close}>
        Zamknij
      </button>
    </div>
  );
}
