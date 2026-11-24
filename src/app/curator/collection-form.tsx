"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";

import {
  COLLECTION_SUMMARY_MAX_LENGTH,
  COLLECTION_TITLE_MAX_LENGTH,
  REGIONS,
  REGION_LABELS,
  type Region,
} from "@/features/catalog/domain/collection";

import { useCollectionVersion } from "./collection-version";
import { callApi } from "./curator-api";
import { failed, Field, FeedbackRegion, type Feedback } from "./curator-ui";
import styles from "./curator.module.css";
import { fieldHints } from "./failure-message";
import {
  confirmDiscard,
  differsFromSaved,
  SAVE_BUTTON_ID,
  UNSAVED_BADGE,
  useUnsavedChanges,
} from "./unsaved-changes";

type CollectionValues = Readonly<{ title: string; summary: string; region: Region }>;

type CollectionFormProps = Readonly<
  | { mode: "create"; organizationId: string }
  | {
      mode: "edit";
      collection: CollectionValues & { id: string; version: number };
    }
>;

const FIELDS = {
  title: ["collection-title", "Nazwa"],
  summary: ["collection-summary", "Opis"],
  region: ["collection-region", "Województwo"],
} as const;

// Name, short description and voivodeship of a collection. The outer part keeps
// the message of the last save; the fields are keyed by the version, so after
// a reload they show what is stored now (and a stale version is never resent).
export function CollectionForm(props: CollectionFormProps) {
  const router = useRouter();
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const { dirty } = useUnsavedChanges();
  const key = props.mode === "edit" ? props.collection.version : "new";

  return (
    <div>
      <FeedbackRegion
        feedback={feedback}
        fields={FIELDS}
        onReload={() => {
          if (!confirmDiscard(dirty)) {
            return;
          }

          setFeedback({ kind: "info", message: "Wczytano aktualną wersję kolekcji." });
          router.refresh();
        }}
      />
      <CollectionFields key={key} {...props} feedback={feedback} onFeedback={setFeedback} />
    </div>
  );
}

function CollectionFields({
  feedback,
  onFeedback,
  ...props
}: CollectionFormProps &
  Readonly<{ feedback: Feedback | null; onFeedback: (f: Feedback) => void }>) {
  const router = useRouter();
  const known = useCollectionVersion(props.mode === "edit" ? props.collection.version : 0);
  const initial: CollectionValues =
    props.mode === "edit" ? props.collection : { title: "", summary: "", region: "pomorskie" };
  const [summaryLength, setSummaryLength] = useState(initial.summary.length);
  const [pending, setPending] = useState(false);
  const { dirty, setDirty } = useUnsavedChanges();

  // The fields are remounted on a new version (after a save or a reload): then
  // nothing typed is left, so nothing is unsaved.
  useEffect(() => () => setDirty(false), [setDirty]);

  function track(form: HTMLFormElement) {
    const data = new FormData(form);

    setDirty(
      differsFromSaved(
        {
          title: String(data.get("title") ?? ""),
          summary: String(data.get("summary") ?? ""),
          region: String(data.get("region") ?? ""),
        },
        initial,
      ),
    );
  }

  const refused = feedback?.kind === "error" ? feedback.fields : [];
  const hint = (name: keyof typeof FIELDS) =>
    refused.includes(name) ? fieldHints[name] : undefined;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (pending) {
      return;
    }

    const data = new FormData(event.currentTarget);
    const values = {
      title: String(data.get("title") ?? ""),
      summary: String(data.get("summary") ?? ""),
      region: String(data.get("region") ?? ""),
    };

    setPending(true);

    if (props.mode === "create") {
      const result = await callApi<{ id: string }>(
        "POST",
        "/api/curator/collections",
        "collection",
        { organizationId: props.organizationId, ...values },
      );

      if (result.ok) {
        router.push(`/curator/collections/${result.value.id}`);

        return;
      }

      onFeedback(failed(result.failure));
      setPending(false);

      return;
    }

    const result = await callApi(
      "PATCH",
      `/api/curator/collections/${props.collection.id}`,
      "collection",
      { version: known.current, ...values },
    );

    setPending(false);

    if (result.ok) {
      known.report(result.value);
      onFeedback({ kind: "success", message: "Zapisano zmiany." });
      router.refresh();
    } else {
      onFeedback(failed(result.failure));
    }
  }

  return (
    <form
      className={styles.form}
      onSubmit={submit}
      onChange={(event) => track(event.currentTarget)}
      noValidate
    >
      <Field
        id={FIELDS.title[0]}
        label="Nazwa"
        help={`Do ${COLLECTION_TITLE_MAX_LENGTH} znaków.`}
        invalidHint={hint("title")}
      >
        {(aria) => (
          <input
            {...aria}
            name="title"
            type="text"
            maxLength={COLLECTION_TITLE_MAX_LENGTH}
            defaultValue={initial.title}
            required
            autoComplete="off"
          />
        )}
      </Field>
      <Field
        id={FIELDS.summary[0]}
        label="Krótki opis"
        help={`${summaryLength} / ${COLLECTION_SUMMARY_MAX_LENGTH} znaków. Nie wpisuj liczby miejsc: strona pokaże ją sama.`}
        invalidHint={hint("summary")}
      >
        {(aria) => (
          <textarea
            {...aria}
            name="summary"
            rows={4}
            defaultValue={initial.summary}
            onChange={(event) =>
              setSummaryLength(event.currentTarget.value.replace(/\r\n?/g, "\n").length)
            }
          />
        )}
      </Field>
      <Field id={FIELDS.region[0]} label="Województwo" invalidHint={hint("region")}>
        {(aria) => (
          <select {...aria} name="region" defaultValue={initial.region} required>
            {REGIONS.map((region) => (
              <option key={region} value={region}>
                {REGION_LABELS[region]}
              </option>
            ))}
          </select>
        )}
      </Field>
      <div className={styles.actions}>
        <button
          id={props.mode === "edit" ? SAVE_BUTTON_ID : undefined}
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
              ? "Tworzenie…"
              : "Utwórz szkic kolekcji"
            : pending
              ? "Zapisywanie…"
              : "Zapisz zmiany"}
        </button>
        {props.mode === "edit" && dirty ? (
          <p role="status" className={styles.notice}>
            {UNSAVED_BADGE}
          </p>
        ) : null}
      </div>
    </form>
  );
}
