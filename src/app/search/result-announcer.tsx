"use client";

import { useEffect, useState } from "react";

import styles from "./search.module.css";

// Ogłasza liczbę wyników czytnikowi ekranu. Region `role="status"` musi istnieć w dokumencie, zanim
// zmieni się jego treść, więc tekst wstawiamy chwilę po wyrenderowaniu (także po nawigacji
// formularza po stronie klienta, gdy zmienia się tylko `message`). Dla widzących jest to ukryte;
// ta sama liczba stoi w nagłówku strony.
export function ResultAnnouncer({ message }: Readonly<{ message: string }>) {
  const [text, setText] = useState("");

  useEffect(() => {
    const timer = setTimeout(() => setText(message), 150);

    return () => clearTimeout(timer);
  }, [message]);

  return (
    <p role="status" className={styles.visuallyHidden}>
      {text}
    </p>
  );
}
