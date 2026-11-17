"use client";

import { useEffect, useRef, useState } from "react";

import { tokenVar, type TokenName } from "../tokens/tokens";
import styles from "./foundation.module.css";

/** Pokazuje nazwę zmiennej CSS i jej aktualną (obliczoną) wartość z `tokens.css`. */
export function TokenValue({ name }: Readonly<{ name: TokenName }>) {
  const ref = useRef<HTMLElement>(null);
  const [value, setValue] = useState("");

  useEffect(() => {
    if (ref.current === null) return;
    setValue(getComputedStyle(ref.current).getPropertyValue(tokenCssName(name)).trim());
  }, [name]);

  return (
    <code className={styles.value} ref={ref}>
      {value}
    </code>
  );
}

export function tokenCssName(name: TokenName): string {
  return tokenVar(name).slice(4, -1);
}
