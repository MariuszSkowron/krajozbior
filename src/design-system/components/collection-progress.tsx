import styles from "./collection-progress.module.css";

// Postęp w kolekcji: „X/Y” z natywnym <progress>. Tekst niesie tę samą informację co pasek,
// więc pasek nigdy nie jest jedynym nośnikiem (wypełnienie akcentem ma w jasnym motywie
// tylko 2,63:1 na torze). Kolekcja bez miejsc to osobny stan „Bez miejsc”, bez licznika i paska:
// pasek z zerem miejsc nie miałby sensu, a „0/0” powtarzałoby to samo. Nigdy procent.
export function CollectionProgress({
  visited,
  total,
  label,
}: Readonly<{ visited: number; total: number; label: string }>) {
  const counts = `${visited}/${total}`;

  return (
    <div className={styles.progress}>
      {total === 0 ? null : (
        <progress className={styles.bar} value={visited} max={total} aria-label={label}>
          {counts}
        </progress>
      )}
      {total === 0 ? (
        <p className={styles.text}>Bez miejsc</p>
      ) : (
        <p className={styles.text}>
          <span className={styles.count}>{counts}</span> odwiedzone
        </p>
      )}
      {total > 0 && visited >= total ? <CollectionComplete /> : null}
    </div>
  );
}

// Jedyny zapis stanu „Kolekcja kompletna” (karta, okładka, Start): spokojny napis z ✓ w akcencie,
// bez animacji i pochwał. Kolor dziedziczy z otoczenia (karta, zdjęcie okładki).
export function CollectionComplete({ label = "Kolekcja kompletna" }: Readonly<{ label?: string }>) {
  return <span className={styles.complete}>{label}</span>;
}
