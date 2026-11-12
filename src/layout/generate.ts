// Génération automatique d'une mise en page pour N photos.
// Arbres de découpe aléatoires (côte à côte « V » / empilé « H ») : le ratio d'un nœud V vaut
// a1 + a2, celui d'un nœud H vaut 1 / (1/a1 + 1/a2). On garde l'arbre dont le ratio est le plus
// proche de celui de la page, ce qui donne à chaque case presque exactement le ratio de sa photo.

import { computeCells, isValid } from '../geometry/bsp';
import type { Pt } from '../geometry/polygon';
import type { BspNode, Settings } from '../types';

type Tree = { leaf: number; a: number } | { dir: 'V' | 'H'; l: Tree; r: Tree; a: number };

export interface GenOptions {
  aspects: number[]; // largeur / hauteur de chaque photo
  settings: Settings;
  seed: number;
  obliquityDeg: number; // inclinaison maximale des coupes obliques
  obliqueShare: number; // proportion de coupes inclinées (0–1)
  tries?: number;
}

export interface GenResult {
  root: BspNode;
  /** cellOf[i] = identifiant de la case de la photo i */
  cellOf: string[];
}

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle<T>(arr: T[], rnd: () => number): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function randomTree(items: number[], aspects: number[], rnd: () => number): Tree {
  if (items.length === 1) return { leaf: items[0], a: aspects[items[0]] };
  const n = items.length;
  // coupe plutôt vers le milieu, avec de la variété (quelques grandes cases)
  const k = Math.max(1, Math.min(n - 1, Math.round(n / 2 + (rnd() - 0.5) * n * 0.9)));
  const l = randomTree(items.slice(0, k), aspects, rnd);
  const r = randomTree(items.slice(k), aspects, rnd);
  const dir = rnd() < 0.5 ? 'V' : 'H';
  const a = dir === 'V' ? l.a + r.a : 1 / (1 / l.a + 1 / r.a);
  return { dir, l, r, a };
}

type Rect = { x: number; y: number; w: number; h: number };

function leafRects(t: Tree, rect: Rect, out: { i: number; r: Rect }[]): void {
  if ('leaf' in t) { out.push({ i: t.leaf, r: rect }); return; }
  if (t.dir === 'V') {
    const w1 = (rect.w * t.l.a) / (t.l.a + t.r.a);
    leafRects(t.l, { ...rect, w: w1 }, out);
    leafRects(t.r, { ...rect, x: rect.x + w1, w: rect.w - w1 }, out);
  } else {
    const h1 = (rect.h * (1 / t.l.a)) / (1 / t.l.a + 1 / t.r.a);
    leafRects(t.l, { ...rect, h: h1 }, out);
    leafRects(t.r, { ...rect, y: rect.y + h1, h: rect.h - h1 }, out);
  }
}

function score(t: Tree, W: number, H: number): number {
  const fit = Math.abs(Math.log(t.a / (W / H)));
  const rects: { i: number; r: Rect }[] = [];
  leafRects(t, { x: 0, y: 0, w: W, h: H }, rects);
  const areas = rects.map((o) => o.r.w * o.r.h);
  const spread = Math.log(Math.max(...areas) / Math.min(...areas));
  // cases trop fines (moins de 1/12 de la petite dimension de la page)
  const thin = rects.filter((o) => Math.min(o.r.w, o.r.h) < Math.min(W, H) / 12).length;
  return 4 * fit + 0.4 * Math.max(0, spread - Math.log(10)) + 0.5 * thin;
}

/** Construit l'arbre BSP ; les coupes partent du bord du rectangle idéal. */
function toBsp(t: Tree, rect: Rect, node: BspNode, cellOf: string[]): void {
  if ('leaf' in t) { cellOf[t.leaf] = node.id; return; }
  let p: Pt, q: Pt, r0: Rect, r1: Rect;
  if (t.dir === 'V') {
    const w1 = (rect.w * t.l.a) / (t.l.a + t.r.a);
    const x = rect.x + w1;
    // sens haut→bas : l'enfant 0 (côté positif) est à gauche
    p = { x, y: rect.y }; q = { x, y: rect.y + rect.h };
    r0 = { ...rect, w: w1 }; r1 = { ...rect, x, w: rect.w - w1 };
  } else {
    const h1 = (rect.h / t.l.a) / (1 / t.l.a + 1 / t.r.a);
    const y = rect.y + h1;
    // sens droite→gauche : l'enfant 0 est en haut
    p = { x: rect.x + rect.w, y }; q = { x: rect.x, y };
    r0 = { ...rect, h: h1 }; r1 = { ...rect, y, h: rect.h - h1 };
  }
  node.cut = { p, q };
  node.children = [{ id: `${node.id}.0` }, { id: `${node.id}.1` }];
  toBsp(t.l, r0, node.children[0], cellOf);
  toBsp(t.r, r1, node.children[1], cellOf);
}

function rotateCut(node: BspNode, angle: number): void {
  if (!node.cut) return;
  const { p, q } = node.cut;
  const m = { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 };
  const c = Math.cos(angle), s = Math.sin(angle);
  const rot = (v: Pt): Pt => ({
    x: m.x + (v.x - m.x) * c - (v.y - m.y) * s,
    y: m.y + (v.x - m.x) * s + (v.y - m.y) * c,
  });
  node.cut = { p: rot(p), q: rot(q) };
}

function internalNodes(n: BspNode, out: BspNode[] = []): BspNode[] {
  if (n.children) { out.push(n); internalNodes(n.children[0], out); internalNodes(n.children[1], out); }
  return out;
}

export function generate(o: GenOptions): GenResult {
  const { settings: s } = o;
  const W = s.widthMm, H = s.heightMm;
  const n = o.aspects.length;
  if (n === 0) return { root: { id: 'r' }, cellOf: [] };
  const rnd = mulberry32(o.seed);
  const idx = [...Array(n).keys()];
  let best: Tree | null = null;
  let bestScore = Infinity;
  const tries = o.tries ?? (n > 40 ? 2500 : 5000);
  for (let k = 0; k < tries; k++) {
    const t = randomTree(shuffle(idx, rnd), o.aspects, rnd);
    const sc = score(t, W, H);
    if (sc < bestScore) { bestScore = sc; best = t; }
  }
  const root: BspNode = { id: 'r' };
  const cellOf: string[] = new Array(n);
  toBsp(best!, { x: 0, y: 0, w: W, h: H }, root, cellOf);

  // Inclinaison : on tire les angles une fois, et on les réduit si une case s'écrase.
  const maxRad = (o.obliquityDeg * Math.PI) / 180;
  if (maxRad > 0 && o.obliqueShare > 0) {
    const nodes = internalNodes(root);
    const base = nodes.map((nd) => ({ p: { ...nd.cut!.p }, q: { ...nd.cut!.q } }));
    const angles = nodes.map(() => {
      if (rnd() > o.obliqueShare) return 0;
      const a = maxRad * (0.35 + 0.65 * rnd());
      return rnd() < 0.5 ? -a : a;
    });
    for (const factor of [1, 0.6, 0.3, 0]) {
      nodes.forEach((nd, i) => { nd.cut = { p: { ...base[i].p }, q: { ...base[i].q } }; rotateCut(nd, angles[i] * factor); });
      if (isValid(computeCells(root, s), s)) break;
    }
  }
  return { root, cellOf };
}

/** Ratios de remplacement quand on génère sans photos. */
export function placeholderAspects(n: number, seed: number): number[] {
  const rnd = mulberry32(seed ^ 0x9e3779b9);
  const pool = [3 / 2, 3 / 2, 4 / 3, 2 / 3, 3 / 4, 1];
  return Array.from({ length: n }, () => pool[Math.floor(rnd() * pool.length)]);
}
