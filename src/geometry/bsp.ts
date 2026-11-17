// Arbre de coupes : chaque nœud interne découpe sa case, les cases affichées sont les feuilles.
// Deux sortes de nœuds :
//  - coupe : une droite divise la case en deux (enfant 0 = côté side(p,q,·) > 0) ;
//  - moulinet : quatre droites L0..L3 découpent la case en cinq zones sans qu'aucune ligne ne la traverse :
//      zone k (k = 0..3) = côté + de Lk ∩ côté − de L(k+1) ;  zone 4 (centre) = côté − des quatre droites.
// Les droites sont en coordonnées absolues : déplacer une coupe déforme toutes les cases qui la touchent,
// et les coupes qui s'appuient dessus (jonctions en T) s'allongent ou se raccourcissent d'elles-mêmes.
// Toutes les zones sont des intersections de demi-planes avec une case convexe : elles restent convexes.

import type { BspNode, Cut, Settings } from '../types';
import { area, clipHalfPlane, insetConvex, lineThroughPolygon, splitByLine, type Poly, type Pt } from './polygon';

export interface CutInfo {
  /** Identifiant de la coupe : id du nœud, ou « id#k » pour la droite k d'un moulinet. */
  id: string;
  cut: Cut;
  /** Partie visible de la coupe, triée dans le sens p→q. */
  seg: [Pt, Pt];
  /** Zone dans laquelle les extrémités de la coupe peuvent glisser. */
  parent: Poly;
}

export interface Cells {
  leaves: Map<string, Poly>;
  insets: Map<string, Poly>;
  cuts: CutInfo[];
  ok: boolean;
}

export const rootPoly = (w: number, h: number): Poly => [
  { x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: h }, { x: 0, y: h },
];

/** Les cinq zones d'un moulinet (4 ailes puis le centre) dans la case `poly`. */
export function pinwheelRegions(poly: Poly, lines: Cut[]): Poly[] {
  const L = (k: number) => lines[k % 4];
  const regions: Poly[] = [];
  for (let k = 0; k < 4; k++) {
    let r = clipHalfPlane(poly, L(k).p, L(k).q, 1);
    r = clipHalfPlane(r, L(k + 1).p, L(k + 1).q, -1);
    regions.push(r);
  }
  let c = poly;
  for (const l of lines) c = clipHalfPlane(c, l.p, l.q, -1);
  regions.push(c);
  return regions;
}

export function computeCells(root: BspNode, s: Settings): Cells {
  const leaves = new Map<string, Poly>();
  const cuts: CutInfo[] = [];
  let ok = true;
  const walk = (node: BspNode, poly: Poly) => {
    if (node.pin && node.children?.length === 5) {
      const regions = poly.length >= 3 ? pinwheelRegions(poly, node.pin) : [[], [], [], [], []];
      node.pin.forEach((l, k) => {
        // la droite k sépare l'aile k du reste ; elle s'arrête sur la droite k+1
        const zone = poly.length >= 3 ? clipHalfPlane(poly, node.pin![(k + 1) % 4].p, node.pin![(k + 1) % 4].q, -1) : [];
        const seg = zone.length >= 3 ? lineThroughPolygon(zone, l.p, l.q) : null;
        if (!seg) ok = false;
        else cuts.push({ id: `${node.id}#${k}`, cut: l, seg, parent: zone });
      });
      regions.forEach((r, i) => {
        if (r.length < 3) ok = false;
        walk(node.children![i], r);
      });
    } else if (node.cut && node.children?.length === 2) {
      const [a, b] = poly.length >= 3 ? splitByLine(poly, node.cut.p, node.cut.q) : [[], []];
      const seg = poly.length >= 3 ? lineThroughPolygon(poly, node.cut.p, node.cut.q) : null;
      if (!seg || a.length < 3 || b.length < 3) ok = false;
      if (seg) cuts.push({ id: node.id, cut: node.cut, seg, parent: poly });
      walk(node.children[0], a);
      walk(node.children[1], b);
    } else {
      if (poly.length < 3) ok = false;
      leaves.set(node.id, poly);
    }
  };
  walk(root, rootPoly(s.widthMm, s.heightMm));
  const insets = insetLeaves(leaves, s);
  for (const [id, p] of leaves) {
    if (p.length >= 3 && (insets.get(id)?.length ?? 0) < 3) ok = false;
  }
  return { leaves, insets, cuts, ok };
}

/** Applique la gouttière : marge sur les bords de page, demi-gouttière sur les bords internes. */
export function insetLeaves(leaves: Map<string, Poly>, s: Settings): Map<string, Poly> {
  const W = s.widthMm, H = s.heightMm, e = 1e-4;
  const out = new Map<string, Poly>();
  for (const [id, poly] of leaves) {
    if (poly.length < 3) { out.set(id, []); continue; }
    const offset = (i: number) => {
      const a = poly[i], b = poly[(i + 1) % poly.length];
      const border =
        (Math.abs(a.x) < e && Math.abs(b.x) < e) ||
        (Math.abs(a.x - W) < e && Math.abs(b.x - W) < e) ||
        (Math.abs(a.y) < e && Math.abs(b.y) < e) ||
        (Math.abs(a.y - H) < e && Math.abs(b.y - H) < e);
      return border ? s.marginMm : s.gutterMm / 2;
    };
    out.set(id, insetConvex(poly, offset));
  }
  return out;
}

/** Aire minimale d'une case, pour refuser les déplacements qui l'écraseraient. */
export const minArea = (s: Settings) => Math.max(25, s.widthMm * s.heightMm * 0.0004);

export function isValid(cells: Cells, s: Settings): boolean {
  if (!cells.ok) return false;
  const m = minArea(s);
  for (const p of cells.leaves.values()) if (area(p) < m) return false;
  return true;
}

export function findNode(root: BspNode, id: string): BspNode | null {
  if (root.id === id) return root;
  for (const c of root.children ?? []) {
    const f = findNode(c, id);
    if (f) return f;
  }
  return null;
}

export function leafIds(root: BspNode): string[] {
  if (!root.children) return [root.id];
  return root.children.flatMap(leafIds);
}

/** Nœud qui porte une coupe (« r.0 » ou « r.0#2 » → « r.0 »). */
export const lineNodeId = (lineId: string) => lineId.split('#')[0];

export function getLine(root: BspNode, lineId: string): Cut | null {
  const [nid, k] = lineId.split('#');
  const node = findNode(root, nid);
  if (!node) return null;
  return k === undefined ? node.cut ?? null : node.pin?.[Number(k)] ?? null;
}

export function setLine(root: BspNode, lineId: string, cut: Cut): void {
  const [nid, k] = lineId.split('#');
  const node = findNode(root, nid);
  if (!node) return;
  if (k === undefined) node.cut = cut;
  else if (node.pin) node.pin[Number(k)] = cut;
}

/** Parcourt toutes les droites de l'arbre (coupes et droites de moulinets). */
export function forEachLine(node: BspNode, fn: (cut: Cut, set: (c: Cut) => void) => void): void {
  if (node.cut) fn(node.cut, (c) => { node.cut = c; });
  node.pin?.forEach((l, k) => fn(l, (c) => { node.pin![k] = c; }));
  node.children?.forEach((c) => forEachLine(c, fn));
}

/** Transforme une feuille en nœud coupé. Renvoie les identifiants des deux nouvelles cases. */
export function splitLeaf(root: BspNode, id: string, cut: Cut): [string, string] {
  const node = findNode(root, id);
  if (!node || node.children) throw new Error(`Case introuvable : ${id}`);
  node.cut = { p: { ...cut.p }, q: { ...cut.q } };
  node.children = [{ id: `${id}.0` }, { id: `${id}.1` }];
  return [`${id}.0`, `${id}.1`];
}

/** Supprime une coupe ou un moulinet (et tout son sous-arbre). Renvoie les feuilles supprimées. */
export function removeCut(root: BspNode, id: string): string[] {
  const node = findNode(root, lineNodeId(id));
  if (!node || !node.children) return [];
  const removed = leafIds(node);
  delete node.cut;
  delete node.pin;
  delete node.children;
  return removed;
}

/**
 * Supprime une coupe en la remplaçant par l'un de ses deux enfants : les coupes de cet enfant (droites infinies,
 * bornées par leur case) s'étendent d'elles-mêmes sur la zone de l'autre côté, qui disparaît.
 * L'enfant gardé prend l'identifiant du nœud ; ses descendants sont renommés en conséquence.
 * Renvoie la table des identifiants renommés (ancien → nouveau) et les feuilles retirées.
 */
export function promoteChild(root: BspNode, nodeId: string, keep: 0 | 1): { renamed: Map<string, string>; removed: string[] } {
  const node = findNode(root, nodeId);
  if (!node?.cut || node.children?.length !== 2) throw new Error(`Coupe introuvable : ${nodeId}`);
  const kept = node.children[keep];
  const removed = leafIds(node.children[1 - keep]);
  const renamed = new Map<string, string>();
  const rename = (n: BspNode) => {
    const id = nodeId + n.id.slice(kept.id.length);
    renamed.set(n.id, id);
    n.id = id;
    n.children?.forEach(rename);
  };
  delete node.cut;
  delete node.pin;
  delete node.children;
  if (kept.cut) node.cut = kept.cut;
  if (kept.pin) node.pin = kept.pin;
  if (kept.children) node.children = kept.children;
  renamed.set(kept.id, nodeId);
  node.children?.forEach(rename);
  return { renamed, removed };
}

export function scaleTree(root: BspNode, sx: number, sy: number): void {
  forEachLine(root, (c, set) => set({ p: { x: c.p.x * sx, y: c.p.y * sy }, q: { x: c.q.x * sx, y: c.q.y * sy } }));
}
