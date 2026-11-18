"use client";

import { useId } from "react";

import { localDateIso, type PastVisitDateForm } from "@/features/visits/domain/past-visit-form";
import type { DatePrecision } from "@/features/visits/domain/past-visit-request";

import styles from "./past-visit.module.css";

type Props = {
  legend: string;
  value: PastVisitDateForm;
  onChange: (value: PastVisitDateForm) => void;
  /** Moves the focus to the first choice when the fields appear (a form opened by a button). */
  focusFirst?: boolean;
};

// A stable function: React calls a callback ref on mount only.
function focusOnMount(element: HTMLElement | null): void {
  element?.focus();
}

const PRECISIONS: readonly { value: DatePrecision; label: string }[] = [
  { value: "unknown", label: "Nie pamiętam" },
  { value: "day", label: "Dzień" },
  { value: "month", label: "Miesiąc" },
  { value: "year", label: "Rok" },
];

const MONTHS = [
  "styczeń",
  "luty",
  "marzec",
  "kwiecień",
  "maj",
  "czerwiec",
  "lipiec",
  "sierpień",
  "wrzesień",
  "październik",
  "listopad",
  "grudzień",
];

// "Kiedy tu byłeś?": the precision is a group of radios, the fields of the other
// precisions stay in the page but hidden (`hidden` on the wrapper, not
// `disabled` on the field: a disabled field would lose what was typed when the
// person switches back). The request is built only from the chosen precision.
// The fields exist only after a click (never in the HTML of the server), so the
// `max` of the date field, today of the device, cannot differ between the server
// and the browser. It is a convenience only: the server refuses a future date.
export function PastVisitDateFields({ legend, value, onChange, focusFirst = false }: Props) {
  const id = useId();
  const set = (patch: Partial<PastVisitDateForm>) => onChange({ ...value, ...patch });

  return (
    <fieldset className={styles.fieldset}>
      <legend>{legend}</legend>
      <div className={styles.choices}>
        {PRECISIONS.map((precision, index) => (
          <label key={precision.value} className={styles.choice}>
            <input
              ref={focusFirst && index === 0 ? focusOnMount : undefined}
              type="radio"
              name={`${id}-precision`}
              value={precision.value}
              checked={value.precision === precision.value}
              onChange={() => set({ precision: precision.value })}
            />
            {precision.label}
          </label>
        ))}
      </div>
      <div className={styles.fields} hidden={value.precision !== "day"}>
        <label className={styles.field}>
          Data wizyty
          <input
            type="date"
            min="1900-01-01"
            max={localDateIso(new Date())}
            value={value.day}
            onChange={(event) => set({ day: event.target.value })}
          />
        </label>
      </div>
      <div className={styles.fields} hidden={value.precision !== "month"}>
        <label className={styles.field}>
          Miesiąc
          <select value={value.month} onChange={(event) => set({ month: event.target.value })}>
            <option value="">Wybierz miesiąc</option>
            {MONTHS.map((name, index) => (
              <option key={name} value={String(index + 1).padStart(2, "0")}>
                {name}
              </option>
            ))}
          </select>
        </label>
        <label className={styles.field}>
          Którego roku?
          <input
            type="text"
            inputMode="numeric"
            autoComplete="off"
            maxLength={4}
            placeholder="np. 2019"
            value={value.monthYear}
            onChange={(event) => set({ monthYear: event.target.value })}
          />
        </label>
      </div>
      <div className={styles.fields} hidden={value.precision !== "year"}>
        <label className={styles.field}>
          Rok
          <input
            type="text"
            inputMode="numeric"
            autoComplete="off"
            maxLength={4}
            placeholder="np. 2019"
            value={value.year}
            onChange={(event) => set({ year: event.target.value })}
          />
        </label>
      </div>
    </fieldset>
  );
}
