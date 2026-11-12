// Arbre de coupes : chaque nœud interne coupe sa case en deux par une droite.
// Les cases affichées sont les feuilles. Les droites sont en coordonnées absolues :
// déplacer une coupe déforme automatiquement toutes les cases qui la touchent,
// et les coupes qui s'appuient dessus (jonctions en T) s'allongent ou se raccourcissent.

import type { BspNode, Cut, Settings } from '../types';
import { area, insetConvex, lineThroughPolygon, splitByLine, type Poly, type Pt } from './polygon';

export interface CutInfo {
  id: string;
  cut: Cut;
  /** Partie visible de la coupe (bornée par la case parente), triée dans le sens p→q. */
  seg: [Pt, Pt];
  /** Case parente (avant gouttière). */
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

export function computeCells(root: BspNode, s: Settings): Cells {
  const leaves = new Map<string, Poly>();
  const cuts: CutInfo[] = [];
  let ok = true;
  const walk = (node: BspNode, poly: Poly) => {
    if (node.cut && node.children) {
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
  if (!root.children) return null;
  return findNode(root.children[0], id) ?? findNode(root.children[1], id);
}

export function leafIds(root: BspNode): string[] {
  if (!root.children) return [root.id];
  return [...leafIds(root.children[0]), ...leafIds(root.children[1])];
}

/** Transforme une feuille en nœud coupé. Renvoie les identifiants des deux nouvelles cases. */
export function splitLeaf(root: BspNode, id: string, cut: Cut): [string, string] {
  const node = findNode(root, id);
  if (!node || node.children) throw new Error(`Case introuvable : ${id}`);
  node.cut = { p: { ...cut.p }, q: { ...cut.q } };
  node.children = [{ id: `${id}.0` }, { id: `${id}.1` }];
  return [`${id}.0`, `${id}.1`];
}

/** Supprime une coupe (et toutes les coupes de son sous-arbre). Renvoie les feuilles supprimées. */
export function removeCut(root: BspNode, id: string): string[] {
  const node = findNode(root, id);
  if (!node || !node.children) return [];
  const removed = leafIds(node);
  delete node.cut;
  delete node.children;
  return removed;
}

export function scaleTree(node: BspNode, sx: number, sy: number): void {
  if (node.cut) {
    node.cut.p = { x: node.cut.p.x * sx, y: node.cut.p.y * sy };
    node.cut.q = { x: node.cut.q.x * sx, y: node.cut.q.y * sy };
  }
  node.children?.forEach((c) => scaleTree(c, sx, sy));
}

export function countLeaves(root: BspNode): number {
  return leafIds(root).length;
}
