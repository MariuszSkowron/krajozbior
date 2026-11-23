"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import curatorStyles from "@/app/curator/curator.module.css";
import { failed, Field, FeedbackRegion, type Feedback } from "@/app/curator/curator-ui";
import {
  COLLECTION_SUMMARY_MAX_LENGTH,
  COLLECTION_TITLE_MAX_LENGTH,
} from "@/features/catalog/domain/collection";
import {
  OWN_REGIONS,
  OWN_REGION_LABELS,
  type OwnRegion,
} from "@/features/own-collections/domain/own-collection";

import { callOwnApi } from "./own-api";

type Values = Readonly<{ title: string; summary: string; region: OwnRegion }>;

type Props = Readonly<
  { mode: "create" } | { mode: "edit"; collection: Values & { id: string; version: number } }
>;

const FIELDS = {
  title: ["own-collection-title", "Nazwa"],
  summary: ["own-collection-summary", "Opis"],
  region: ["own-collection-region", "Region"],
} as const;

const HINTS: Readonly<Record<string, string>> = {
  title: `Wpisz nazwę kolekcji (do ${COLLECTION_TITLE_MAX_LENGTH} znaków).`,
  summary: `Opis może mieć najwyżej ${COLLECTION_SUMMARY_MAX_LENGTH} znaków.`,
  region: "Wybierz region.",
};

// Name, short description and region of an own collection. The outer part keeps the message of
// the last save; the fields are keyed by the version, so after a reload they show what is stored
// now (a stale version is never resent).
export function OwnCollectionForm(props: Props) {
  const router = useRouter();
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const key = props.mode === "edit" ? props.collection.version : "new";

  return (
    <div>
      <FeedbackRegion
        feedback={feedback}
        fields={FIELDS}
        onReload={() => {
          setFeedback({ kind: "info", message: "Wczytano aktualną wersję kolekcji." });
          router.refresh();
        }}
      />
      <Fields key={key} {...props} feedback={feedback} onFeedback={setFeedback} />
    </div>
  );
}

function Fields({
  feedback,
  onFeedback,
  ...props
}: Props & Readonly<{ feedback: Feedback | null; onFeedback: (f: Feedback) => void }>) {
  const router = useRouter();
  const initial: Omit<Values, "region"> =
    props.mode === "edit" ? props.collection : { title: "", summary: "" };
  // A new collection starts without a region: no region is assumed for a person from elsewhere.
  const initialRegion = props.mode === "edit" ? props.collection.region : "";
  const [summaryLength, setSummaryLength] = useState(initial.summary.length);
  const [pending, setPending] = useState(false);
  const refused = feedback?.kind === "error" ? feedback.fields : [];
  const hint = (name: keyof typeof FIELDS) => (refused.includes(name) ? HINTS[name] : undefined);

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
      const result = await callOwnApi<{ id: string }>("POST", "/api/me/own-collections", values);

      if (result.ok) {
        router.push(`/my/collections/own/${result.value.id}`);

        return;
      }

      onFeedback(failed(result.failure));
      setPending(false);

      return;
    }

    const result = await callOwnApi("PUT", `/api/me/own-collections/${props.collection.id}`, {
      version: props.collection.version,
      ...values,
    });

    setPending(false);

    if (result.ok) {
      onFeedback({ kind: "success", message: "Zapisano zmiany." });
      router.refresh();
    } else {
      onFeedback(failed(result.failure));
    }
  }

  return (
    <form className={curatorStyles.form} onSubmit={submit} noValidate>
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
        help={`${summaryLength} / ${COLLECTION_SUMMARY_MAX_LENGTH} znaków`}
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
      <Field id={FIELDS.region[0]} label="Region" invalidHint={hint("region")}>
        {(aria) => (
          <select {...aria} name="region" defaultValue={initialRegion} required>
            {initialRegion === "" ? (
              <option value="" disabled>
                Wybierz region
              </option>
            ) : null}
            {OWN_REGIONS.map((region) => (
              <option key={region} value={region}>
                {OWN_REGION_LABELS[region]}
              </option>
            ))}
          </select>
        )}
      </Field>
      <div className={curatorStyles.actions}>
        <button
          type="submit"
          className={`button button--primary ${curatorStyles.pending}`}
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
              : "Utwórz kolekcję"
            : pending
              ? "Zapisywanie…"
              : "Zapisz zmiany"}
        </button>
      </div>
    </form>
  );
}
