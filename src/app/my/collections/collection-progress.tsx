import { formatProgress, progressCounts, type Progress } from "@/features/album/domain/progress";

import styles from "./collections.module.css";

// "X/Y" with a native <progress>; the text carries the same information, so the
// bar is never the only signal. A collection without places is the state "0/0"
// with no bar (a bar of zero places would be meaningless).
export function CollectionProgress({ progress, label }: { progress: Progress; label: string }) {
  const { visited, total } = progressCounts(progress);

  return (
    <div className={styles.progress}>
      {progress.kind === "empty" ? null : (
        <progress className={styles.bar} value={visited} max={total} aria-label={label}>
          {formatProgress(progress)}
        </progress>
      )}
      <p className={styles.progressText}>
        {progress.kind === "empty"
          ? "0/0 — ta kolekcja nie ma jeszcze miejsc"
          : `${formatProgress(progress)} odwiedzone`}
      </p>
    </div>
  );
}
