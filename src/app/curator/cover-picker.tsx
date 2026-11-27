"use client";

import { useRouter } from "next/navigation";
import { useId, useState, type FormEvent } from "react";

import { callApi } from "./curator-api";
import { failed, FeedbackRegion, type Feedback } from "./curator-ui";
import styles from "./curator.module.css";
import pickerStyles from "./cover-picker.module.css";

export type CoverChoice = Readonly<{
  photoId: string;
  placeName: string;
  altText: string;
  width: number;
  height: number;
}>;

type CoverPickerProps = Readonly<{
  collectionId: string;
  /** The photo chosen now, or `null` (no cover). */
  currentPhotoId: string | null;
  /** Ready photos of the places of this collection. */
  choices: readonly CoverChoice[];
  /** The photo the public page shows for "Automatycznie" (never a hidden one), or `null`. */
  autoPhotoId: string | null;
}>;

const NONE = "none";

// Choice of the cover of a collection (E4-3, docs#39 AC1): one radio per photo of the places in
// the collection and one for "no cover" (the card then keeps the placeholder, AC2). Native radios
// in a fieldset: they work from the keyboard (arrows) and a screen reader reads the legend, the
// description of the photo and the place. The rules (which photo is allowed) are the server's:
// this only sends the choice and tells the answer.
export function CoverPicker({
  collectionId,
  currentPhotoId,
  choices,
  autoPhotoId,
}: CoverPickerProps) {
  const router = useRouter();
  const auto = choices.find((choice) => choice.photoId === autoPhotoId) ?? null;
  const groupId = useId();
  const [selected, setSelected] = useState<string>(currentPhotoId ?? NONE);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (pending) {
      return;
    }

    setPending(true);

    const result = await callApi(
      "PUT",
      `/api/curator/collections/${collectionId}/cover`,
      "collection",
      selected === NONE ? {} : { placePhotoId: selected },
    );

    setPending(false);

    if (result.ok) {
      setFeedback({
        kind: "success",
        message:
          selected === NONE
            ? "Okładka jest teraz wybierana automatycznie: to zdjęcie pierwszego miejsca."
            : "Okładka zapisana. Zobaczą ją odkrywcy po opublikowaniu kolekcji.",
      });
      router.refresh();
    } else {
      setFeedback(failed(result.failure));
    }
  }

  return (
    <section aria-labelledby="cover-heading" className={styles.section}>
      <h2 id="cover-heading">Okładka kolekcji</h2>
      {choices.length === 0 ? (
        <p>
          Okładkę wybierzesz ze zdjęć miejsc w tej kolekcji. Żadne miejsce nie ma jeszcze zdjęcia,
          więc karta kolekcji ma na razie stałe tło.
        </p>
      ) : (
        <form onSubmit={submit} className={pickerStyles.form}>
          <fieldset className={pickerStyles.fieldset}>
            <legend>Zdjęcie na karcie i w nagłówku kolekcji</legend>
            <ul className={pickerStyles.options}>
              <li>
                <label className={pickerStyles.option}>
                  <input
                    type="radio"
                    name={`cover-${groupId}`}
                    value={NONE}
                    checked={selected === NONE}
                    onChange={() => setSelected(NONE)}
                  />
                  {auto === null ? null : (
                    // eslint-disable-next-line @next/next/no-img-element -- plik z własnej trasy, bez optymalizatora
                    <img
                      src={`/media/p/${auto.photoId}/w400`}
                      alt=""
                      width={Math.min(auto.width, 400)}
                      height={Math.round(auto.height * (Math.min(auto.width, 400) / auto.width))}
                      loading="lazy"
                      decoding="async"
                    />
                  )}
                  <span className={pickerStyles.none}>
                    {auto === null
                      ? "Automatycznie: zdjęcie pierwszego miejsca, które ma zdjęcie"
                      : `Automatycznie: zdjęcie pierwszego miejsca (${auto.placeName})`}
                  </span>
                </label>
              </li>
              {choices.map((choice) => (
                <li key={choice.photoId}>
                  <label className={pickerStyles.option}>
                    <input
                      type="radio"
                      name={`cover-${groupId}`}
                      value={choice.photoId}
                      checked={selected === choice.photoId}
                      onChange={() => setSelected(choice.photoId)}
                    />
                    {/* eslint-disable-next-line @next/next/no-img-element -- plik z własnej trasy, bez optymalizatora */}
                    <img
                      src={`/media/p/${choice.photoId}/w400`}
                      alt={choice.altText}
                      width={Math.min(choice.width, 400)}
                      height={Math.round(
                        choice.height * (Math.min(choice.width, 400) / choice.width),
                      )}
                      loading="lazy"
                      decoding="async"
                    />
                    <span>{choice.placeName}</span>
                  </label>
                </li>
              ))}
            </ul>
          </fieldset>
          <FeedbackRegion
            feedback={feedback}
            onReload={() => {
              setFeedback({ kind: "info", message: "Wczytano aktualny stan kolekcji." });
              router.refresh();
            }}
          />
          <div className={styles.actions}>
            <button
              type="submit"
              className={`button button--primary ${styles.pending}`}
              aria-disabled={pending}
            >
              Zapisz okładkę
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
