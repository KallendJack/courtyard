import { crc32, deflateSync } from "node:zlib";

// Files to attach (#78), made up for the tests, the browser tests and the eval. Only Node itself,
// so the browser tests can use them without the worker.

/** A file to attach, as the browser sends it. */
export type TestFile = { readonly name: string; readonly type: string; readonly bytes: Uint8Array };

/**
 * A PNG of `width` by `height`, each pixel's colour from `colour`. Real
 * enough for a browser to open and a model to look at.
 */
export const pngOf = (
  width: number,
  height: number,
  colour: (x: number, y: number) => readonly [number, number, number],
): Uint8Array => {
  const chunk = (type: string, data: Buffer) => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const named = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(named));
    return Buffer.concat([length, named, crc]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 2, 0, 0, 0], 8);
  const rows = Buffer.alloc(height * (1 + width * 3));
  for (let y = 0; y < height; y++) {
    const start = y * (1 + width * 3);
    for (let x = 0; x < width; x++) rows.set(colour(x, y), start + 1 + x * 3);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(rows)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
};

/** How many lines `pdfOf` puts on a page. */
const PDF_LINES_PER_PAGE = 40;

/**
 * A PDF with these lines of text on it, as many pages as they need, or a
 * page with none (as a scan is to a model).
 */
export const pdfOf = (lines: readonly string[]): Uint8Array => {
  const escaped = (line: string) => line.replace(/[\\()]/g, (char) => `\\${char}`);
  const pages: (readonly string[])[] = [];
  for (let at = 0; at < lines.length; at += PDF_LINES_PER_PAGE) {
    pages.push(lines.slice(at, at + PDF_LINES_PER_PAGE));
  }
  if (pages.length === 0) pages.push([]);
  // Objects 1 and 2 are the catalog and the page list, 3 the font, then each page and its text.
  const pageIds = pages.map((_, index) => 4 + index * 2);
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pages.length} >>`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    ...pages.flatMap((page, index) => {
      const stream =
        page.length === 0
          ? ""
          : [
              "BT /F1 12 Tf 72 720 Td 16 TL",
              ...page.map((line) => `(${escaped(line)}) '`),
              "ET",
            ].join("\n");
      return [
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents ${5 + index * 2} 0 R /Resources << /Font << /F1 3 0 R >> >> >>`,
        `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
      ];
    }),
  ];
  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf, "latin1");
};
