// Export : rendu sur un canvas à partir des photos originales en pleine résolution.

import { Zip, ZipPassThrough } from 'fflate';
import { bleedOf, computeCells } from '../geometry/bsp';
import { bbox, type Poly } from '../geometry/polygon';
import { placement } from '../photos/crop';
import type { Library } from '../photos/library';
import type { Doc, Settings } from '../types';
import { drawText } from './text';
import { pageCount, pageDoc } from '../storage/album';

/** Largeur d'impression de la page coupée, en pixels (sert d'échelle à l'export). */
export const pxForPrint = (doc: Doc) => Math.round((doc.settings.widthMm / 25.4) * doc.settings.dpi);

/** Feuille entière (page + fond perdu) en mm et en pixels à la résolution d'impression. */
export function sheetMm(s: Settings) {
  const b = bleedOf(s);
  return { w: s.widthMm + 2 * b, h: s.heightMm + 2 * b, b };
}
export function sheetPx(s: Settings) {
  const m = sheetMm(s), k = s.dpi / 25.4;
  return { w: Math.round(m.w * k), h: Math.round(m.h * k) };
}

export async function renderCanvas(
  doc: Doc,
  lib: Library,
  widthPx: number,
  onProgress?: (done: number, total: number) => void,
): Promise<OffscreenCanvas> {
  const s = doc.settings;
  // widthPx : largeur de la page coupée ; la feuille ajoute le fond perdu tout autour
  const k = widthPx / s.widthMm;
  const sheet = sheetMm(s);
  const W = Math.round(sheet.w * k), H = Math.round(sheet.h * k);
  const canvas = new OffscreenCanvas(W, H);
  const ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.fillStyle = s.bg;
  ctx.fillRect(0, 0, W, H);
  ctx.translate(sheet.b * k, sheet.b * k);

  const cells = computeCells(doc.root, s);
  const entries = [...cells.insets.entries()].filter(([, p]) => p.length >= 3);
  let done = 0;
  for (const [id, poly] of entries) {
    ctx.save();
    tracePath(ctx, poly, k);
    ctx.clip();
    const crop = doc.crops[id];
    const photo = crop ? lib.get(crop.photo) : undefined;
    if (crop && photo) {
      const p = placement(bbox(poly), photo.w, photo.h, crop);
      const bmp = await createImageBitmap(photo.file);
      ctx.drawImage(bmp, p.x * k, p.y * k, p.w * k, p.h * k);
      bmp.close();
    } else {
      ctx.fillStyle = '#e4e0d9';
      ctx.fill();
    }
    ctx.restore();
    onProgress?.(++done, entries.length);
  }
  for (const t of doc.texts ?? []) drawText(ctx, t, k);
  return canvas;
}

function tracePath(ctx: OffscreenCanvasRenderingContext2D, poly: Poly, k: number) {
  ctx.beginPath();
  poly.forEach((pt, i) => (i ? ctx.lineTo(pt.x * k, pt.y * k) : ctx.moveTo(pt.x * k, pt.y * k)));
  ctx.closePath();
}

export async function toImageBlob(canvas: OffscreenCanvas, type: 'image/jpeg' | 'image/png', quality = 0.93): Promise<Blob> {
  return canvas.convertToBlob({ type, quality });
}

export async function toPdfBlob(canvas: OffscreenCanvas, doc: Doc): Promise<Blob> {
  const { jsPDF } = await import('jspdf');
  const { w, h } = sheetMm(doc.settings);
  const pdf = new jsPDF({ orientation: w >= h ? 'landscape' : 'portrait', unit: 'mm', format: [w, h], compress: true });
  const jpeg = new Uint8Array(await (await toImageBlob(canvas, 'image/jpeg', 0.95)).arrayBuffer());
  pdf.addImage(jpeg, 'JPEG', 0, 0, w, h);
  return pdf.output('blob');
}

/** Nom de fichier d'une page d'album dans le .zip : « 00-couverture.jpg », « 01-page-1.jpg »… */
export const pageFileName = (i: number) => `${String(i).padStart(2, '0')}-${i === 0 ? 'couverture' : `page-${i}`}.jpg`;

/**
 * Album entier en un PDF : une page PDF par page de l'album, à la taille de la feuille (fond perdu compris),
 * chaque page en JPEG à la résolution d'impression. Les pages sont rendues une à une (mémoire).
 */
export async function albumPdf(doc: Doc, lib: Library, onPage?: (i: number, n: number) => void): Promise<Blob> {
  const { jsPDF } = await import('jspdf');
  const { w, h } = sheetMm(doc.settings);
  const orientation = w >= h ? 'landscape' : 'portrait';
  const pdf = new jsPDF({ orientation, unit: 'mm', format: [w, h], compress: true });
  const n = pageCount(doc);
  for (let i = 0; i < n; i++) {
    onPage?.(i, n);
    const page = pageDoc(doc, i);
    const canvas = await renderCanvas(page, lib, pxForPrint(page));
    const jpeg = new Uint8Array(await (await toImageBlob(canvas, 'image/jpeg', 0.93)).arrayBuffer());
    if (i > 0) pdf.addPage([w, h], orientation);
    pdf.addImage(jpeg, 'JPEG', 0, 0, w, h, undefined, 'NONE');
  }
  return pdf.output('blob');
}

/** Album entier en images : un JPEG par page (fond perdu compris) dans un .zip, sans recompression. */
export async function albumJpegZip(doc: Doc, lib: Library, onPage?: (i: number, n: number) => void): Promise<Blob> {
  const chunks: Uint8Array[] = [];
  let fail: Error | null = null;
  let finished!: () => void;
  const done = new Promise<void>((r) => (finished = r));
  const zip = new Zip((err, data, final) => {
    if (err) { fail = err; finished(); return; }
    chunks.push(data);
    if (final) finished();
  });
  const n = pageCount(doc);
  for (let i = 0; i < n; i++) {
    onPage?.(i, n);
    const page = pageDoc(doc, i);
    const canvas = await renderCanvas(page, lib, pxForPrint(page));
    const entry = new ZipPassThrough(pageFileName(i));
    zip.add(entry);
    entry.push(new Uint8Array(await (await toImageBlob(canvas, 'image/jpeg', 0.93)).arrayBuffer()), true);
  }
  zip.end();
  await done;
  if (fail) throw fail;
  return new Blob(chunks as BlobPart[], { type: 'application/zip' });
}

/** Tracé seul (cases en polygones) pour une finition éventuelle dans Illustrator. */
export function layoutSvg(doc: Doc): string {
  const s = doc.settings;
  const cells = computeCells(doc.root, s);
  const { w, h, b } = sheetMm(s);
  const polys = [...cells.insets.entries()]
    .filter(([, p]) => p.length >= 3)
    .map(([id, p]) => `  <polygon id="${id}" points="${p.map((v) => `${v.x.toFixed(3)},${v.y.toFixed(3)}`).join(' ')}" fill="#cccccc" stroke="none"/>`)
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${w}mm" height="${h}mm" viewBox="${-b} ${-b} ${w} ${h}">
  <rect x="${-b}" y="${-b}" width="${w}" height="${h}" fill="${s.bg}"/>
${polys}
</svg>
`;
}

export function download(blob: Blob, name: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
}
