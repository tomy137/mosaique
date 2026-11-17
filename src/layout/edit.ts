// Opérations d'édition de haut niveau, qui gardent les photos cohérentes avec les cases.

import { computeCells, findNode, isValid, leafIds, lineNodeId, promoteChild, removeCut, splitLeaf, type Cells } from '../geometry/bsp';
import { area, bbox, lineThroughPolygon, pointInPolygon, type Pt } from '../geometry/polygon';
import { defaultCrop } from '../photos/crop';
import type { Library } from '../photos/library';
import type { BspNode, Cut, Doc } from '../types';
import { generate, placeholderAspects, type LayoutMode } from './generate';

/** Coupe une case. La photo éventuelle va dans la plus grande des deux moitiés. Renvoie false si invalide. */
export function trySplit(doc: Doc, leafId: string, cut: Cut): boolean {
  const before = JSON.stringify(doc.root);
  const [c0, c1] = splitLeaf(doc.root, leafId, cut);
  const cells = computeCells(doc.root, doc.settings);
  if (!isValid(cells, doc.settings)) {
    doc.root = JSON.parse(before);
    return false;
  }
  const crop = doc.crops[leafId];
  delete doc.crops[leafId];
  if (crop) {
    const big = area(cells.leaves.get(c0)!) >= area(cells.leaves.get(c1)!) ? c0 : c1;
    doc.crops[big] = crop;
  }
  return true;
}

export interface MergeResult {
  ok: boolean;
  /** Pourquoi la suppression est refusée (rien n'a été modifié). */
  reason?: string;
  /** Case à sélectionner après coup (la case agrandie). */
  cellId?: string;
  /** Photos sorties du montage faute de case vide pour les accueillir (elles restent dans la bibliothèque). */
  dropped: string[];
}

const center = (poly: Pt[]): Pt => {
  const s = poly.reduce((acc, p) => ({ x: acc.x + p.x, y: acc.y + p.y }), { x: 0, y: 0 });
  return { x: s.x / poly.length, y: s.y / poly.length };
};

/**
 * Supprime une coupe en ne fusionnant que ce qui la borde :
 * - deux cases simples → une seule case (elle garde la photo de la plus grande) ;
 * - sinon, on garde le côté découpé (le plus découpé si les deux le sont) : ses cases voisines du trait
 *   s'agrandissent sur l'autre côté. Les photos des cases absorbées vont dans la case qui recouvre leur centre
 *   si elle est vide ; sinon elles sortent du montage (elles restent dans la bibliothèque).
 * Un trait de moulinet ne se supprime pas seul, sauf si ses cinq blocs sont des cases simples.
 */
export function mergeAt(doc: Doc, lineId: string, cells: Cells): MergeResult {
  const nodeId = lineNodeId(lineId);
  const node = findNode(doc.root, nodeId);
  if (!node?.children) return { ok: false, reason: 'Coupe introuvable.', dropped: [] };
  const simple = node.children.every((c) => !c.children);
  if (simple) return { ok: true, cellId: nodeId, dropped: collapse(doc, nodeId, cells) };
  if (node.pin) {
    return { ok: false, reason: 'Un trait de moulinet ne se supprime pas seul (les blocs autour sont découpés) : le déplacer, ou régénérer la mise en page.', dropped: [] };
  }
  // côté gardé : le plus découpé, puis le plus grand
  const weight = (n: BspNode) => leafIds(n).reduce((s, id) => s + area(cells.leaves.get(id) ?? []), 0);
  const [a, b] = node.children;
  const preferred: (0 | 1)[] = leafIds(a).length !== leafIds(b).length
    ? (leafIds(a).length > leafIds(b).length ? [0, 1] : [1, 0])
    : (weight(a) >= weight(b) ? [0, 1] : [1, 0]);
  const order = preferred
    // seul un côté découpé peut être gardé : garder une case simple effondrerait tout l'autre côté
    .filter((k) => !!node.children![k].children);
  for (const keep of order) {
    const root: BspNode = JSON.parse(JSON.stringify(doc.root));
    const { renamed, removed } = promoteChild(root, nodeId, keep);
    const next = computeCells(root, doc.settings);
    if (!isValid(next, doc.settings)) continue;
    // cadrages : les cases gardées sont renommées ; les photos des cases absorbées cherchent une case vide
    const crops: Doc['crops'] = {};
    for (const [id, crop] of Object.entries(doc.crops)) if (!removed.includes(id)) crops[renamed.get(id) ?? id] = crop;
    const dropped: string[] = [];
    let cellId: string | undefined;
    for (const id of removed) {
      const old = cells.leaves.get(id);
      const target = old?.length ? [...next.leaves].find(([, p]) => p.length >= 3 && pointInPolygon(p, center(old)))?.[0] : undefined;
      cellId ??= target;
      const crop = doc.crops[id];
      if (!crop) continue;
      if (target && !crops[target]) crops[target] = crop;
      else dropped.push(crop.photo);
    }
    doc.root = root;
    doc.crops = crops;
    return { ok: true, cellId, dropped };
  }
  return { ok: false, reason: 'Impossible de supprimer ce trait : une case serait écrasée en prolongeant les coupes voisines.', dropped: [] };
}

/**
 * Fusionne toutes les cases d'un nœud en une seule ; elle garde la photo de la plus grande case.
 * Renvoie les autres photos, qui sortent du montage (elles restent dans la bibliothèque).
 */
function collapse(doc: Doc, nodeId: string, cells: Cells): string[] {
  const node = findNode(doc.root, nodeId);
  if (!node?.children) return [];
  const leaves = leafIds(node);
  let keep: string | null = null;
  let best = -1;
  for (const id of leaves) {
    if (!doc.crops[id]) continue;
    const a = area(cells.leaves.get(id) ?? []);
    if (a > best) { best = a; keep = id; }
  }
  const crop = keep ? doc.crops[keep] : undefined;
  const dropped = leaves.filter((id) => id !== keep && doc.crops[id]).map((id) => doc.crops[id].photo);
  removeCut(doc.root, nodeId);
  for (const id of leaves) delete doc.crops[id];
  if (crop) doc.crops[nodeId] = crop;
  return dropped;
}

/** Ramène une coupe à l'horizontale ou la verticale la plus proche, autour de son milieu visible. */
export function straightenCut(seg: [Pt, Pt], cut: Cut): Cut {
  const m = { x: (seg[0].x + seg[1].x) / 2, y: (seg[0].y + seg[1].y) / 2 };
  const dx = cut.q.x - cut.p.x, dy = cut.q.y - cut.p.y;
  const L = 1000;
  if (Math.abs(dx) >= Math.abs(dy)) {
    const sx = Math.sign(dx) || 1;
    return { p: { x: m.x - sx * L, y: m.y }, q: { x: m.x + sx * L, y: m.y } };
  }
  const sy = Math.sign(dy) || 1;
  return { p: { x: m.x, y: m.y - sy * L }, q: { x: m.x, y: m.y + sy * L } };
}

/**
 * Accroche l'angle d'une coupe à l'horizontale/verticale si elle en est proche (≤ tolDeg),
 * en pivotant autour de `pivot`. Les extrémités sont recalculées sur le contour de `parent`.
 */
export function snapAngle(pivot: Pt, moving: Pt, tolDeg: number): Pt {
  const dx = moving.x - pivot.x, dy = moving.y - pivot.y;
  const ang = Math.atan2(dy, dx);
  const step = Math.PI / 2;
  const nearest = Math.round(ang / step) * step;
  if (Math.abs(ang - nearest) > (tolDeg * Math.PI) / 180) return moving;
  const r = Math.hypot(dx, dy);
  return { x: pivot.x + Math.cos(nearest) * r, y: pivot.y + Math.sin(nearest) * r };
}

/** Coupe « rapide » au clic : droite perpendiculaire au plus grand côté de la case, passant par le point. */
export function quickCut(cells: Cells, leafId: string, at: Pt): Cut | null {
  const poly = cells.leaves.get(leafId);
  if (!poly) return null;
  const b = bbox(poly);
  const cut: Cut = b.w >= b.h
    ? { p: { x: at.x, y: b.y - 1 }, q: { x: at.x, y: b.y + b.h + 1 } }
    : { p: { x: b.x + b.w + 1, y: at.y }, q: { x: b.x - 1, y: at.y } };
  return lineThroughPolygon(poly, cut.p, cut.q) ? cut : null;
}

/** Remplit les cases vides avec les photos non utilisées, en appariant les ratios. */
export function fillEmpty(doc: Doc, lib: Library, exclude: Set<string> = new Set()): number {
  const cells = computeCells(doc.root, doc.settings);
  const used = new Set(Object.values(doc.crops).map((c) => c.photo));
  const free = [...lib.photos.values()].filter((p) => !used.has(p.name) && !exclude.has(p.name));
  const empty = [...cells.insets.entries()].filter(([id, p]) => p.length >= 3 && !doc.crops[id]);
  if (!free.length || !empty.length) return 0;
  const cellAspect = empty.map(([id, p]) => { const b = bbox(p); return { id, a: b.w / b.h }; });
  // appariement glouton : chaque case prend la photo libre au ratio le plus proche
  cellAspect.sort((u, v) => area(cells.insets.get(v.id)!) - area(cells.insets.get(u.id)!));
  let n = 0;
  for (const c of cellAspect) {
    if (!free.length) break;
    let bi = 0, bd = Infinity;
    free.forEach((p, i) => {
      const d = Math.abs(Math.log(p.w / p.h / c.a));
      if (d < bd) { bd = d; bi = i; }
    });
    doc.crops[c.id] = defaultCrop(free[bi].name);
    free.splice(bi, 1);
    n++;
  }
  return n;
}

export interface GenerateParams { count: number; seed: number; obliquityDeg: number; obliqueShare: number; minAreaFrac: number; mode?: LayoutMode }

/** Génère une mise en page. Avec des photos : une case par photo, placées automatiquement. */
/**
 * Génère une mise en page. Photos retenues : d'abord celles déjà dans le montage, puis les autres
 * par ordre de nom, en écartant `exclude` (photos déjà utilisées dans d'autres montages).
 */
export function applyGenerate(doc: Doc, lib: Library, g: GenerateParams, exclude: Set<string> = new Set()): void {
  const inDoc = new Set(Object.values(doc.crops).map((c) => c.photo));
  const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name, 'fr', { numeric: true });
  const all = [...lib.photos.values()].sort(byName);
  const photos = [
    ...all.filter((p) => inDoc.has(p.name)),
    ...all.filter((p) => !inDoc.has(p.name) && !exclude.has(p.name)),
  ].slice(0, g.count);
  const n = Math.max(1, g.count);
  const aspects = photos.map((p) => p.w / p.h);
  if (aspects.length < n) aspects.push(...placeholderAspects(n - aspects.length, g.seed));
  const { root, cellOf } = generate({
    aspects, settings: doc.settings, seed: g.seed, obliquityDeg: g.obliquityDeg, obliqueShare: g.obliqueShare,
    minAreaFrac: g.minAreaFrac, mode: g.mode,
  });
  doc.root = root;
  doc.crops = {};
  photos.forEach((p, i) => { doc.crops[cellOf[i]] = defaultCrop(p.name); });
}
