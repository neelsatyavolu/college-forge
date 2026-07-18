import { NextRequest } from "next/server";
import { saveUpload } from "@/lib/store";
import { getWorkspaceId } from "@/lib/workspace-cookie";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const MAX_BYTES = 15 * 1024 * 1024; // 15 MB per file

async function extractText(name: string, type: string, buf: Buffer): Promise<string> {
  const lower = name.toLowerCase();
  const isText =
    type.startsWith("text/") ||
    /\.(txt|md|markdown|csv|tsv|json|rtf|html?|xml|log)$/.test(lower);

  if (isText) return buf.toString("utf8");

  if (lower.endsWith(".pdf") || type === "application/pdf") {
    try {
      // Import the implementation directly — the package index runs demo code on load.
      const mod = await import("pdf-parse/lib/pdf-parse.js");
      const pdf = (mod as unknown as { default: (b: Buffer) => Promise<{ text: string }> }).default;
      const out = await pdf(buf);
      return out.text?.trim() || "[PDF contained no extractable text]";
    } catch (err) {
      return `[Could not parse PDF "${name}": ${err instanceof Error ? err.message : String(err)}]`;
    }
  }

  if (
    lower.endsWith(".docx") ||
    type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  ) {
    try {
      const mammoth = (await import("mammoth")) as unknown as {
        extractRawText: (o: { buffer: Buffer }) => Promise<{ value: string }>;
      };
      const out = await mammoth.extractRawText({ buffer: buf });
      return out.value?.trim() || "[DOCX contained no extractable text]";
    } catch (err) {
      return `[Could not parse DOCX "${name}": ${err instanceof Error ? err.message : String(err)}]`;
    }
  }

  // Fallback: try UTF-8 for unknown types.
  const asText = buf.toString("utf8");
  // eslint-disable-next-line no-control-regex
  if (/�/.test(asText.slice(0, 500))) {
    return `[Unsupported file type for "${name}". Upload a PDF, DOCX, or text file.]`;
  }
  return asText;
}

export async function POST(req: NextRequest) {
  const { id, setCookie } = getWorkspaceId(req);

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return Response.json({ error: "Expected multipart/form-data." }, { status: 400 });
  }

  const files = form.getAll("files").filter((f): f is File => f instanceof File);
  if (files.length === 0) {
    return Response.json({ error: "No files provided." }, { status: 400 });
  }

  const saved: { name: string; chars: number }[] = [];
  const errors: string[] = [];

  for (const file of files) {
    if (file.size > MAX_BYTES) {
      errors.push(`${file.name} is too large (max 15 MB).`);
      continue;
    }
    try {
      const buf = Buffer.from(await file.arrayBuffer());
      const text = await extractText(file.name, file.type || "", buf);
      const meta = await saveUpload(id, file.name, text);
      saved.push({ name: meta.name, chars: meta.chars });
    } catch (err) {
      errors.push(`${file.name}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  const headers: Record<string, string> = { "content-type": "application/json", "cache-control": "no-store" };
  if (setCookie) headers["set-cookie"] = setCookie;
  return new Response(JSON.stringify({ saved, errors }), { headers });
}
