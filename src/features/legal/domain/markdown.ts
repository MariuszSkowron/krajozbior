// Mały czytnik Markdownu dla tekstów prawnych (F-K3). Teksty są publiczne i napisane przez
// nas, więc wystarczy wąski podzbiór: nagłówki `##` i `###`, akapity, listy punktowane
// i numerowane (zagnieżdżane wcięciem), tabele oraz w tekście **pogrubienie**, *kursywa*,
// [odnośnik](adres) i <adres>. Zamiast biblioteki (nowa zależność wymaga decyzji) czytnik
// zwraca drzewo, które komponent React wypisuje elementami natywnymi, bez wstawiania HTML.

export type Inline =
  | { kind: "text"; text: string }
  | { kind: "strong"; text: string }
  | { kind: "em"; text: string }
  | { kind: "link"; text: string; href: string };

export type ListBlock = { kind: "list"; ordered: boolean; items: ListItem[]; start?: number };

export type ListItem = { inlines: Inline[]; children: ListBlock[] };

export type Block =
  | { kind: "heading"; level: 2 | 3; text: string; id: string }
  | { kind: "paragraph"; inlines: Inline[] }
  | ListBlock
  | { kind: "table"; header: Inline[][]; rows: Inline[][][] };

// Adres z tekstu trafia do atrybutu `href`, więc przepuszczamy tylko http(s), pocztę
// i adresy wewnątrz serwisu; wszystko inne (np. `javascript:`) zostaje zwykłym tekstem.
export function isSafeHref(href: string): boolean {
  return /^(https?:\/\/|mailto:|\/(?!\/))/i.test(href);
}

const INLINE =
  /\*\*(.+?)\*\*|\*(.+?)\*|\[([^\]]+)\]\(([^)\s]+)\)|<((?:https?:\/\/|mailto:)[^>\s]+)>/g;

export function parseInline(source: string): Inline[] {
  const result: Inline[] = [];
  let last = 0;

  for (const match of source.matchAll(INLINE)) {
    if (match.index > last) {
      result.push({ kind: "text", text: source.slice(last, match.index) });
    }

    const [whole, strong, em, linkText, linkHref, autolink] = match;

    if (strong !== undefined) {
      result.push({ kind: "strong", text: strong });
    } else if (em !== undefined) {
      result.push({ kind: "em", text: em });
    } else {
      // An address in angle brackets is shown without the "mailto:" scheme.
      const text = linkText ?? autolink!.replace(/^mailto:/, "");
      const href = linkHref ?? autolink!;

      result.push(isSafeHref(href) ? { kind: "link", text, href } : { kind: "text", text: whole });
    }

    last = match.index + whole.length;
  }

  if (last < source.length) {
    result.push({ kind: "text", text: source.slice(last) });
  }

  return result;
}

// Identyfikator kotwicy z tekstu nagłówka: małe litery bez znaków diakrytycznych, grupy
// liter i cyfr rozdzielone myślnikami („Rozdział 1. Zasady” -> „rozdzial-1-zasady”).
export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/ł/g, "l")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

const HEADING = /^(#{2,3}) (.+)$/;
const LIST_LINE = /^( *)(?:(-)|(\d+)\.) (.*)$/;

function splitRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\||\|$/g, "")
    .split("|")
    .map((cell) => cell.trim());
}

type OpenList = { indent: number; list: ListBlock };

function parseList(lines: string[]): ListBlock {
  const stack: OpenList[] = [];
  let root: ListBlock | undefined;

  for (const line of lines) {
    const [, spaces, dash, number, text] = LIST_LINE.exec(line)!;
    const indent = spaces!.length;

    while (stack.length > 0 && indent < stack.at(-1)!.indent) {
      stack.pop();
    }

    const top = stack.at(-1);

    if (top === undefined || indent > top.indent) {
      const list: ListBlock = {
        kind: "list",
        ordered: dash === undefined,
        items: [],
      };

      // Lista numerowana, która zaczyna się od innej liczby niż 1 (ciąg przerwany akapitem,
      // np. ust. 6 po akapicie wstawionym między punkty), zachowuje numer pierwszego punktu.
      if (number !== undefined && Number(number) !== 1) {
        list.start = Number(number);
      }

      if (top === undefined) {
        root = list;
      } else {
        top.list.items.at(-1)!.children.push(list);
      }

      stack.push({ indent, list });
    }

    stack.at(-1)!.list.items.push({ inlines: parseInline(text!), children: [] });
  }

  return root!;
}

// Czyta tekst prawny. Tytuł strony podaje sama strona, więc w tekście nie ma nagłówka
// pierwszego poziomu. Powtórzony nagłówek dostaje kolejny numer w identyfikatorze.
export function parseMarkdown(source: string): Block[] {
  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  const blocks: Block[] = [];
  const usedIds = new Map<string, number>();
  let index = 0;

  while (index < lines.length) {
    const line = lines[index]!;
    const heading = HEADING.exec(line);

    if (line.trim() === "") {
      index += 1;
    } else if (heading !== null) {
      const text = heading[2]!;
      const base = slugify(text);
      const seen = usedIds.get(base) ?? 0;

      usedIds.set(base, seen + 1);
      blocks.push({
        kind: "heading",
        level: heading[1]!.length === 2 ? 2 : 3,
        text,
        id: seen === 0 ? base : `${base}-${seen + 1}`,
      });
      index += 1;
    } else if (line.startsWith("|")) {
      const rows: string[] = [];

      while (index < lines.length && lines[index]!.startsWith("|")) {
        rows.push(lines[index]!);
        index += 1;
      }

      const [header, , ...body] = rows;

      blocks.push({
        kind: "table",
        header: splitRow(header!).map(parseInline),
        rows: body.map((row) => splitRow(row).map(parseInline)),
      });
    } else if (LIST_LINE.test(line)) {
      const items: string[] = [];

      while (index < lines.length && LIST_LINE.test(lines[index]!)) {
        items.push(lines[index]!);
        index += 1;
      }

      blocks.push(parseList(items));
    } else {
      const paragraph: string[] = [];

      while (
        index < lines.length &&
        lines[index]!.trim() !== "" &&
        !HEADING.test(lines[index]!) &&
        !lines[index]!.startsWith("|") &&
        !LIST_LINE.test(lines[index]!)
      ) {
        paragraph.push(lines[index]!.trim());
        index += 1;
      }

      blocks.push({ kind: "paragraph", inlines: parseInline(paragraph.join(" ")) });
    }
  }

  return blocks;
}
