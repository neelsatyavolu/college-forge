/**
 * PDF to text for the scraper, keeping each line's columns (like `pdftotext -layout`), so tables
 * such as a Common Data Set's checkbox grids stay readable: the X lands under its column header.
 */
import { getDocumentProxy } from "unpdf";
import { layoutPage } from "./layout";

export const MAX_PDF_BYTES = 20 * 1024 * 1024;
export async function pdfToText(bytes: ArrayBuffer, maxPages = 60): Promise<{ text: string; pages: number }> {
  const pdf = await getDocumentProxy(new Uint8Array(bytes));
  const pages: string[] = [];
  const n = Math.min(pdf.numPages, maxPages);
  for (let p = 1; p <= n; p++) {
    const page = await pdf.getPage(p);
    const content = await page.getTextContent();
    const items = (content.items as { str?: string; transform?: number[] }[])
      .filter((i) => typeof i.str === "string" && Array.isArray(i.transform))
      .map((i) => ({ str: i.str!, x: i.transform![4], y: i.transform![5] }));
    pages.push(`## Page ${p}\n\n${layoutPage(items)}`);
  }
  return { text: pages.join("\n\n"), pages: pdf.numPages };
}
