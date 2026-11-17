import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "Nie znaleziono — Starter" };

// One "not found" for every missing or hidden resource: it never says whether
// something private exists at the address.
export default function NotFound() {
  return (
    <div className="content-width">
      <h1>Nie znaleziono</h1>
      <p>Tej strony nie ma albo nie jest dostępna.</p>
      <p>
        <Link href="/">Wróć na stronę główną</Link>
      </p>
    </div>
  );
}
