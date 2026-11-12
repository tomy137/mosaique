// Export : rendu sur un canvas à partir des photos originales en pleine résolution.

import { computeCells } from '../geometry/bsp';
import { bbox, type Poly } from '../geometry/polygon';
import { placement } from '../photos/crop';
import type { Library } from '../photos/library';
import type { Doc } from '../types';

export const pxForPrint = (doc: Doc) => Math.round((doc.settings.widthMm / 25.4) * doc.settings.dpi);

export async function renderCanvas(
  doc: Doc,
  lib: Library,
  widthPx: number,
  onProgress?: (done: number, total: number) => void,
): Promise<OffscreenCanvas> {
  const s = doc.settings;
  const k = widthPx / s.widthMm;
  const W = Math.round(widthPx), H = Math.round(s.heightMm * k);
  const canvas = new OffscreenCanvas(W, H);
  const ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.fillStyle = s.bg;
  ctx.fillRect(0, 0, W, H);

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
  const { widthMm: w, heightMm: h } = doc.settings;
  const pdf = new jsPDF({ orientation: w >= h ? 'landscape' : 'portrait', unit: 'mm', format: [w, h], compress: true });
  const jpeg = new Uint8Array(await (await toImageBlob(canvas, 'image/jpeg', 0.95)).arrayBuffer());
  pdf.addImage(jpeg, 'JPEG', 0, 0, w, h);
  return pdf.output('blob');
}

/** Tracé seul (cases en polygones) pour une finition éventuelle dans Illustrator. */
export function layoutSvg(doc: Doc): string {
  const s = doc.settings;
  const cells = computeCells(doc.root, s);
  const polys = [...cells.insets.entries()]
    .filter(([, p]) => p.length >= 3)
    .map(([id, p]) => `  <polygon id="${id}" points="${p.map((v) => `${v.x.toFixed(3)},${v.y.toFixed(3)}`).join(' ')}" fill="#cccccc" stroke="none"/>`)
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${s.widthMm}mm" height="${s.heightMm}mm" viewBox="0 0 ${s.widthMm} ${s.heightMm}">
  <rect width="${s.widthMm}" height="${s.heightMm}" fill="${s.bg}"/>
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
