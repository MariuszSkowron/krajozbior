"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";

import { ACCESS_RESTRICTION_LABELS } from "@/features/catalog/domain/place-access-notice";
import {
  ACCESS_RESTRICTIONS,
  type AccessRestriction,
  PLACE_ACCESS_MAX_LENGTH,
  PLACE_ADDRESS_MAX_LENGTH,
  PLACE_DESCRIPTION_MAX_LENGTH,
  PLACE_NAME_MAX_LENGTH,
  VISIT_RADIUS_DEFAULT_M,
  VISIT_RADIUS_MAX_M,
  VISIT_RADIUS_MIN_M,
} from "@/features/catalog/domain/place";

import { searchAddress } from "./address-search";
import { callApi } from "./curator-api";
import { failed, Field, FeedbackRegion, type Feedback } from "./curator-ui";
import styles from "./curator.module.css";
import { fieldHints, parseNumberField } from "./failure-message";
import {
  describePin,
  formatCoordinate,
  readPosition,
  typedPinNote,
  readRadius,
  type PinPosition,
} from "./place-coordinates";
import { PlaceMapLoader } from "./place-map-loader";
import { useUnsavedChanges } from "./unsaved-changes";
import { GEOCODE_QUERY_MAX_LENGTH, type GeocodeResult } from "@/features/catalog/domain/geocode";

type SearchState =
  | Readonly<{ kind: "idle" }>
  | Readonly<{ kind: "busy" }>
  | Readonly<{ kind: "results"; results: readonly GeocodeResult[] }>
  | Readonly<{ kind: "empty" }>
  | Readonly<{ kind: "chosen"; label: string }>
  | Readonly<{ kind: "failed"; message: string }>;

const SEARCH_FIELD_ID = "place-address-search";
const COORDINATES_SUMMARY = "Współrzędne i promień potwierdzania wizyty";

type PlaceValues = Readonly<{
  name: string;
  description: string;
  address: string;
  accessInfo: string;
  accessRestriction: AccessRestriction;
  latitude: number;
  longitude: number;
  visitRadiusM: number;
}>;

type PlaceFormProps = Readonly<
  | { mode: "create"; collectionId: string; collectionPoints: readonly PinPosition[] }
  | { mode: "edit"; collectionId: string; place: PlaceValues & { id: string; version: number } }
>;

const FIELDS = {
  name: ["place-name", "Nazwa"],
  description: ["place-description", "Opis"],
  address: ["place-address", "Adres"],
  accessInfo: ["place-access", "Dostęp"],
  accessRestriction: ["place-access-restriction", "Wejście na teren"],
  latitude: ["place-latitude", "Szerokość geograficzna"],
  longitude: ["place-longitude", "Długość geograficzna"],
  visitRadiusM: ["place-radius", "Promień potwierdzania wizyty"],
} as const;

// Fields of a place; the position is set with a pin on the map (K-39) or typed in the folded
// "Współrzędne i promień potwierdzania wizyty"; an address search sets the pin too (K-2). Same shape as the collection form: the outer part keeps the
// message, the fields are keyed by the stored version.
export function PlaceForm(props: PlaceFormProps) {
  const router = useRouter();
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const key = props.mode === "edit" ? props.place.version : "new";

  return (
    <div>
      <FeedbackRegion
        feedback={feedback}
        fields={FIELDS}
        onReload={() => {
          setFeedback({ kind: "info", message: "Wczytano aktualną wersję miejsca." });
          router.refresh();
        }}
      />
      <PlaceFields key={key} {...props} feedback={feedback} onFeedback={setFeedback} />
    </div>
  );
}

function PlaceFields({
  feedback,
  onFeedback,
  ...props
}: PlaceFormProps & Readonly<{ feedback: Feedback | null; onFeedback: (f: Feedback) => void }>) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const refused = feedback?.kind === "error" ? feedback.fields : [];
  const hint = (name: keyof typeof FIELDS) =>
    refused.includes(name) ? fieldHints[name] : undefined;
  const stored = props.mode === "edit" ? props.place : null;
  const [latitudeText, setLatitudeText] = useState(
    stored === null ? "" : formatCoordinate(stored.latitude),
  );
  const [longitudeText, setLongitudeText] = useState(
    stored === null ? "" : formatCoordinate(stored.longitude),
  );
  const [radiusText, setRadiusText] = useState(
    String(stored?.visitRadiusM ?? VISIT_RADIUS_DEFAULT_M),
  );
  // The pin follows the fields only for a value in range (readPosition), set on leaving a field.
  const [position, setPosition] = useState<PinPosition | null>(
    stored === null ? null : { latitude: stored.latitude, longitude: stored.longitude },
  );
  const [mapShown, setMapShown] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [openedFor, setOpenedFor] = useState<Feedback | null>(null);
  const [tilesFailed, setTilesFailed] = useState(false);
  const [positionMissing, setPositionMissing] = useState(false);
  const [typedNote, setTypedNote] = useState<string | null>(null);
  const [searchText, setSearchText] = useState("");
  const [search, setSearch] = useState<SearchState>({ kind: "idle" });
  const [focusToken, setFocusToken] = useState(0);
  const { setDirty } = useUnsavedChanges();
  const showMapButton = useRef<HTMLButtonElement>(null);
  const missingNotice = useRef<HTMLParagraphElement>(null);
  const mapHolder = useRef<HTMLDivElement>(null);
  const focusShowButton = useRef(false);
  const coordinatesRefused = ["latitude", "longitude", "visitRadiusM"].some((name) =>
    refused.includes(name),
  );

  // A refused coordinate sits in the folded part: open it before the summary moves the focus.
  if (coordinatesRefused && openedFor !== feedback) {
    setOpenedFor(feedback);
    setSettingsOpen(true);
  }

  useEffect(() => {
    if (!mapShown && focusShowButton.current) {
      focusShowButton.current = false;
      showMapButton.current?.focus();
    }

    // The button is gone once the map is asked for: keep the focus on the loading text until the
    // map mounts and takes it (if the fragment never loads, the focus stays here, not on body).
    if (mapShown) {
      mapHolder.current?.focus();
    }
  }, [mapShown]);

  // The fields are remounted on a new version: nothing typed is left, so nothing is unsaved.
  useEffect(() => () => setDirty(false), [setDirty]);

  async function runSearch() {
    if (search.kind === "busy") {
      return;
    }

    setSearch({ kind: "busy" });

    const found = await searchAddress(searchText);

    if (!found.ok) {
      setSearch({ kind: "failed", message: found.message });
    } else if (found.results.length === 0) {
      setSearch({ kind: "empty" });
    } else {
      setSearch({ kind: "results", results: found.results });
    }
  }

  function choose(result: GeocodeResult) {
    pick({ latitude: result.latitude, longitude: result.longitude });
    setSearch({ kind: "chosen", label: result.label });
    setMapShown(true);
    setFocusToken((token) => token + 1);
  }

  function pick(next: PinPosition) {
    setDirty(true);
    setPosition(next);
    setLatitudeText(formatCoordinate(next.latitude));
    setLongitudeText(formatCoordinate(next.longitude));
    setPositionMissing(false);
    setTypedNote(null);
  }

  function commitTyped(latitude: string, longitude: string) {
    const typed = readPosition(latitude, longitude);

    setTypedNote(typedPinNote(latitude, longitude));

    if (typed !== null) {
      setPosition(typed);
    } else if (latitude.trim() === "" && longitude.trim() === "") {
      // Both fields cleared: the status line says "not set" instead of keeping the old pin.
      setPosition(null);
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (pending) {
      return;
    }

    const data = new FormData(event.currentTarget);
    const text = (name: string) => String(data.get(name) ?? "");

    // No pin and no typed coordinates: say it here (the server refuses it as well).
    if (text("latitude").trim() === "" || text("longitude").trim() === "") {
      setPositionMissing(true);
      // The place to fix it is shown, not folded away: the fields and the map (UX-04).
      setSettingsOpen(true);
      setMapShown(true);
      requestAnimationFrame(() => missingNotice.current?.focus());

      return;
    }

    setPositionMissing(false);
    const values = {
      name: text("name"),
      description: text("description"),
      address: text("address"),
      accessInfo: text("accessInfo"),
      accessRestriction: text("accessRestriction"),
      latitude: parseNumberField(text("latitude")),
      longitude: parseNumberField(text("longitude")),
      visitRadiusM: parseNumberField(text("visitRadiusM")),
    };

    setPending(true);

    if (props.mode === "create") {
      const result = await callApi<{ placeId?: string } | null>(
        "POST",
        `/api/curator/collections/${props.collectionId}/places`,
        "place",
        values,
      );

      if (result.ok) {
        const placeId = String(result.value?.placeId ?? "");

        setDirty(false);

        router.push(
          `/curator/collections/${props.collectionId}${
            placeId === "" ? "" : `?added=${encodeURIComponent(placeId)}`
          }`,
        );

        return;
      }

      onFeedback(failed(result.failure));
      setPending(false);

      return;
    }

    const result = await callApi("PATCH", `/api/curator/places/${props.place.id}`, "place", {
      version: props.place.version,
      ...values,
    });

    if (result.ok) {
      // The collection shows "Zapisano zmiany miejsca" at the row (K-40).
      setDirty(false);
      router.push(`/curator/collections/${props.collectionId}?saved=${props.place.id}`);
    } else {
      setPending(false);
      onFeedback(failed(result.failure));
    }
  }

  return (
    <form
      className={styles.form}
      onSubmit={submit}
      onChange={(event) => {
        // The search field has no name and is not part of the place.
        if ((event.target as HTMLElement).id !== SEARCH_FIELD_ID) {
          setDirty(true);
        }
      }}
      noValidate
    >
      <Field
        id={FIELDS.name[0]}
        label="Nazwa"
        help={`Do ${PLACE_NAME_MAX_LENGTH} znaków.`}
        invalidHint={hint("name")}
      >
        {(aria) => (
          <input
            {...aria}
            name="name"
            type="text"
            defaultValue={stored?.name ?? ""}
            required
            autoComplete="off"
          />
        )}
      </Field>
      <Field
        id={FIELDS.description[0]}
        label="Opis"
        help={`Do ${PLACE_DESCRIPTION_MAX_LENGTH} znaków.`}
        invalidHint={hint("description")}
      >
        {(aria) => (
          <textarea
            {...aria}
            name="description"
            rows={5}
            defaultValue={stored?.description ?? ""}
          />
        )}
      </Field>
      <div className={styles.row}>
        <Field
          id={FIELDS.address[0]}
          label="Adres"
          help={`Do ${PLACE_ADDRESS_MAX_LENGTH} znaków.`}
          invalidHint={hint("address")}
        >
          {(aria) => (
            <input
              {...aria}
              name="address"
              type="text"
              defaultValue={stored?.address ?? ""}
              autoComplete="off"
            />
          )}
        </Field>
        <Field
          id={FIELDS.accessInfo[0]}
          label="Dostęp"
          help={`Na przykład godziny zwiedzania; do ${PLACE_ACCESS_MAX_LENGTH} znaków.`}
          invalidHint={hint("accessInfo")}
        >
          {(aria) => (
            <input
              {...aria}
              name="accessInfo"
              type="text"
              defaultValue={stored?.accessInfo ?? ""}
              autoComplete="off"
            />
          )}
        </Field>
      </div>
      <Field
        id={FIELDS.accessRestriction[0]}
        label="Wejście na teren"
        help="Odkrywca zobaczy przy miejscu ostrzeżenie, żeby nie wchodzić na teren. Punkt potwierdzenia wizyty ustaw wtedy w przestrzeni publicznej, na przykład przy drodze."
        invalidHint={hint("accessRestriction")}
      >
        {(aria) => (
          <select
            {...aria}
            name="accessRestriction"
            defaultValue={stored?.accessRestriction ?? "none"}
          >
            {ACCESS_RESTRICTIONS.map((value) => (
              <option key={value} value={value}>
                {ACCESS_RESTRICTION_LABELS[value]}
              </option>
            ))}
          </select>
        )}
      </Field>
      <fieldset className={styles.fieldset}>
        <legend>Położenie miejsca</legend>
        <div className={styles.addressSearch}>
          <Field
            id={SEARCH_FIELD_ID}
            label="Znajdź miejsce po adresie"
            help="Wpisz adres i wybierz „Szukaj”. Pinezkę możesz potem przesunąć na mapie."
          >
            {(aria) => (
              <input
                {...aria}
                type="text"
                value={searchText}
                maxLength={GEOCODE_QUERY_MAX_LENGTH}
                onChange={(event) => setSearchText(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    void runSearch();
                  }
                }}
                autoComplete="off"
              />
            )}
          </Field>
          <button
            type="button"
            className={`button button--outline ${styles.pending}`}
            aria-disabled={search.kind === "busy"}
            onClick={() => void runSearch()}
          >
            {search.kind === "busy" ? "Szukam…" : "Szukaj"}
          </button>
        </div>
        <div role="status" className={styles.searchOutcome} data-testid="address-search-status">
          {search.kind === "empty"
            ? "Nic nie znaleziono. Sprawdź pisownię, dopisz miejscowość albo ustaw pinezkę na mapie."
            : null}
          {search.kind === "failed" ? search.message : null}
          {search.kind === "chosen"
            ? `Ustawiono pinezkę: ${search.label}. Sprawdź na mapie i w razie potrzeby przesuń ją.`
            : null}
          {search.kind === "results"
            ? `Znaleziono ${search.results.length}. Wybierz właściwe miejsce z listy.`
            : null}
        </div>
        {search.kind === "results" ? (
          <ul className={styles.searchResults} aria-label="Wyniki wyszukiwania adresu">
            {search.results.map((result) => (
              <li key={`${result.latitude},${result.longitude},${result.label}`}>
                <button
                  type="button"
                  className="button button--outline"
                  onClick={() => choose(result)}
                >
                  {result.label}
                </button>
              </li>
            ))}
          </ul>
        ) : null}
        <p className={styles.pinStatus} aria-live="polite" data-testid="pin-status">
          {describePin(position)}
        </p>
        <p className={styles.pinNote} aria-live="polite" data-testid="pin-note">
          {typedNote}
        </p>
        {positionMissing ? (
          <p ref={missingNotice} tabIndex={-1} className={styles.fieldError}>
            <span className={styles.errorPrefix}>Błąd: </span>
            Znajdź miejsce po adresie, ustaw pinezkę na mapie albo wpisz współrzędne poniżej.
          </p>
        ) : null}
        {mapShown ? (
          <div ref={mapHolder} tabIndex={-1}>
            <PlaceMapLoader
              position={position}
              radiusM={readRadius(radiusText)}
              bounds={props.mode === "create" ? props.collectionPoints : []}
              focusToken={focusToken}
              onPick={pick}
              onTilesFailed={() => {
                setTilesFailed(true);
                setSettingsOpen(true);
              }}
              onHide={() => {
                focusShowButton.current = true;
                setMapShown(false);
              }}
            />
          </div>
        ) : (
          <div className={styles.actions}>
            <button
              ref={showMapButton}
              type="button"
              className="button button--outline"
              onClick={() => {
                setTilesFailed(false);
                setMapShown(true);
              }}
            >
              Pokaż mapę
            </button>
          </div>
        )}
        {tilesFailed ? (
          <p role="status" className={styles.help}>
            Nie udało się wczytać mapy. Wpisz współrzędne w części „{COORDINATES_SUMMARY}”.
          </p>
        ) : null}
        <details
          className={styles.settings}
          open={settingsOpen}
          onToggle={(event) => setSettingsOpen(event.currentTarget.open)}
        >
          <summary>{COORDINATES_SUMMARY}</summary>
          <div className={styles.row3}>
            <Field
              id={FIELDS.latitude[0]}
              label="Szerokość geograficzna"
              help="Od −90 do 90, na przykład 54,0928."
              invalidHint={hint("latitude")}
            >
              {(aria) => (
                <input
                  {...aria}
                  name="latitude"
                  type="text"
                  inputMode="decimal"
                  value={latitudeText}
                  onChange={(event) => setLatitudeText(event.target.value)}
                  onBlur={() => commitTyped(latitudeText, longitudeText)}
                  required
                  autoComplete="off"
                />
              )}
            </Field>
            <Field
              id={FIELDS.longitude[0]}
              label="Długość geograficzna"
              help="Od −180 do 180, na przykład 18,7919."
              invalidHint={hint("longitude")}
            >
              {(aria) => (
                <input
                  {...aria}
                  name="longitude"
                  type="text"
                  inputMode="decimal"
                  value={longitudeText}
                  onChange={(event) => setLongitudeText(event.target.value)}
                  onBlur={() => commitTyped(latitudeText, longitudeText)}
                  required
                  autoComplete="off"
                />
              )}
            </Field>
            <Field
              id={FIELDS.visitRadiusM[0]}
              label="Promień potwierdzania wizyty (m)"
              help={`Od ${VISIT_RADIUS_MIN_M} do ${VISIT_RADIUS_MAX_M} m. W tym promieniu odkrywca potwierdzi wizytę.`}
              invalidHint={hint("visitRadiusM")}
            >
              {(aria) => (
                <input
                  {...aria}
                  name="visitRadiusM"
                  type="text"
                  inputMode="numeric"
                  value={radiusText}
                  onChange={(event) => setRadiusText(event.target.value)}
                  required
                  autoComplete="off"
                />
              )}
            </Field>
          </div>
        </details>
      </fieldset>
      <div className={styles.actions}>
        <button
          type="submit"
          className={`button button--primary ${styles.pending}`}
          aria-disabled={pending}
          onClick={(event) => {
            if (pending) {
              event.preventDefault();
            }
          }}
        >
          {props.mode === "create"
            ? pending
              ? "Dodawanie…"
              : "Dodaj miejsce do kolekcji"
            : pending
              ? "Zapisywanie…"
              : "Zapisz zmiany"}
        </button>
      </div>
    </form>
  );
}
