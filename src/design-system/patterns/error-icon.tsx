import styles from "./error-icon.module.css";

// Decorative error mark (circle with an exclamation point) that sits next to the
// words "Błąd:" or a summary heading, so an error is never told by colour alone
// (docs/design/accessibility.md). The text carries the meaning, so the icon is
// hidden from assistive technology. One tiny internal element shared by
// FormField, DataState, login and the correction summary; not a generic Icon.
export function ErrorIcon() {
  return (
    <svg
      className={styles.icon}
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      aria-hidden="true"
      focusable="false"
    >
      <circle cx="10" cy="10" r="8" />
      <path d="M10 5.5v5.5M10 14.5v.01" />
    </svg>
  );
}
