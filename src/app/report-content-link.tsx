"use client";

import { usePathname } from "next/navigation";
import { useSyncExternalStore, type ReactNode } from "react";

import { reportContentMailto } from "@/features/legal/domain/report-content";

// Odnośnik „Zgłoś naruszenie” (E5-0, spec E5 Q1; wspólny dla stopki, strony miejsca, a później
// aktualności i zdjęć, D-E7-8). Do czasu formularza (E5-6) to zwykły `mailto` z tematem i treścią
// podpowiadającą punkty z regulaminu (rozdz. 8 ust. 1). Bez `path` wskazuje bieżącą stronę.
// Adres serwisu bierze z przeglądarki; przy renderze na serwerze wiadomość ma samą ścieżkę.
const subscribe = () => () => undefined;
const browserOrigin = () => window.location.origin;
const serverOrigin = () => "";

export function ReportContentLink({
  path,
  title,
  className,
  children = "Zgłoś naruszenie",
}: Readonly<{ path?: string; title?: string; className?: string; children?: ReactNode }>) {
  const currentPath = usePathname();
  const origin = useSyncExternalStore(subscribe, browserOrigin, serverOrigin);
  const href = reportContentMailto({ path: path ?? currentPath ?? "/", title }, origin);

  return (
    <a className={className} href={href}>
      {children}
    </a>
  );
}
