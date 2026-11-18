// Aperçu statique d'une page (bande de pages, page voisine de la double page) : SVG construit au DOM,
// avec les aperçus réduits de la bibliothèque. Jamais d'innerHTML (noms de fichiers).

import { computeCells } from '../geometry/bsp';
import { bbox } from '../geometry/polygon';
import { placement } from '../photos/crop';
import type { Library } from '../photos/library';
import type { Doc } from '../types';
import { textSvg } from './text';

const NS = 'http://www.w3.org/2000/svg';
let uid = 0;

const el = <K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number>) => {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  return e;
};

/** SVG d'une page entière (sans le fond perdu), à la taille de son conteneur. */
export function pageSvg(doc: Doc, lib: Library): SVGSVGElement {
  const s = doc.settings;
  const svg = el('svg', { viewBox: `0 0 ${s.widthMm} ${s.heightMm}`, preserveAspectRatio: 'xMidYMid meet' });
  svg.appendChild(el('rect', { width: s.widthMm, height: s.heightMm, fill: s.bg }));
  const defs = el('defs', {});
  svg.appendChild(defs);
  const prefix = `pg${++uid}-`;
  const cells = computeCells(doc.root, s);
  let k = 0;
  for (const [id, poly] of cells.insets) {
    if (poly.length < 3) continue;
    const points = poly.map((p) => `${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(' ');
    const crop = doc.crops[id];
    const photo = crop ? lib.get(crop.photo) : undefined;
    if (!crop || !photo) {
      svg.appendChild(el('polygon', { points, fill: crop ? '#c9a39b' : '#e4e0d9' }));
      continue;
    }
    const clip = el('clipPath', { id: `${prefix}${k++}` });
    clip.appendChild(el('polygon', { points }));
    defs.appendChild(clip);
    const p = placement(bbox(poly), photo.w, photo.h, crop);
    const img = el('image', { x: p.x, y: p.y, width: p.w, height: p.h, preserveAspectRatio: 'none', 'clip-path': `url(#${clip.id})` });
    img.setAttribute('href', photo.url);
    svg.appendChild(img);
  }
  for (const t of doc.texts ?? []) svg.appendChild(textSvg(t));
  return svg;
}
