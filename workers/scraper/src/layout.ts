/** Fixed-width line layout for PDF text items (kept free of unpdf so node tests can load it). */
const CHAR_PT = 4.5; // approximate width of one character column, in PDF points
const LINE_TOLERANCE = 2.5; // items whose baselines differ by less than this share a line

export type Item = { str: string; x: number; y: number };

/** Lays out one page's text items as lines of fixed-width columns. Exported for tests. */
export function layoutPage(items: Item[]): string {
  const lines: { y: number; items: Item[] }[] = [];
  for (const it of items.filter((i) => i.str.trim()).sort((a, b) => b.y - a.y)) {
    const line = lines.find((l) => Math.abs(l.y - it.y) < LINE_TOLERANCE);
    if (line) line.items.push(it);
    else lines.push({ y: it.y, items: [it] });
  }
  const minX = Math.min(...items.map((i) => i.x), Infinity);
  return lines
    .map((l) => {
      let out = "";
      for (const it of l.items.sort((a, b) => a.x - b.x)) {
        const col = Math.max(0, Math.round((it.x - minX) / CHAR_PT));
        out += (out.length < col ? " ".repeat(col - out.length) : out && !out.endsWith(" ") ? " " : "") + it.str;
      }
      return out.trimEnd();
    })
    .join("\n");
}

