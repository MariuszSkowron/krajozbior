import styles from "./curator.module.css";

// Shown while a panel screen loads its data.
export default function CuratorLoading() {
  return (
    <p className={styles.muted} role="status">
      Wczytywanie…
    </p>
  );
}
