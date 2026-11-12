// Cadrage d'une photo dans une case. Le cadrage est stocké sous forme relative
// (point focal de l'image + zoom), donc il suit la case quand la mise en page change.

import type { BBox, Pt } from '../geometry/polygon';
import type { Crop } from '../types';

export const MAX_ZOOM = 20;

export interface Placement { x: number; y: number; w: number; h: number; scale: number }

/** Rectangle (mm) où dessiner l'image pour couvrir la boîte englobante de la case. */
export function placement(bb: BBox, iw: number, ih: number, crop: Crop): Placement {
  const s0 = Math.max(bb.w / iw, bb.h / ih);
  const scale = s0 * Math.max(1, crop.zoom);
  const w = iw * scale, h = ih * scale;
  let x = bb.x + bb.w / 2 - crop.fx * w;
  let y = bb.y + bb.h / 2 - crop.fy * h;
  x = Math.min(bb.x, Math.max(bb.x + bb.w - w, x));
  y = Math.min(bb.y, Math.max(bb.y + bb.h - h, y));
  return { x, y, w, h, scale };
}

/** Recalcule (fx, fy) depuis une position d'image, en la gardant dans les limites. */
function fromPlacement(bb: BBox, p: Placement, crop: Crop, zoom: number): Crop {
  const x = Math.min(bb.x, Math.max(bb.x + bb.w - p.w, p.x));
  const y = Math.min(bb.y, Math.max(bb.y + bb.h - p.h, p.y));
  return {
    ...crop,
    zoom,
    fx: (bb.x + bb.w / 2 - x) / p.w,
    fy: (bb.y + bb.h / 2 - y) / p.h,
  };
}

/** Normalise un cadrage (utile après un changement de forme de case). */
export function clampCrop(bb: BBox, iw: number, ih: number, crop: Crop): Crop {
  const zoom = Math.min(MAX_ZOOM, Math.max(1, crop.zoom));
  return fromPlacement(bb, placement(bb, iw, ih, { ...crop, zoom }), crop, zoom);
}

export function panCrop(bb: BBox, iw: number, ih: number, crop: Crop, dx: number, dy: number): Crop {
  const p = placement(bb, iw, ih, crop);
  return fromPlacement(bb, { ...p, x: p.x + dx, y: p.y + dy }, crop, crop.zoom);
}

/** Zoom autour d'un point (mm) : le point de l'image sous le curseur reste fixe. */
export function zoomCrop(bb: BBox, iw: number, ih: number, crop: Crop, factor: number, at: Pt): Crop {
  const p = placement(bb, iw, ih, crop);
  const zoom = Math.min(MAX_ZOOM, Math.max(1, crop.zoom * factor));
  const u = (at.x - p.x) / p.w, v = (at.y - p.y) / p.h;
  const s0 = Math.max(bb.w / iw, bb.h / ih);
  const w = iw * s0 * zoom, h = ih * s0 * zoom;
  return fromPlacement(bb, { x: at.x - u * w, y: at.y - v * h, w, h, scale: s0 * zoom }, crop, zoom);
}

/** Résolution effective (points par pouce) de la photo dans la case, à l'impression. */
export function effectiveDpi(bb: BBox, iw: number, ih: number, crop: Crop): number {
  const p = placement(bb, iw, ih, crop);
  return (25.4 * iw) / p.w;
}

export const defaultCrop = (photo: string): Crop => ({ photo, fx: 0.5, fy: 0.5, zoom: 1 });
