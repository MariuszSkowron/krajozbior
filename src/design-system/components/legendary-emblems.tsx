import type { ReactNode } from "react";

import type { LegendaryCardCategory } from "./legendary-card";
import styles from "./legendary-emblems.module.css";

// Emblematy kategorii kart legendarnych (D-56 pkt 1, DT-E6-4a-10): własne rysunki „ryciną
// linią” w siatce 120 × 120, bez plików graficznych. Linia główna (3) niesie motyw w akcencie
// kategorii, linia detalu (1,5) ornament i fakturę. Powtarzalne elementy pierścienia i pasa
// tworzą funkcje pomocnicze (pętla po kącie), ręcznie rysowany jest tylko motyw. Emblemat to
// dekoracja (`aria-hidden`): znaczenie niesie nazwa kategorii napisana obok. Kolory nadają
// wyłącznie klasy z modułu CSS; przy wysokim kontraście cała kreska ma `CanvasText`.
// Bez godeł, herbów, logotypów, znaków szlaków i układu flagi (D-52).
const C = 60;
const r1 = (n: number): number => Math.round(n * 10) / 10;

/** Punkt na okręgu: kąt w stopniach, od góry zgodnie z ruchem wskazówek zegara. */
function pt(radius: number, angle: number): readonly [number, number] {
  const a = (angle * Math.PI) / 180;
  return [r1(C + radius * Math.sin(a)), r1(C - radius * Math.cos(a))];
}

/** Kreski promieniste od `from` do `to` (promienie) co `step` stopni w zakresie kątów. */
function ringTicks(opts: {
  start: number;
  end: number;
  step: number;
  from: number | ((angle: number) => number);
  to: number;
  className: string;
}): ReactNode[] {
  const out: ReactNode[] = [];
  for (let angle = opts.start; angle < opts.end - 0.001; angle += opts.step) {
    const inner = typeof opts.from === "function" ? opts.from(angle) : opts.from;
    const [x1, y1] = pt(inner, angle);
    const [x2, y2] = pt(opts.to, angle);
    out.push(<line key={angle} className={opts.className} x1={x1} y1={y1} x2={x2} y2={y2} />);
  }
  return out;
}

/** Kropki rozmieszczone równo na okręgu. */
function ringDots(count: number, radius: number, size: number, className: string): ReactNode[] {
  return Array.from({ length: count }, (_, i) => {
    const [cx, cy] = pt(radius, (360 / count) * i);
    return <circle key={i} className={className} cx={cx} cy={cy} r={size} />;
  });
}

/** Czteroramienna iskra z dwóch kresek (gwiazdka w pasie Nocy kultury). */
function sparkle(x: number, y: number, size: number, key: string, className: string): ReactNode {
  return (
    <path
      key={key}
      className={className}
      d={`M${x} ${r1(y - size)}V${r1(y + size)}M${r1(x - size)} ${y}H${r1(x + size)}`}
    />
  );
}

/** Fala meandra (grecki prostokątny klucz) wzdłuż łuku pasa. */
function meanderPath(from: number, to: number, inner: number, outer: number): string {
  const step = 5;
  const points: string[] = [];
  let level = inner;
  let angle = from;
  points.push(pt(level, angle).join(" "));
  let index = 0;
  while (angle < to - 0.001) {
    // Wzór okresu 20°: w górę, prosto, w dół, prosto.
    const phase = index % 4;
    if (phase === 0) level = outer;
    else if (phase === 2) level = inner;
    points.push(pt(level, angle).join(" "));
    angle += step;
    points.push(pt(level, angle).join(" "));
    index += 1;
  }
  return `M${points.join("L")}`;
}

/** Fala zorzy: łagodna sinusoida w pasie, `crests` grzbietów. */
function wavePath(from: number, to: number, radius: number, amplitude: number, crests: number) {
  const points: string[] = [];
  for (let angle = from; angle <= to + 0.001; angle += 4) {
    const phase = ((angle - from) / (to - from)) * crests * 2 * Math.PI;
    points.push(pt(radius + amplitude * Math.sin(phase), angle).join(" "));
  }
  return `M${points.join("L")}`;
}

/** Spirala woluty: `turns` zwojów od promienia `r0` do `r1`, od kąta startu. */
function spiralPath(cx: number, cy: number, radiusStart: number, radiusEnd: number, dir: 1 | -1) {
  const points: string[] = [];
  const steps = 36;
  const turns = 1.5;
  for (let i = 0; i <= steps; i += 1) {
    const t = i / steps;
    const radius = radiusStart + (radiusEnd - radiusStart) * t;
    const angle = -Math.PI / 2 + dir * t * turns * 2 * Math.PI;
    points.push(`${r1(cx + radius * Math.cos(angle))} ${r1(cy + radius * Math.sin(angle))}`);
  }
  return `M${points.join("L")}`;
}

/** Nieregularna poziomica: promień zmienia się łagodnie z kątem (jak linia na mapie terenu). */
function contourPath(radius: number, phase: number, amplitude: number): string {
  const points: string[] = [];
  for (let angle = 0; angle < 360; angle += 10) {
    const a = (angle * Math.PI) / 180;
    const wobble = 1 + amplitude * (Math.sin(3 * a + phase) + 0.5 * Math.sin(2 * a + 2 * phase));
    points.push(pt(radius * wobble, angle).join(" "));
  }
  return `M${points.join("L")}Z`;
}

/** Kokarda: krawędź z 16 łuków wokół środka (cx, cy). */
function rosetteEdge(cx: number, cy: number, radius: number): string {
  const count = 16;
  const at = (angle: number) => {
    const a = (angle * Math.PI) / 180;
    return `${r1(cx + radius * Math.sin(a))} ${r1(cy - radius * Math.cos(a))}`;
  };
  const parts = [`M${at(0)}`];
  for (let i = 1; i <= count; i += 1) parts.push(`A8 8 0 0 1 ${at((360 / count) * i)}`);
  return `${parts.join("")}Z`;
}

/** Romb ramienia róży wiatrów (czubek, dwa boki, środek). */
function compassArm(angle: number, length: number, side: number): string {
  const tip = pt(length, angle);
  const left = pt(side, angle - 38);
  const right = pt(side, angle + 38);
  return `M${tip.join(" ")}L${left.join(" ")}L${C} ${C}L${right.join(" ")}Z`;
}

type DrawProps = Readonly<{ main: string; detail: string; dot: string }>;

function CultureNight({ main, detail, dot }: DrawProps) {
  const stars = Array.from({ length: 7 }, (_, i) => {
    const [x, y] = pt(51, -80 + i * 16);
    return sparkle(x, y, 2.4, `s${i}`, detail);
  });
  const rays = [-14, -7, 0, 7, 14].map((dx) => (
    <line key={dx} className={detail} x1={60 + dx / 3} y1={68} x2={60 + dx} y2={91} />
  ));
  const [mx, my] = pt(56, 58);
  return (
    <>
      <path className={main} d="M42 92V58A18 18 0 0 1 78 58V92M34 92H86" />
      <path className={main} d="M57 38.5L60 35.5L63 38.5L60 43.5Z" />
      <path className={detail} d="M42 92L51 88.5V62L42 66" />
      {rays}
      <path
        className={main}
        d={`M${r1(mx - 1.7)} ${r1(my - 8.8)}A9 9 0 1 0 ${r1(mx + 8.8)} ${r1(my + 1.7)}A7.5 7.5 0 1 1 ${r1(mx - 1.7)} ${r1(my - 8.8)}Z`}
      />
      {stars}
      <circle className={dot} cx={C} cy={C - 14} r={1.4} />
    </>
  );
}

function Heritage({ main, detail }: DrawProps) {
  return (
    <>
      <path className={main} d="M34 33H86V38H34Z" />
      <path className={main} d="M46 38Q60 56 74 38" />
      <path className={main} d={spiralPath(38, 49, 9, 1.5, 1)} />
      <path className={main} d={spiralPath(82, 49, 9, 1.5, -1)} />
      <path className={main} d="M38 38V40M82 38V40" />
      {[51, 60, 69].map((x) => (
        <ellipse key={x} className={detail} cx={x} cy={x === 60 ? 51 : 47.5} rx={2.4} ry={3.4} />
      ))}
      <path className={main} d="M46 62V90M74 62V90M46 62H74" />
      <path className={detail} d="M53 62V88M60 62V89M67 62V88" />
      <path className={main} d="M46 90L51 86L55 92L60 87L66 93L70 88L74 90" />
      <path className={detail} d={meanderPath(124, 236, 48.5, 53.5)} />
    </>
  );
}

function NationalHoliday({ main, detail }: DrawProps) {
  const cx = 60;
  const cy = 50;
  const ribbon = (mirror: boolean) => {
    const x = (v: number) => (mirror ? 120 - v : v);
    return (
      <path
        key={mirror ? "r" : "l"}
        className={main}
        d={`M${x(53)} 82L${x(43)} 97L${x(47.8)} 96.3L${x(49)} 101L${x(59)} 86`}
      />
    );
  };
  return (
    <>
      <path className={main} d={rosetteEdge(cx, cy, 29)} />
      <circle className={detail} cx={cx} cy={cy} r={22} />
      <circle className={detail} cx={cx} cy={cy} r={14} />
      {Array.from({ length: 16 }, (_, i) => {
        const a = ((360 / 16) * i * Math.PI) / 180;
        return (
          <line
            key={i}
            className={detail}
            x1={r1(cx + 14 * Math.sin(a))}
            y1={r1(cy - 14 * Math.cos(a))}
            x2={r1(cx + 22 * Math.sin(a))}
            y2={r1(cy - 22 * Math.cos(a))}
          />
        );
      })}
      <circle className={main} cx={cx} cy={cy} r={6} />
      {ribbon(false)}
      {ribbon(true)}
      <circle className={detail} cx={C} cy={C} r={49} />
      <circle className={detail} cx={C} cy={C} r={53} />
    </>
  );
}

function NatureSky({ main, detail, dot }: DrawProps) {
  const veins = [72, 62, 52, 44].flatMap((y, i) => {
    const w = [9, 11, 10, 7][i];
    return [
      <path key={`l${y}`} className={detail} d={`M60 ${y}L${60 - w} ${y - 7}`} />,
      <path key={`r${y}`} className={detail} d={`M60 ${y}L${60 + w} ${y - 7}`} />,
    ];
  });
  return (
    <>
      <path className={main} d="M24 88C36 76 50 76 58 87C66 79 80 79 96 88" />
      <path className={main} d="M60 85C41 71 44 42 60 28C76 42 79 71 60 85Z" />
      <path className={detail} d="M60 85V38M60 85V93" />
      {veins}
      <path className={main} d="M44 28L29 39" />
      <path className={detail} d="M46.1 30.8L38 37M41.9 25.2L34 31M49 35.5L42 41" />
      <circle className={dot} cx={84} cy={30} r={1.4} />
      <circle className={dot} cx={92} cy={44} r={1.4} />
      <path className={detail} d={wavePath(-80, 80, 51, 2.4, 2)} />
    </>
  );
}

function TrailCommunity({ main, detail, dot }: DrawProps) {
  const long = [0, 90, 180, 270];
  const short = [45, 135, 225, 315];
  return (
    <>
      {short.map((a) => (
        <path key={`s${a}`} className={main} d={compassArm(a, 27, 10)} />
      ))}
      {long.map((a) => (
        <path key={`l${a}`} className={main} d={compassArm(a, 41, 11)} />
      ))}
      {long.map((a) => {
        const [x, y] = pt(33, a);
        return <path key={`m${a}`} className={detail} d={`M${C} ${C}L${x} ${y}`} />;
      })}
      <circle className={main} cx={C} cy={C} r={3.5} />
      <circle className={main} cx={28} cy={88} r={2.2} />
      <circle className={main} cx={35} cy={88} r={2.2} />
      <circle className={main} cx={42} cy={88} r={2.2} />
      <path className={detail} d="M45 91C54 94 52 80 58 72" strokeDasharray="3 3.5" />
      <circle className={dot} cx={C} cy={C} r={1.2} />
      {ringTicks({
        start: 0,
        end: 360,
        step: 10,
        from: (angle) => (angle % 90 === 0 ? 47.5 : 51),
        to: 54,
        className: detail,
      })}
    </>
  );
}

function Krajozbior({ main, detail, dot }: DrawProps) {
  const [tx, ty] = pt(19, 0);
  return (
    <>
      <circle className={main} cx={C} cy={C} r={9} />
      <circle className={dot} cx={C} cy={C} r={2.8} />
      <path className={main} d={contourPath(19, 0.4, 0.05)} />
      <path className={main} d={contourPath(29.5, 1.7, 0.07)} />
      <path className={main} d={contourPath(40, 3.1, 0.06)} />
      <path
        className={detail}
        d={`M${r1(tx - 3.6)} ${r1(ty - 1)}L${tx} ${r1(ty - 6.5)}L${r1(tx + 3.6)} ${r1(ty - 1)}Z`}
      />
      {ringDots(24, 51, 1.4, dot)}
    </>
  );
}

const draw: Readonly<Record<LegendaryCardCategory, (props: DrawProps) => ReactNode>> = {
  culture_night: CultureNight,
  heritage: Heritage,
  national_holiday: NationalHoliday,
  nature_sky: NatureSky,
  trail_community: TrailCommunity,
  krajozbior: Krajozbior,
};

const categoryClass: Readonly<Record<LegendaryCardCategory, string>> = {
  culture_night: styles.cultureNight,
  heritage: styles.heritage,
  national_holiday: styles.nationalHoliday,
  nature_sky: styles.natureSky,
  trail_community: styles.trailCommunity,
  krajozbior: styles.krajozbior,
};

export function LegendaryEmblem({
  category,
  className,
}: Readonly<{ category: LegendaryCardCategory; className?: string }>) {
  const Draw = draw[category];

  return (
    <svg
      className={`${styles.emblem} ${categoryClass[category]}${className ? ` ${className}` : ""}`}
      viewBox="0 0 120 120"
      fill="none"
      aria-hidden="true"
      focusable="false"
      data-emblem={category}
    >
      <circle className={styles.ring} cx={C} cy={C} r={56} />
      <Draw main={styles.main} detail={styles.detail} dot={styles.dot} />
    </svg>
  );
}
