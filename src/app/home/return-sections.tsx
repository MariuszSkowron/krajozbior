import Link from "next/link";

import { CollectionCard } from "@/design-system/components/collection-card";
import type { HomeReturn } from "@/features/album/application/album-types";
import {
  HOME_REMAINING_COLLECTIONS,
  remainingLabel,
  saveNudgeText,
} from "@/features/album/domain/home-return";
import type { NewCollection, PlaceOfTheDay } from "@/features/catalog/application/catalog-types";
import { REGION_LABELS } from "@/features/catalog/domain/collection";
import { cardCoverImage } from "@/features/catalog/domain/collection-cover";
import { formatPlaceCount } from "@/features/catalog/domain/place-count";
import { firstSentence } from "@/features/catalog/domain/place-of-day";
import type { PublicNewsCard } from "@/features/news/application/news-read-types";
import { formatSavedDate } from "@/features/want-to-see/domain/saved-date";

import catalog from "../catalog.module.css";
import { NewsEventDays, NewsKicker, NewsPublished } from "../news/news-parts";
import styles from "./home-sections.module.css";
import { SaveNudgeButton } from "./save-nudge-button";

// Powody do powrotu na Starcie (D-58 pkt 4, D3): sekcje z istniejących danych. Każda czyta tylko
// dane publiczne albo własne dane odkrywcy; nieudany odczyt wyłącza jedną sekcję (`null`), a nie
// stronę. Teksty: raport audytu, sekcja 6 (zaakceptowane) i [P] oznaczone w raporcie zadania.

/** „Do odkrycia w Twoich kolekcjach”: co zostało w zapisanych kolekcjach (odkrywca z zapisem). */
// `exceptSlug` to kolekcja z banera na górze Startu: ma tam własną, dużą kartę z postępem, więc
// nie powtarza się na tej liście. Gdy po jej pominięciu nic nie zostaje, a wcześniej coś było,
// sekcji nie ma (komunikat „wszystkie ukończone” byłby nieprawdziwy).
export function RemainingInCollections({
  value,
  exceptSlug = null,
}: Readonly<{ value: HomeReturn; exceptSlug?: string | null }>) {
  if (!value.hasSaved) {
    return null;
  }

  // Odczyt ma o jedną kolekcję więcej niż pokazujemy (`HOME_REMAINING_READ`): po pominięciu
  // kolekcji z banera zostaje do trzech innych.
  const remaining = value.remaining
    .filter((row) => row.slug !== exceptSlug)
    .slice(0, HOME_REMAINING_COLLECTIONS);

  if (remaining.length === 0 && value.remaining.length > 0) {
    return null;
  }

  return (
    <section className={styles.section} aria-labelledby="zostalo-title">
      <h2 id="zostalo-title">Do odkrycia w Twoich kolekcjach</h2>
      {remaining.length === 0 ? (
        <div className={styles.empty}>
          <p>Wszystkie zapisane kolekcje masz ukończone. Wybierz następną.</p>
          <Link className="button button--outline" href="#do-odkrycia">
            Zobacz kolekcje
          </Link>
        </div>
      ) : (
        <ul className={styles.visits}>
          {remaining.map((row) => (
            <li key={row.slug} className={styles.visit}>
              <Link
                className={`${catalog.itemTitle} ${styles.visitName}`}
                href={`/collections/${row.slug}`}
              >
                {row.title}
              </Link>
              <span className={styles.visitMeta}>
                {[
                  remainingLabel(row.remaining),
                  ...(row.names.length > 0 ? [row.names.join(", ")] : []),
                ].join(" · ")}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** „Masz już miejsca z tej kolekcji”: zachęta do zapisu zaczętej, niezapisanej kolekcji. */
export function SaveStartedCollection({ value }: Readonly<{ value: HomeReturn }>) {
  const collection = value.saveNudge;

  if (collection === null) {
    return null;
  }

  return (
    <section className={styles.section} aria-labelledby="zapisz-title">
      <h2 id="zapisz-title">Masz już miejsca z tej kolekcji</h2>
      <div className={styles.empty}>
        <p>{saveNudgeText(collection)}</p>
        <div className={styles.nudgeActions}>
          <SaveNudgeButton collectionId={collection.id} />
          <Link className="button button--outline" href={`/collections/${collection.slug}`}>
            Zobacz kolekcję
          </Link>
        </div>
      </div>
    </section>
  );
}

/** „Miejsce dnia”: jedno miejsce na dobę dla wszystkich. Bez kandydata sekcji nie ma. */
export function PlaceOfTheDaySection({ place }: Readonly<{ place: PlaceOfTheDay | null }>) {
  if (place === null) {
    return null;
  }

  const image = cardCoverImage(place.photo);

  return (
    <section className={styles.section} aria-labelledby="miejsce-dnia-title">
      <h2 id="miejsce-dnia-title">Miejsce dnia</h2>
      <article className={styles.day}>
        {image === null ? null : (
          // eslint-disable-next-line @next/next/no-img-element -- plik z własnej trasy, bez optymalizatora
          <img
            className={styles.dayImage}
            src={image.src}
            srcSet={image.srcSet}
            sizes={image.sizes}
            width={image.width}
            height={image.height}
            alt={image.alt}
            loading="lazy"
            decoding="async"
          />
        )}
        <div className={styles.dayBody}>
          <h3 className={styles.dayTitle}>{place.name}</h3>
          <p>{firstSentence(place.description)}</p>
          <p className={styles.visitMeta}>
            z kolekcji{" "}
            <Link href={`/collections/${place.collection.slug}`}>{place.collection.title}</Link>
          </p>
          <Link className="button button--outline" href={`/places/${place.id}`}>
            Zobacz miejsce
          </Link>
        </div>
      </article>
    </section>
  );
}

/** „Nowe kolekcje”: do trzech kart z ostatnich 30 dni; bez nich sekcja znika. */
export function NewCollectionsSection({
  collections,
}: Readonly<{ collections: readonly NewCollection[] | null }>) {
  if (collections === null || collections.length === 0) {
    return null;
  }

  return (
    <section className={styles.section} aria-labelledby="nowe-title">
      <h2 id="nowe-title">Nowe kolekcje</h2>
      <ul className={styles.cards}>
        {collections.map((collection) => (
          <li key={collection.id}>
            <CollectionCard
              href={`/collections/${collection.slug}`}
              title={collection.title}
              regionLabel={REGION_LABELS[collection.region]}
              cover={cardCoverImage(collection.cover)}
              note={`dodana ${formatSavedDate(collection.firstPublishedAt)} · ${formatPlaceCount(collection.placeCount)} · ${collection.organization.name}`}
            />
          </li>
        ))}
      </ul>
    </section>
  );
}

/** „Aktualności i wydarzenia”: do trzech najnowszych wpisów; bez wpisów sekcja znika. */
export function NewsHighlights({ cards }: Readonly<{ cards: readonly PublicNewsCard[] | null }>) {
  if (cards === null || cards.length === 0) {
    return null;
  }

  return (
    <section className={styles.section} aria-labelledby="aktualnosci-title">
      <div className={styles.sectionHead}>
        <h2 id="aktualnosci-title">Aktualności i wydarzenia</h2>
        <Link className={styles.sectionLink} href="/news">
          Wszystkie aktualności
        </Link>
      </div>
      <ul className={styles.visits}>
        {cards.map((card) => (
          <li key={card.slug} className={styles.visit}>
            <NewsKicker card={card} />
            <Link
              className={`${catalog.itemTitle} ${styles.visitName}`}
              href={`/news/${card.slug}`}
            >
              {card.title}
            </Link>
            {card.eventStartsOn === null ? (
              <NewsPublished card={card} />
            ) : (
              <NewsEventDays card={card} />
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
