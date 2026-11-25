import JSZip from "jszip";
import mammoth from "mammoth";
import { extractText as extractPdfText, getDocumentProxy } from "unpdf";

export type DocKind = "pdf" | "docx" | "pptx" | "xlsx" | "txt" | "md";

export class ExtractionError extends Error {}

/** Limite de texto extraído por documento (proteção contra arquivos patológicos). */
export const MAX_EXTRACTED_CHARS = 400_000;

const MAGIC = {
  pdf: [0x25, 0x50, 0x44, 0x46], // %PDF
  zip: [0x50, 0x4b, 0x03, 0x04], // PK.. (docx/pptx/xlsx)
};

function startsWith(buf: Uint8Array, sig: number[]) {
  return sig.every((b, i) => buf[i] === b);
}

/**
 * Detecta o tipo pelo conteúdo + extensão. Nunca confia só no MIME enviado
 * pelo navegador. Retorna null para formatos não suportados.
 */
export function detectKind(filename: string, buf: Uint8Array): DocKind | null {
  const ext = filename.toLowerCase().split(".").pop() ?? "";
  if (startsWith(buf, MAGIC.pdf)) return ext === "pdf" ? "pdf" : null;
  if (startsWith(buf, MAGIC.zip)) {
    return ext === "docx" || ext === "pptx" || ext === "xlsx" ? ext : null;
  }
  if (ext === "txt" || ext === "md" || ext === "markdown") {
    // texto: rejeita binário (byte nulo nos primeiros 8 KB)
    if (buf.subarray(0, 8192).includes(0)) return null;
    return ext === "txt" ? "txt" : "md";
  }
  return null;
}

function decodeXmlEntities(s: string) {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&amp;/g, "&");
}

async function loadZip(buf: Uint8Array) {
  const zip = await JSZip.loadAsync(buf);
  // proteção contra zip bomb: soma dos tamanhos descompactados declarados
  let total = 0;
  zip.forEach((_p, f) => {
    total += (f as unknown as { _data?: { uncompressedSize?: number } })._data?.uncompressedSize ?? 0;
  });
  if (total > 200 * 1024 * 1024)
    throw new ExtractionError("arquivo compactado excede o limite de descompressão");
  return zip;
}

async function extractPptx(buf: Uint8Array): Promise<string> {
  const zip = await loadZip(buf);
  const slides = Object.keys(zip.files)
    .filter((p) => /^ppt\/slides\/slide\d+\.xml$/.test(p))
    .sort((a, b) => Number(a.match(/(\d+)\.xml$/)![1]) - Number(b.match(/(\d+)\.xml$/)![1]));
  const out: string[] = [];
  for (const [i, path] of slides.entries()) {
    const xml = await zip.file(path)!.async("string");
    const paras = xml
      .split(/<\/a:p>/)
      .map((p) =>
        [...p.matchAll(/<a:t>([\s\S]*?)<\/a:t>/g)].map((m) => decodeXmlEntities(m[1] ?? "")).join(""),
      );
    const notesPath = `ppt/notesSlides/notesSlide${path.match(/(\d+)\.xml$/)![1]}.xml`;
    let notes = "";
    if (zip.file(notesPath)) {
      const nx = await zip.file(notesPath)!.async("string");
      notes = [...nx.matchAll(/<a:t>([\s\S]*?)<\/a:t>/g)].map((m) => decodeXmlEntities(m[1] ?? "")).join(" ");
    }
    out.push(
      `## Slide ${i + 1}\n${paras.filter((p) => p.trim()).join("\n")}${notes.trim() ? `\nNotas: ${notes.trim()}` : ""}`,
    );
  }
  return out.join("\n\n");
}

async function extractXlsx(buf: Uint8Array): Promise<string> {
  const zip = await loadZip(buf);
  const shared: string[] = [];
  const ss = zip.file("xl/sharedStrings.xml");
  if (ss) {
    const xml = await ss.async("string");
    for (const si of xml.matchAll(/<si>([\s\S]*?)<\/si>/g)) {
      shared.push(
        [...(si[1] ?? "").matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)]
          .map((m) => decodeXmlEntities(m[1] ?? ""))
          .join(""),
      );
    }
  }
  const names: string[] = [];
  const wb = zip.file("xl/workbook.xml");
  if (wb) {
    for (const m of (await wb.async("string")).matchAll(/<sheet [^>]*name="([^"]*)"/g))
      names.push(decodeXmlEntities(m[1] ?? ""));
  }
  const sheets = Object.keys(zip.files)
    .filter((p) => /^xl\/worksheets\/sheet\d+\.xml$/.test(p))
    .sort((a, b) => Number(a.match(/(\d+)\.xml$/)![1]) - Number(b.match(/(\d+)\.xml$/)![1]));
  const out: string[] = [];
  for (const [i, path] of sheets.entries()) {
    const xml = await zip.file(path)!.async("string");
    const rows: string[] = [];
    for (const row of xml.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)) {
      const cells: string[] = [];
      for (const c of (row[1] ?? "").matchAll(/<c([^>]*)>([\s\S]*?)<\/c>/g)) {
        const attrs = c[1] ?? "";
        const body = c[2] ?? "";
        const v = body.match(/<v>([\s\S]*?)<\/v>/)?.[1];
        const inline = body.match(/<t[^>]*>([\s\S]*?)<\/t>/)?.[1];
        if (/t="s"/.test(attrs) && v !== undefined) cells.push(shared[Number(v)] ?? "");
        else if (inline !== undefined) cells.push(decodeXmlEntities(inline));
        else if (v !== undefined) cells.push(decodeXmlEntities(v));
      }
      if (cells.some((x) => x.trim())) rows.push(cells.join(" | "));
    }
    out.push(`## Planilha: ${names[i] ?? `Planilha ${i + 1}`}\n${rows.join("\n")}`);
  }
  return out.join("\n\n");
}

export interface ExtractionResult {
  kind: DocKind;
  text: string;
  truncated: boolean;
}

export async function extractText(filename: string, buf: Uint8Array): Promise<ExtractionResult> {
  const kind = detectKind(filename, buf);
  if (!kind) throw new ExtractionError("formato não suportado ou conteúdo não corresponde à extensão");
  let text: string;
  try {
    switch (kind) {
      case "pdf": {
        const pdf = await getDocumentProxy(new Uint8Array(buf));
        const r = await extractPdfText(pdf, { mergePages: false });
        text = (r.text as string[]).map((t, i) => `## Página ${i + 1}\n${t}`).join("\n\n");
        break;
      }
      case "docx":
        text = (await mammoth.extractRawText({ buffer: Buffer.from(buf) })).value;
        break;
      case "pptx":
        text = await extractPptx(buf);
        break;
      case "xlsx":
        text = await extractXlsx(buf);
        break;
      default:
        text = new TextDecoder("utf-8").decode(buf);
    }
  } catch (err) {
    if (err instanceof ExtractionError) throw err;
    throw new ExtractionError(`não foi possível ler o arquivo: ${(err as Error).message}`);
  }
  text = text
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (!text) throw new ExtractionError("o documento não contém texto extraível (é uma imagem escaneada?)");
  const truncated = text.length > MAX_EXTRACTED_CHARS;
  return { kind, text: truncated ? text.slice(0, MAX_EXTRACTED_CHARS) : text, truncated };
}
