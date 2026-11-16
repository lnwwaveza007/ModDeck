// Small PDFs written by hand for the import tests, so no lecture material is committed.

function build(objects: string[], trailerExtra = ""): Buffer {
  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(Buffer.byteLength(out, "latin1"));
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = Buffer.byteLength(out, "latin1");
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  out += offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("");
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R ${trailerExtra} >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, "latin1");
}

/** A PDF with one line of text per page. `size` is the page size in points. */
export function textPdf(lines: string[], size: [number, number] = [960, 540]): Buffer {
  const pageIds = lines.map((_, i) => 4 + i * 2);
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${lines.length} >>`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  lines.forEach((line, i) => {
    const content = `BT /F1 48 Tf 72 ${size[1] / 2} Td (${line}) Tj ET`;
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${size[0]} ${size[1]}] /Resources << /Font << /F1 3 0 R >> >> /Contents ${pageIds[i] + 1} 0 R >>`,
      `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    );
  });
  return build(objects);
}

/** A PDF that asks for a password. The user entry is not the empty password's, so pdf.js stops. */
export function protectedPdf(): Buffer {
  const hex = (byte: string) => byte.repeat(32);
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] >>",
    `<< /Filter /Standard /V 1 /R 2 /P -4 /O <${hex("aa")}> /U <${hex("bb")}> >>`,
  ];
  return build(objects, `/Encrypt 4 0 R /ID [<${hex("11")}> <${hex("11")}>]`);
}

/** Starts like a PDF and then stops making sense. */
export const corruptPdf = (): Buffer =>
  Buffer.from("%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 9 0 R >>\n%%not really a pdf\n");
