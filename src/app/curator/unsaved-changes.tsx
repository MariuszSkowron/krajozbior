"use client";

import { createContext, useContext, useMemo, useState, type ReactNode } from "react";

// The editor of a collection keeps its text in the form fields, while publishing
// sends only the version number and then reloads the page (the version changes,
// so the fields start over). The form tells the rest of the editor whether its
// fields differ from what is saved, so nothing typed is lost silently.

type UnsavedChanges = Readonly<{ dirty: boolean; setDirty: (dirty: boolean) => void }>;

const UnsavedChangesContext = createContext<UnsavedChanges>({
  dirty: false,
  setDirty: () => undefined,
});

export function UnsavedChangesProvider({ children }: Readonly<{ children: ReactNode }>) {
  const [dirty, setDirty] = useState(false);
  const value = useMemo(() => ({ dirty, setDirty }), [dirty]);

  return <UnsavedChangesContext value={value}>{children}</UnsavedChangesContext>;
}

export const useUnsavedChanges = () => useContext(UnsavedChangesContext);

export const UNSAVED_FIRST_MESSAGE = "Najpierw zapisz zmiany w danych kolekcji.";

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
