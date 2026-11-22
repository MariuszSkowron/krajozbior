"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition, type FormEvent } from "react";

import { callApi } from "./curator-api";
import { failed, Field, FeedbackRegion, type Feedback } from "./curator-ui";
import styles from "./curator.module.css";
import type { PlaceNotice } from "./place-notice";

type ListedPlace = Readonly<{ id: string; name: string; address: string }>;

type PlaceListProps = Readonly<{
  collectionId: string;
  places: readonly ListedPlace[];
  /** Places of the organization that are not in this collection yet. */
  otherPlaces: readonly ListedPlace[];
  /** "Zapisano zmiany miejsca" / "Dodano miejsce" after returning from the place editor. */
  notice: PlaceNotice | null;
}>;

// The places of a collection in order. A list with buttons "Wyżej" / "Niżej"
// instead of dragging: it works from the keyboard and needs no precise gesture
// (docs/design/accessibility.md). Every change is a request; the order shown is
// always the one the server returned after the reload.
export function PlaceList({ collectionId, places, otherPlaces, notice }: PlaceListProps) {
  const router = useRouter();
  // Kept in state: the parameter leaves the address right away, the message stays until a
  // next action on the list.
  const [rowNotice, setRowNotice] = useState(notice);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [busy, setBusy] = useState(false);
  const [refreshing, startTransition] = useTransition();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const focusAfterReload = useRef<string | null>(null);
  const order = places.map((place) => place.id).join(",");
  const disabled = busy || refreshing;

  // After the reload the moved row may have been re-created: put the focus back.
  useEffect(() => {
    const target = focusAfterReload.current;

    if (target !== null) {
      focusAfterReload.current = null;
      document.getElementById(target)?.focus();
    }
  }, [order]);

  // After returning from the editor: the row with the message takes the focus (read once, with
  // its content) and scrolls into view; the parameter is removed so a refresh does not repeat it.
  useEffect(() => {
    if (notice === null) {
      return;
    }

    const row = document.getElementById(`place-${notice.placeId}`);

    row?.focus();
    row?.scrollIntoView({ block: "center" });

    const url = new URL(window.location.href);

    if (url.searchParams.has("saved") || url.searchParams.has("added")) {
      url.searchParams.delete("saved");
      url.searchParams.delete("added");
      window.history.replaceState(window.history.state, "", url);
    }
  }, [notice]);

  function reload() {
    setRowNotice(null);
    startTransition(() => router.refresh());
  }

  async function move(index: number, direction: -1 | 1) {
    if (disabled) {
      return;
    }

    const next = places.map((place) => place.id);
    const target = index + direction;
    const moved = places[index];

    [next[index], next[target]] = [next[target] as string, next[index] as string];
    // Focus stays on the button just used, unless the row reached the end it
    // was moving to; then the opposite button is the one that still works.
    const sameDirectionWorks = direction === -1 ? target > 0 : target < places.length - 1;
    const button = sameDirectionWorks === (direction === -1) ? "up" : "down";

    focusAfterReload.current = `${button}-${moved?.id}`;
    setBusy(true);

    const result = await callApi(
      "PUT",
      `/api/curator/collections/${collectionId}/places/order`,
      "collection",
      { placeIds: next },
    );

    setBusy(false);

    if (result.ok) {
      setFeedback({
        kind: "success",
        message: `Przesunięto „${moved?.name}” na pozycję ${target + 1}.`,
      });
      reload();
    } else {
      focusAfterReload.current = null;
      setFeedback(failed(result.failure));
    }
  }

  async function remove(place: ListedPlace) {
    if (disabled) {
      return;
    }

    setBusy(true);

    const result = await callApi(
      "DELETE",
      `/api/curator/collections/${collectionId}/places/${place.id}`,
      "collection",
    );

    setBusy(false);

    if (result.ok) {
      setFeedback({
        kind: "success",
        message: `Usunięto „${place.name}” z kolekcji. Samo miejsce zostaje w organizacji.`,
      });
      headingRef.current?.focus();
      reload();
    } else {
      setFeedback(failed(result.failure));
    }
  }

  async function addExisting(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (disabled) {
      return;
    }

    const placeId = String(new FormData(event.currentTarget).get("placeId") ?? "");
    const added = otherPlaces.find((place) => place.id === placeId);

    setBusy(true);

    const result = await callApi(
      "POST",
      `/api/curator/collections/${collectionId}/places`,
      "collection",
      { placeId },
    );

    setBusy(false);

    if (result.ok) {
      setFeedback({
        kind: "success",
        message: `Dodano „${added?.name ?? "miejsce"}” na koniec listy.`,
      });
      reload();
    } else {
      setFeedback(failed(result.failure));
    }
  }

  return (
    <section aria-labelledby="places-heading" className={styles.section}>
      <div className={styles.sectionHead}>
        <h2 id="places-heading" ref={headingRef} tabIndex={-1}>
          Miejsca w kolekcji <span className={styles.count}>({places.length})</span>
        </h2>
        <Link
          className="button button--primary"
          href={`/curator/collections/${collectionId}/places/new`}
        >
          Dodaj nowe miejsce
        </Link>
      </div>
      <FeedbackRegion
        feedback={feedback}
        onReload={() => {
          setFeedback({ kind: "info", message: "Wczytano aktualną listę miejsc." });
          reload();
        }}
      />
      {places.length === 0 ? (
        <p className={styles.empty}>
          Ta kolekcja nie ma jeszcze miejsc. Dodaj pierwsze, żeby móc ją opublikować.
        </p>
      ) : (
        <>
          <ol className={styles.placeList} aria-label="Miejsca w kolejności">
            {places.map((place, index) => (
              <li
                key={place.id}
                id={`place-${place.id}`}
                tabIndex={-1}
                className={styles.placeItem}
              >
                <span className={styles.position} aria-hidden="true">
                  {index + 1}
                </span>
                <div className={styles.placeName}>
                  <Link href={`/curator/collections/${collectionId}/places/${place.id}`}>
                    {place.name}
                  </Link>
                  <span className={styles.muted}>
                    {place.address === "" ? "Bez adresu" : place.address}
                  </span>
                  {rowNotice?.placeId === place.id ? (
                    <p className={styles.rowNotice} role="status">
                      <span aria-hidden="true">✓</span>
                      {rowNotice.message}
                    </p>
                  ) : null}
                </div>
                <div className={styles.rowActions}>
                  <button
                    id={`up-${place.id}`}
                    type="button"
                    className={`button button--outline ${styles.pending}`}
                    aria-disabled={disabled || index === 0}
                    aria-label={`Przesuń wyżej: ${place.name}`}
                    onClick={() => (index === 0 ? undefined : move(index, -1))}
                  >
                    Wyżej
                  </button>
                  <button
                    id={`down-${place.id}`}
                    type="button"
                    className={`button button--outline ${styles.pending}`}
                    aria-disabled={disabled || index === places.length - 1}
                    aria-label={`Przesuń niżej: ${place.name}`}
                    onClick={() => (index === places.length - 1 ? undefined : move(index, 1))}
                  >
                    Niżej
                  </button>
                  <button
                    type="button"
                    className={`button button--danger ${styles.pending}`}
                    aria-disabled={disabled}
                    aria-label={`Usuń z kolekcji: ${place.name}`}
                    onClick={() => remove(place)}
                  >
                    Usuń z kolekcji
                  </button>
                </div>
              </li>
            ))}
          </ol>
        </>
      )}
      {otherPlaces.length > 0 ? (
        <form className={styles.inlineForm} onSubmit={addExisting}>
          <Field id="existing-place" label="Dodaj miejsce, które organizacja już ma">
            {(aria) => (
              <select {...aria} name="placeId" required>
                {otherPlaces.map((place) => (
                  <option key={place.id} value={place.id}>
                    {place.name}
                    {place.address === "" ? "" : `, ${place.address}`}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <button
            type="submit"
            className={`button button--outline ${styles.pending}`}
            aria-disabled={disabled}
          >
            Dodaj do kolekcji
          </button>
        </form>
      ) : null}
    </section>
  );
}
