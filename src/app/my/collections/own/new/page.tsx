import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { getRequestActor, loginHref } from "@/app/request-actor";

import catalog from "../../../../catalog.module.css";
import { OwnCollectionForm } from "../own-collection-form";

// Private page: rendered on every request, never cached by a shared cache.
export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Nowa kolekcja — Krajozbiór" };

export default async function NewOwnCollectionPage() {
  const actor = await getRequestActor();

  if (actor === null) {
    redirect(loginHref("/my/collections/own/new"));
  }

  return (
    <div className={`content-width ${catalog.page}`}>
      <header className={catalog.header}>
        <p>
          <Link href="/my/collections">← Moje kolekcje</Link>
        </p>
        <h1>Nowa kolekcja</h1>
        <p className={catalog.summary}>
          Kolekcja jest prywatna: widzisz ją tylko Ty. Miejsca dodasz po jej utworzeniu.
        </p>
      </header>
      <OwnCollectionForm mode="create" />
    </div>
  );
}
