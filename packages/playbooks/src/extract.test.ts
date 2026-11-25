import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { detectKind, ExtractionError, extractText } from "./extract.js";

const enc = new TextEncoder();

/** PDF mínimo válido (1 página, fonte Helvetica) com offsets de xref corretos. */
function makePdf(lines: string[]): Uint8Array {
  const content = `BT /F1 12 Tf 72 720 Td 14 TL ${lines.map((l) => `(${l}) '`).join(" ")} ET`;
  const objs = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  objs.forEach((o, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return enc.encode(out);
}

async function makeDocx(paragraphs: string[]) {
  const zip = new JSZip();
  zip.file(
    "[Content_Types].xml",
    '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
  );
  zip.file(
    "_rels/.rels",
    '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
  );
  zip.file(
    "word/document.xml",
    `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${paragraphs
      .map((p) => `<w:p><w:r><w:t>${p}</w:t></w:r></w:p>`)
      .join("")}</w:body></w:document>`,
  );
  return zip.generateAsync({ type: "uint8array" });
}

async function makePptx() {
  const zip = new JSZip();
  zip.file("ppt/slides/slide2.xml", "<p:sld><a:p><a:r><a:t>Etapa 2: Diagnóstico</a:t></a:r></a:p></p:sld>");
  zip.file(
    "ppt/slides/slide1.xml",
    "<p:sld><a:p><a:r><a:t>Objetivo &amp; escopo</a:t></a:r></a:p><a:p><a:r><a:t>Perguntar sobre adoção</a:t></a:r></a:p></p:sld>",
  );
  zip.file("ppt/notesSlides/notesSlide1.xml", "<p:notes><a:t>Nota do apresentador</a:t></p:notes>");
  return zip.generateAsync({ type: "uint8array" });
}

async function makeXlsx() {
  const zip = new JSZip();
  zip.file("xl/workbook.xml", '<workbook><sheets><sheet name="Perguntas" sheetId="1"/></sheets></workbook>');
  zip.file(
    "xl/sharedStrings.xml",
    "<sst><si><t>Pergunta</t></si><si><t>Peso</t></si><si><t>Como está a adoção?</t></si></sst>",
  );
  zip.file(
    "xl/worksheets/sheet1.xml",
    '<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row><row r="2"><c r="A2" t="s"><v>2</v></c><c r="B2"><v>3</v></c></row></sheetData></worksheet>',
  );
  return zip.generateAsync({ type: "uint8array" });
}

describe("extração de playbooks", () => {
  it("PDF", async () => {
    const r = await extractText("playbook.pdf", makePdf(["Objetivo da reuniao", "Pergunta sobre adocao"]));
    expect(r.kind).toBe("pdf");
    expect(r.text).toContain("Objetivo da reuniao");
    expect(r.text).toContain("Página 1");
  });

  it("DOCX", async () => {
    const r = await extractText("playbook.docx", await makeDocx(["Etapa de onboarding", "Qual o objetivo?"]));
    expect(r.text).toContain("Etapa de onboarding");
    expect(r.text).toContain("Qual o objetivo?");
  });

  it("PPTX em ordem numérica, com notas e entidades decodificadas", async () => {
    const r = await extractText("deck.pptx", await makePptx());
    expect(r.text.indexOf("Objetivo & escopo")).toBeLessThan(r.text.indexOf("Etapa 2"));
    expect(r.text).toContain("Notas: Nota do apresentador");
  });

  it("XLSX com strings compartilhadas e números", async () => {
    const r = await extractText("perguntas.xlsx", await makeXlsx());
    expect(r.text).toContain("Planilha: Perguntas");
    expect(r.text).toContain("Como está a adoção? | 3");
  });

  it("TXT e Markdown", async () => {
    expect((await extractText("a.md", enc.encode("# Playbook\n\n\n\nTexto"))).text).toBe(
      "# Playbook\n\nTexto",
    );
    expect((await extractText("a.txt", enc.encode("olá"))).kind).toBe("txt");
  });

  it("rejeita extensão que não corresponde ao conteúdo", async () => {
    expect(detectKind("virus.pdf", enc.encode("MZ executável"))).toBeNull();
    expect(detectKind("x.docx", makePdf(["a"]))).toBeNull();
    await expect(extractText("x.exe", enc.encode("abc"))).rejects.toBeInstanceOf(ExtractionError);
  });

  it("rejeita binário disfarçado de texto e documento vazio", async () => {
    await expect(extractText("a.txt", new Uint8Array([0x61, 0, 0x62]))).rejects.toBeInstanceOf(
      ExtractionError,
    );
    await expect(extractText("a.txt", enc.encode("   \n "))).rejects.toThrow(/não contém texto/);
  });
});
