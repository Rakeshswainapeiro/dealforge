// Minimal hand-built PDFs for the extraction tests: one with a text layer (and a
// table-like row), one that is only a scanned image (no text layer).
function build(objects) {
  let out = '%PDF-1.4\n'; const offs = [];
  objects.forEach((o, i) => { offs.push(Buffer.byteLength(out, 'latin1')); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = Buffer.byteLength(out, 'latin1');
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n` + offs.map((o) => String(o).padStart(10, '0') + ' 00000 n \n').join('');
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}

// lines: [{ y, parts: [{ x, text }] }]
export function textPdf(lines) {
  const content = lines.map((l) => l.parts.map((p) => `BT /F1 11 Tf ${p.x} ${l.y} Td (${p.text.replace(/[()\\]/g, '\\$&')}) Tj ET`).join('\n')).join('\n');
  return build([
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ]);
}

// A page that only draws a JPEG: no text layer at all.
export function imagePdf(jpeg, w, h) {
  const content = `q 500 0 0 ${Math.round(500 * h / w)} 40 400 cm /Im1 Do Q`;
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /XObject << /Im1 5 0 R >> >> >>',
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
  ];
  let out = '%PDF-1.4\n'; const offs = [];
  const parts = [];
  objs.forEach((o, i) => { offs.push(Buffer.byteLength(out, 'latin1')); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  offs.push(Buffer.byteLength(out, 'latin1'));
  const head = Buffer.from(out + `5 0 obj\n<< /Type /XObject /Subtype /Image /Width ${w} /Height ${h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`, 'latin1');
  const mid = Buffer.concat([head, jpeg, Buffer.from('\nendstream\nendobj\n', 'latin1')]);
  const xref = mid.length;
  const tail = Buffer.from(`xref\n0 6\n0000000000 65535 f \n` + offs.map((o) => String(o).padStart(10, '0') + ' 00000 n \n').join('') + `trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`, 'latin1');
  parts.push(mid, tail);
  return Buffer.concat(parts);
}
