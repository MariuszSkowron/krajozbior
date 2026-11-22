import Link from "next/link";

import { StatusBadge } from "@/design-system/components/status-badge";
import { describeVisit, type HomeRecentVisit } from "@/features/album/domain/home-album";

import catalog from "../catalog.module.css";
import styles from "./home-sections.module.css";

// Ostatnio odwiedzone: pięć ostatnich wizyt. Wizyta miejsca, którego nie ma już w żadnej
// publicznej kolekcji, zostaje na liście bez nazwy, adresu i linku (spójnie z liczbą
// „odkrytych miejsc”). Odznaka niesie słowo, nie tylko kolor.
export function RecentVisits({ visits }: Readonly<{ visits: readonly HomeRecentVisit[] }>) {
  return (
    <section className={styles.section} aria-labelledby="wizyty-title">
      <h2 id="wizyty-title">Ostatnio odwiedzone</h2>
      {visits.length === 0 ? (
        <p>
          Nie masz jeszcze wizyt. Potwierdź pierwszą na miejscu albo zaznacz wizytę z przeszłości.
        </p>
      ) : (
        <ol className={styles.visits}>
          {visits.map((visit) => {
            const line = describeVisit(visit);

            return (
              <li key={line.id} className={styles.visit}>
                {line.place === null ? (
                  <span className={styles.visitName}>Miejsce nie jest już dostępne</span>
                ) : (
                  <Link
                    className={`${catalog.itemTitle} ${styles.visitName}`}
                    href={line.place.href}
                  >
                    {line.place.name}
                  </Link>
                )}
                {line.place === null || line.place.address === "" ? null : (
                  <span className={styles.visitMeta}>{line.place.address}</span>
                )}
                <span className={styles.visitFoot}>
                  <StatusBadge tone={visit.kind === "on_site" ? "success" : "info"}>
                    {line.kindLabel}
                  </StatusBadge>
                  <span className={styles.visitMeta}>{line.dateText}</span>
                </span>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
