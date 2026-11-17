"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import {
  PLACE_ACCESS_MAX_LENGTH,
  PLACE_ADDRESS_MAX_LENGTH,
  PLACE_DESCRIPTION_MAX_LENGTH,
  PLACE_NAME_MAX_LENGTH,
  VISIT_RADIUS_DEFAULT_M,
  VISIT_RADIUS_MAX_M,
  VISIT_RADIUS_MIN_M,
} from "@/features/catalog/domain/place";

import { callApi } from "./curator-api";
import { failed, Field, FeedbackRegion, type Feedback } from "./curator-ui";
import styles from "./curator.module.css";
import { fieldHints, parseNumberField } from "./failure-message";

type PlaceValues = Readonly<{
  name: string;
  description: string;
  address: string;
  accessInfo: string;
  latitude: number;
  longitude: number;
  visitRadiusM: number;
}>;

type PlaceFormProps = Readonly<
  | { mode: "create"; collectionId: string }
  | { mode: "edit"; collectionId: string; place: PlaceValues & { id: string; version: number } }
>;

const FIELDS = {
  name: ["place-name", "Nazwa"],
  description: ["place-description", "Opis"],
  address: ["place-address", "Adres"],
  accessInfo: ["place-access", "Dostęp"],
  latitude: ["place-latitude", "Szerokość geograficzna"],
  longitude: ["place-longitude", "Długość geograficzna"],
  visitRadiusM: ["place-radius", "Promień potwierdzania wizyty"],
} as const;

// Fields of a place; coordinates are typed in by hand (no map yet). Same shape
// as the collection form: the outer part keeps the message, the fields are
// keyed by the stored version.
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

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (pending) {
      return;
    }

    const data = new FormData(event.currentTarget);
    const text = (name: string) => String(data.get(name) ?? "");
    const values = {
      name: text("name"),
      description: text("description"),
      address: text("address"),
      accessInfo: text("accessInfo"),
      latitude: parseNumberField(text("latitude")),
      longitude: parseNumberField(text("longitude")),
      visitRadiusM: parseNumberField(text("visitRadiusM")),
    };

    setPending(true);

    if (props.mode === "create") {
      const result = await callApi(
        "POST",
        `/api/curator/collections/${props.collectionId}/places`,
        "place",
        values,
      );

      if (result.ok) {
        router.push(`/curator/collections/${props.collectionId}`);

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

    setPending(false);

    if (result.ok) {
      onFeedback({ kind: "success", message: "Zapisano zmiany miejsca." });
      router.refresh();
    } else {
      onFeedback(failed(result.failure));
    }
  }

  return (
    <form className={styles.form} onSubmit={submit} noValidate>
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
      <fieldset className={styles.fieldset}>
        <legend>Lokalizacja i potwierdzanie wizyt</legend>
        <div className={styles.row3}>
          <Field
            id={FIELDS.latitude[0]}
            label="Szerokość geograficzna"
            help="Od −90 do 90, na przykład 54.0928."
            invalidHint={hint("latitude")}
          >
            {(aria) => (
              <input
                {...aria}
                name="latitude"
                type="text"
                inputMode="decimal"
                defaultValue={stored === null ? "" : String(stored.latitude)}
                required
                autoComplete="off"
              />
            )}
          </Field>
          <Field
            id={FIELDS.longitude[0]}
            label="Długość geograficzna"
            help="Od −180 do 180, na przykład 18.7919."
            invalidHint={hint("longitude")}
          >
            {(aria) => (
              <input
                {...aria}
                name="longitude"
                type="text"
                inputMode="decimal"
                defaultValue={stored === null ? "" : String(stored.longitude)}
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
                defaultValue={String(stored?.visitRadiusM ?? VISIT_RADIUS_DEFAULT_M)}
                required
                autoComplete="off"
              />
            )}
          </Field>
        </div>
      </fieldset>
      <div className={styles.actions}>
        <button
          type="submit"
          className={styles.primary}
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
