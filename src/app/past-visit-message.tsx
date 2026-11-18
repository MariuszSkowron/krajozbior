import type { RefObject } from "react";

import styles from "./past-visit.module.css";

type Props = {
  message: string;
  failed: boolean;
  statusRef: RefObject<HTMLParagraphElement | null>;
  alertRef: RefObject<HTMLParagraphElement | null>;
};

// The answer of a save or a removal. Two regions that stay in the page all the
// time, one `status` (success) and one `alert` (failure): a region whose role
// changes at the moment its text appears is not announced reliably by every
// screen reader. Both are focusable: after a save the button that had the focus
// may be gone, and the focus goes to the region that holds the message (the
// caller picks it by the same `failed` flag). They share one wrapper, so the
// empty one takes no room.
export function PastVisitMessage({ message, failed, statusRef, alertRef }: Props) {
  return (
    <div>
      <p ref={statusRef} tabIndex={-1} role="status" className={styles.note}>
        {failed ? "" : message}
      </p>
      <p ref={alertRef} tabIndex={-1} role="alert" className={`${styles.note} ${styles.danger}`}>
        {failed ? message : ""}
      </p>
    </div>
  );
}
