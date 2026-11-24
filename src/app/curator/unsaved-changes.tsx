"use client";

import { useRouter } from "next/navigation";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import styles from "./curator.module.css";

// The editors of a collection and of a place keep their text in the form fields. The form
// tells the rest of the panel whether its fields differ from what is saved, so nothing typed
// is lost silently: publishing asks to save first, and leaving the editor (a link of the panel
// or of the menu, closing or reloading the tab) asks before the text is thrown away.
// The provider sits in the layout of the panel, so one mechanism guards both editors.

type UnsavedChanges = Readonly<{ dirty: boolean; setDirty: (dirty: boolean) => void }>;

const UnsavedChangesContext = createContext<UnsavedChanges>({
  dirty: false,
  setDirty: () => undefined,
});

export const LEAVE_QUESTION = "Masz niezapisane zmiany. Wyjść bez zapisu?";
export const LEAVE_STAY_LABEL = "Zostań";
export const LEAVE_EXIT_LABEL = "Wyjdź bez zapisu";

/** The internal address a click on `link` would open, or `null` when the guard stays out of it. */
export function leavingHref(
  link: Pick<HTMLAnchorElement, "href" | "target" | "download">,
  event: Pick<MouseEvent, "button" | "metaKey" | "ctrlKey" | "shiftKey" | "altKey">,
  current: Pick<Location, "origin" | "pathname" | "search">,
): string | null {
  if (
    event.button !== 0 ||
    event.metaKey ||
    event.ctrlKey ||
    event.shiftKey ||
    event.altKey ||
    (link.target !== "" && link.target !== "_self") ||
    link.download !== ""
  ) {
    return null;
  }

  let url: URL;

  try {
    url = new URL(link.href);
  } catch {
    return null;
  }

  if (url.origin !== current.origin) {
    return null;
  }

  // The same page (a fragment, a link of the map): nothing is left behind.
  if (url.pathname === current.pathname && url.search === current.search) {
    return null;
  }

  return `${url.pathname}${url.search}${url.hash}`;
}

export function UnsavedChangesProvider({ children }: Readonly<{ children: ReactNode }>) {
  const [dirty, setDirtyState] = useState(false);
  // The ref is current at once, so a navigation that follows a save in the same tick is not
  // stopped by the state that has not rendered yet.
  const dirtyRef = useRef(false);
  const setDirty = useCallback((next: boolean) => {
    dirtyRef.current = next;
    setDirtyState(next);
  }, []);
  const value = useMemo(() => ({ dirty, setDirty }), [dirty, setDirty]);

  return (
    <UnsavedChangesContext value={value}>
      {children}
      <LeaveGuard dirtyRef={dirtyRef} setDirty={setDirty} />
    </UnsavedChangesContext>
  );
}

export const useUnsavedChanges = () => useContext(UnsavedChangesContext);

// Stops a click on a link that leaves the page while text is unsaved and asks in a native
// dialog; "Wyjdź bez zapisu" goes on to the link. Closing the tab or reloading is asked by the
// browser itself (`beforeunload`; it shows its own text). The Back button of the browser is not
// caught: the router offers no hook for it.
function LeaveGuard({
  dirtyRef,
  setDirty,
}: Readonly<{ dirtyRef: { current: boolean }; setDirty: (dirty: boolean) => void }>) {
  const router = useRouter();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const target = useRef<string | null>(null);

  useEffect(() => {
    function onClick(event: MouseEvent) {
      if (!dirtyRef.current || event.defaultPrevented) {
        return;
      }

      const link = event.target instanceof Element ? event.target.closest("a[href]") : null;

      if (link === null) {
        return;
      }

      const href = leavingHref(link as HTMLAnchorElement, event, window.location);

      if (href === null) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      target.current = href;
      dialogRef.current?.showModal();
    }

    function onBeforeUnload(event: BeforeUnloadEvent) {
      if (dirtyRef.current) {
        event.preventDefault();
        event.returnValue = "";
      }
    }

    // Capture phase on the document: runs before the link of the router handles the click.
    document.addEventListener("click", onClick, true);
    window.addEventListener("beforeunload", onBeforeUnload);

    return () => {
      document.removeEventListener("click", onClick, true);
      window.removeEventListener("beforeunload", onBeforeUnload);
    };
  }, [dirtyRef]);

  return (
    <dialog ref={dialogRef} className={styles.dialog} aria-labelledby="leave-heading">
      <h2 id="leave-heading">{LEAVE_QUESTION}</h2>
      <p>Wpisane zmiany znikną. Zostań, jeśli chcesz je najpierw zapisać.</p>
      <div className={styles.actions}>
        <button
          type="button"
          className="button button--primary"
          autoFocus
          onClick={() => dialogRef.current?.close()}
        >
          {LEAVE_STAY_LABEL}
        </button>
        <button
          type="button"
          className="button button--outline"
          onClick={() => {
            const href = target.current;

            dialogRef.current?.close();
            setDirty(false);

            if (href !== null) {
              router.push(href);
            }
          }}
        >
          {LEAVE_EXIT_LABEL}
        </button>
      </div>
    </dialog>
  );
}

export const UNSAVED_FIRST_MESSAGE = "Najpierw zapisz zmiany kolekcji.";

export const GO_TO_SAVE_LABEL = "Przejdź do zapisu";
export const UNSAVED_BADGE = "Masz niezapisane zmiany";

/** Id of the "Zapisz zmiany" button of the collection data form. */
export const SAVE_BUTTON_ID = "collection-save";

/** Moves the focus to the save button of the form (the browser scrolls it into view). */
export function focusSaveButton() {
  document.getElementById(SAVE_BUTTON_ID)?.focus();
}

const UNSAVED_RELOAD_QUESTION =
  "Niezapisany tekst zniknie po wczytaniu aktualnej wersji. Wczytać mimo to?";

const lines = (text: string) => text.replace(/\r\n?/g, "\n");

type Fields = Readonly<{ title: string; summary: string; region: string }>;

/**
 * True when the fields differ from the saved values. Line breaks are compared as
 * `\n` and the text without spaces at the ends, as the server trims it.
 */
export function differsFromSaved(fields: Fields, saved: Fields): boolean {
  return (
    fields.title.trim() !== saved.title.trim() ||
    lines(fields.summary).trim() !== lines(saved.summary).trim() ||
    fields.region !== saved.region
  );
}

/** Asks before unsaved text is thrown away; no question when there is none. */
export function confirmDiscard(dirty: boolean): boolean {
  return !dirty || window.confirm(UNSAVED_RELOAD_QUESTION);
}
