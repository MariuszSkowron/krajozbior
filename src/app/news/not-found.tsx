import Link from "next/link";

// 404 w `/news/...`: ten sam ogólny komunikat co w całej aplikacji (nie zdradza, czy aktualność
// istnieje, jest szkicem albo została wycofana), ale z wyjściem do listy aktualności.
export default function NewsNotFound() {
  return (
    <div className="content-width">
      <h1>Nie znaleziono</h1>
      <p>Tej strony nie ma albo nie jest dostępna.</p>
      <p>
        <Link className="button button--outline" href="/news">
          Wszystkie aktualności
        </Link>
      </p>
    </div>
  );
}
