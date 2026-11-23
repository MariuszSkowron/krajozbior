"use client";

import { createContext, useCallback, useContext, useState, type ReactNode } from "react";

type CollectionVersion = Readonly<{
  /** The newest version this browser knows: the page's or the one a response of ours returned. */
  current: number;
  /** Remembers the version a successful response of the server reported. */
  report: (value: unknown) => void;
}>;

const CollectionVersionContext = createContext<CollectionVersion | null>(null);

// Publishing, withdrawing and saving raise the version of a collection, but the page data
// refreshes a moment later. In that gap the next request would carry the old version and get a
// false conflict. Every part of the editor therefore sends the larger of the page's version and
// the one returned by our own last successful response. The version is never guessed, so a real
// change by another curator still ends in a conflict.
export function CollectionVersionProvider({
  version,
  children,
}: Readonly<{ version: number; children: ReactNode }>) {
  const [reported, setReported] = useState(0);
  const report = useCallback((value: unknown) => {
    const next =
      typeof value === "object" && value !== null
        ? (value as { version?: unknown }).version
        : undefined;

    if (typeof next === "number" && Number.isInteger(next)) {
      setReported((known) => Math.max(known, next));
    }
  }, []);

  return (
    <CollectionVersionContext.Provider value={{ current: Math.max(version, reported), report }}>
      {children}
    </CollectionVersionContext.Provider>
  );
}

export function useCollectionVersion(fallback: number): CollectionVersion {
  const context = useContext(CollectionVersionContext);

  return context ?? { current: fallback, report: () => undefined };
}
