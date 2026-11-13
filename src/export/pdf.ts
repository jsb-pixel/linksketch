/**
 * A tiny PDF writer: one JPEG picture per page, nothing else. Enough for a printable
 * yardage book without pulling in a PDF library.
 */
export interface PdfPage {
  /** JPEG file bytes. */
  jpeg: Uint8Array;
  /** Picture size in pixels. */
  width: number;
  height: number;
}

/** US Letter in PDF points (1/72 inch). */
export const LETTER = { w: 612, h: 792 };

const enc = new TextEncoder();

export function buildPdf(pages: PdfPage[], paper = LETTER): Uint8Array {
  const chunks: Uint8Array[] = [];
  const offsets: number[] = [];
  let size = 0;
  const push = (data: string | Uint8Array) => {
    const bytes = typeof data === 'string' ? enc.encode(data) : data;
    chunks.push(bytes);
    size += bytes.length;
  };
  /** Start object number n (1‑based) and remember where it is. */
  const obj = (n: number) => {
    offsets[n] = size;
    push(`${n} 0 obj\n`);
  };

  push('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n');
  // Objects: 1 catalog, 2 page tree, then per page: page, image, content.
  const pageObj = (i: number) => 3 + i * 3;
  obj(1);
  push('<< /Type /Catalog /Pages 2 0 R >>\nendobj\n');
  obj(2);
  push(`<< /Type /Pages /Count ${pages.length} /Kids [${pages.map((_, i) => `${pageObj(i)} 0 R`).join(' ')}] >>\nendobj\n`);
  pages.forEach((p, i) => {
    const n = pageObj(i);
    // Fit the picture on the paper, centred, keeping its shape.
    const k = Math.min(paper.w / p.width, paper.h / p.height);
    const w = p.width * k;
    const h = p.height * k;
    const x = (paper.w - w) / 2;
    const y = (paper.h - h) / 2;
    const content = `q ${w.toFixed(2)} 0 0 ${h.toFixed(2)} ${x.toFixed(2)} ${y.toFixed(2)} cm /Im0 Do Q\n`;
    obj(n);
    push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${paper.w} ${paper.h}] /Resources << /XObject << /Im0 ${n + 1} 0 R >> >> /Contents ${n + 2} 0 R >>\nendobj\n`);
    obj(n + 1);
    push(`<< /Type /XObject /Subtype /Image /Width ${p.width} /Height ${p.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${p.jpeg.length} >>\nstream\n`);
    push(p.jpeg);
    push('\nendstream\nendobj\n');
    obj(n + 2);
    push(`<< /Length ${content.length} >>\nstream\n${content}endstream\nendobj\n`);
  });
  const count = 2 + pages.length * 3;
  const xref = size;
  push(`xref\n0 ${count + 1}\n0000000000 65535 f \n`);
  for (let n = 1; n <= count; n++) push(`${String(offsets[n]).padStart(10, '0')} 00000 n \n`);
  push(`trailer\n<< /Size ${count + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);

  const out = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.length;
  }
  return out;
}
