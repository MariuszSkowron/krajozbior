import styles from "./collection-progress.module.css";

// Postęp w kolekcji: „X/Y” z natywnym <progress>. Tekst niesie tę samą informację co pasek,
// więc pasek nigdy nie jest jedynym nośnikiem (wypełnienie akcentem ma w jasnym motywie
// tylko 2,63:1 na torze). Kolekcja bez miejsc to osobny stan „0/0” bez paska: pasek
// z zerem miejsc nie miałby sensu. Nigdy procent.
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
      <p className={styles.text}>
        <span className={styles.count}>{counts}</span>
        {total === 0 ? " — ta kolekcja nie ma jeszcze miejsc" : " odwiedzone"}
      </p>
    </div>
  );
}
