// Génération automatique d'une mise en page pour N photos.
// Arbres de découpe aléatoires (côte à côte « V » / empilé « H ») : le ratio d'un nœud V vaut
// a1 + a2, celui d'un nœud H vaut 1 / (1/a1 + 1/a2). On garde l'arbre dont le ratio est le plus
// proche de celui de la page, ce qui donne à chaque case presque exactement le ratio de sa photo.
// Disposition « moulinet » : quatre blocs tournent autour d'un bloc central (aucune ligne ne traverse
// la page), chaque bloc étant ensuite découpé comme ci-dessus.

import { computeCells, forEachLine, isValid } from '../geometry/bsp';
import { side, type Pt } from '../geometry/polygon';
import type { BspNode, Cut, Settings } from '../types';

export type LayoutMode = 'classic' | 'pinwheel' | 'random';

type Tree = { leaf: number; a: number } | { dir: 'V' | 'H'; l: Tree; r: Tree; a: number };

export interface GenOptions {
  aspects: number[]; // largeur / hauteur de chaque photo
  settings: Settings;
  seed: number;
  obliquityDeg: number; // inclinaison maximale des coupes obliques
  obliqueShare: number; // proportion de coupes inclinées (0–1)
  /** Surface minimale d'une case, en fraction de la surface moyenne (0–1). */
  minAreaFrac?: number;
  /** Disposition générale (par défaut : classique). */
  mode?: LayoutMode;
  tries?: number;
}

export const DEFAULT_MIN_AREA_FRAC = 0.4;

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

/** Pénalités communes sur les cases d'une page : trop petites, trop d'écart de tailles, trop allongées. */
function cellPenalty(rects: { r: Rect }[], W: number, H: number, minFrac: number): number {
  const areas = rects.map((o) => o.r.w * o.r.h);
  const spread = Math.log(Math.max(...areas) / Math.min(...areas));
  // cases sous la surface minimale : pénalité forte, proportionnelle à l'écart
  const minA = (minFrac * W * H) / rects.length;
  let small = 0;
  for (const a of areas) if (a < minA) small += Math.log(minA / a);
  // cases très allongées (la photo y serait fortement rognée)
  const thin = rects.filter((o) => Math.max(o.r.w / o.r.h, o.r.h / o.r.w) > 3.2).length;
  return 6 * small + 0.4 * Math.max(0, spread - Math.log(10)) + 0.5 * thin;
}

function score(t: Tree, W: number, H: number, minFrac: number): number {
  const fit = Math.abs(Math.log(t.a / (W / H)));
  const rects: { i: number; r: Rect }[] = [];
  leafRects(t, { x: 0, y: 0, w: W, h: H }, rects);
  return 4 * fit + cellPenalty(rects, W, H, minFrac);
}

// ------------------------------------------------------------------ moulinet

/** Moulinet : f = [x1, x2, y1, y2] en fractions de la page, et un arbre de photos par bloc (A, B, C, D, centre). */
interface Pin { f: [number, number, number, number]; groups: Tree[] }

const X1: [number, number] = [0.2, 0.46];
const X2: [number, number] = [0.54, 0.8];
const clamp = (v: number, [a, b]: [number, number]) => Math.min(b, Math.max(a, v));

/** Les cinq blocs d'un moulinet (sens horaire) : A en haut à gauche, B à droite, C en bas, D à gauche, centre. */
function pinRects(f: Pin['f'], W: number, H: number): Rect[] {
  const [x1, x2, y1, y2] = [f[0] * W, f[1] * W, f[2] * H, f[3] * H];
  return [
    { x: 0, y: 0, w: x2, h: y1 },
    { x: x2, y: 0, w: W - x2, h: y2 },
    { x: x1, y: y2, w: W - x1, h: H - y2 },
    { x: 0, y: y1, w: x1, h: H - y1 },
    { x: x1, y: y1, w: x2 - x1, h: y2 - y1 },
  ];
}

function scorePin(c: Pin, W: number, H: number, minFrac: number, n: number): number {
  const regions = pinRects(c.f, W, H);
  const rects: { i: number; r: Rect }[] = [];
  let fit = 0;
  c.groups.forEach((t, g) => {
    const r = regions[g];
    // un bloc dont le ratio ne correspond pas à ses photos les déforme toutes : poids selon le nombre de photos
    fit += Math.abs(Math.log(t.a / (r.w / r.h))) * (0.6 + (4 * countTree(t)) / n);
    leafRects(t, r, rects);
  });
  return 4 * fit + cellPenalty(rects, W, H, minFrac);
}

const countTree = (t: Tree): number => ('leaf' in t ? 1 : countTree(t.l) + countTree(t.r));
const itemsOf = (t: Tree): number[] => ('leaf' in t ? [t.leaf] : [...itemsOf(t.l), ...itemsOf(t.r)]);

function randomPin(idx: number[], aspects: number[], rnd: () => number, W: number, H: number): Pin {
  const f: Pin['f'] = [
    X1[0] + rnd() * (X1[1] - X1[0]), X2[0] + rnd() * (X2[1] - X2[0]),
    X1[0] + rnd() * (X1[1] - X1[0]), X2[0] + rnd() * (X2[1] - X2[0]),
  ];
  // photos réparties entre les blocs selon leur surface (au moins une par bloc)
  const areas = pinRects(f, W, H).map((r) => r.w * r.h);
  const total = areas.reduce((a, b) => a + b, 0);
  const n = idx.length;
  const sizes = areas.map((a) => Math.max(1, Math.round((a / total) * n * (0.75 + rnd() * 0.5))));
  while (sizes.reduce((a, b) => a + b, 0) > n) sizes[sizes.indexOf(Math.max(...sizes))]--;
  while (sizes.reduce((a, b) => a + b, 0) < n) sizes[Math.floor(rnd() * 5)]++;
  const groups: Tree[] = [];
  let k = 0;
  for (const s of sizes) { groups.push(randomTree(idx.slice(k, k + s), aspects, rnd)); k += s; }
  return { f, groups };
}

/** Retire la photo `item` d'un arbre (renvoie null si l'arbre ne contenait qu'elle). */
function removeItem(t: Tree, item: number): Tree | null {
  if ('leaf' in t) return t.leaf === item ? null : t;
  const l = removeItem(t.l, item), r = removeItem(t.r, item);
  if (!l) return r;
  if (!r) return l;
  return { ...t, l, r };
}

/** Insère une photo à un endroit aléatoire de l'arbre. */
function insertItem(t: Tree, leaf: Tree, rnd: () => number): Tree {
  if ('leaf' in t || rnd() < 0.3) {
    const dir = rnd() < 0.5 ? 'V' : 'H';
    return rnd() < 0.5 ? { dir, l: t, r: leaf, a: 0 } : { dir, l: leaf, r: t, a: 0 };
  }
  return rnd() < 0.5 ? { ...t, l: insertItem(t.l, leaf, rnd) } : { ...t, r: insertItem(t.r, leaf, rnd) };
}

function mutatePin(c: Pin, aspects: number[], rnd: () => number): Pin {
  const next: Pin = { f: [...c.f] as Pin['f'], groups: c.groups.map(cloneTree) };
  const op = rnd();
  if (op < 0.3) {
    // déplacer un des quatre traits
    const i = Math.floor(rnd() * 4);
    next.f[i] = clamp(next.f[i] + (rnd() - 0.5) * 0.08, i % 2 === 0 ? X1 : X2);
  } else if (op < 0.65) {
    // réorganiser un bloc
    const multi = next.groups.map((_, g) => g).filter((g) => countTree(next.groups[g]) > 1);
    if (multi.length) mutate(next.groups[multi[Math.floor(rnd() * multi.length)]], rnd);
  } else {
    // faire passer une photo d'un bloc à un autre
    const from = Math.floor(rnd() * 5), to = Math.floor(rnd() * 5);
    if (from !== to && countTree(next.groups[from]) > 1) {
      const items = itemsOf(next.groups[from]);
      const item = items[Math.floor(rnd() * items.length)];
      next.groups[from] = removeItem(next.groups[from], item)!;
      next.groups[to] = insertItem(next.groups[to], { leaf: item, a: aspects[item] }, rnd);
    }
  }
  next.groups.forEach((t) => recompute(t, aspects));
  return next;
}

function bestPin(o: GenOptions, rnd: () => number, minFrac: number): Pin {
  const { widthMm: W, heightMm: H } = o.settings;
  const n = o.aspects.length;
  const idx = [...Array(n).keys()];
  const sc = (c: Pin) => scorePin(c, W, H, minFrac, n);
  const pool: { c: Pin; s: number }[] = [];
  for (let k = 0; k < 600; k++) {
    const c = randomPin(shuffle(idx, rnd), o.aspects, rnd, W, H);
    pool.push({ c, s: sc(c) });
  }
  pool.sort((u, v) => u.s - v.s);
  let best = pool[0];
  const steps = Math.min(8000, 2000 + n * 80);
  for (const cand of pool.slice(0, 4)) {
    let cur = cand;
    for (let k = 0; k < steps; k++) {
      const c = mutatePin(cur.c, o.aspects, rnd);
      const s = sc(c);
      if (s <= cur.s) cur = { c, s };
    }
    if (cur.s < best.s) best = cur;
  }
  return best.c;
}

/** Oriente une droite pour que le bloc qui la « possède » soit de son côté positif. */
function owned(p: Pt, q: Pt, owner: Pt): Cut {
  return side(p, q, owner) > 0 ? { p, q } : { p: q, q: p };
}

const center = (r: Rect): Pt => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });

function pinToBsp(c: Pin, W: number, H: number, mirror: boolean, root: BspNode, cellOf: string[]): void {
  const fx = (x: number) => (mirror ? W - x : x);
  const flip = (r: Rect): Rect => (mirror ? { ...r, x: W - r.x - r.w } : r);
  const regions = pinRects(c.f, W, H).map(flip);
  const [x1, x2, y1, y2] = [c.f[0] * W, c.f[1] * W, c.f[2] * H, c.f[3] * H];
  const P = (x: number, y: number): Pt => ({ x: fx(x), y });
  // chaque trait s'arrête sur le suivant : L0 sous A, L1 à gauche de B, L2 au-dessus de C, L3 à droite de D
  root.pin = [
    owned(P(0, y1), P(x2, y1), center(regions[0])),
    owned(P(x2, 0), P(x2, y2), center(regions[1])),
    owned(P(W, y2), P(x1, y2), center(regions[2])),
    owned(P(x1, H), P(x1, y1), center(regions[3])),
  ];
  root.children = regions.map((_, i) => ({ id: `${root.id}.${i}` }));
  c.groups.forEach((t, g) => toBsp(t, regions[g], root.children![g], cellOf));
}

/** Recalcule les ratios de bas en haut après une modification de l'arbre. */
function recompute(t: Tree, aspects: number[]): number {
  if ('leaf' in t) return (t.a = aspects[t.leaf]);
  const l = recompute(t.l, aspects), r = recompute(t.r, aspects);
  return (t.a = t.dir === 'V' ? l + r : 1 / (1 / l + 1 / r));
}

const cloneTree = (t: Tree): Tree => ('leaf' in t ? { ...t } : { ...t, l: cloneTree(t.l), r: cloneTree(t.r) });

type Inner = Extract<Tree, { dir: 'V' | 'H' }>;

function nodesOf(t: Tree, inner: Inner[] = [], leaves: Extract<Tree, { leaf: number }>[] = []) {
  if ('leaf' in t) leaves.push(t);
  else { inner.push(t); nodesOf(t.l, inner, leaves); nodesOf(t.r, inner, leaves); }
  return { inner, leaves };
}

/** Petite modification aléatoire : sens d'une coupe, échange de deux photos, ou rotation d'un sous-arbre. */
function mutate(t: Tree, rnd: () => number): void {
  const { inner, leaves } = nodesOf(t);
  if (!inner.length) return;
  const pick = <T>(a: T[]) => a[Math.floor(rnd() * a.length)];
  const op = rnd();
  if (op < 0.35) {
    const n = pick(inner);
    n.dir = n.dir === 'V' ? 'H' : 'V';
  } else if (op < 0.6 && leaves.length > 1) {
    const a = pick(leaves), b = pick(leaves);
    [a.leaf, b.leaf] = [b.leaf, a.leaf];
  } else {
    // rotation : (A (B C)) → ((A B) C), ou l'inverse — change l'équilibre des surfaces
    const cands = inner.filter((n) => !('leaf' in n.l) || !('leaf' in n.r));
    if (!cands.length) return;
    const x = pick(cands);
    if (!('leaf' in x.r) && (rnd() < 0.5 || 'leaf' in x.l)) {
      const y = x.r as Inner;
      x.l = { dir: rnd() < 0.5 ? 'V' : 'H', l: x.l, r: y.l, a: 0 };
      x.r = y.r;
    } else {
      const y = x.l as Inner;
      x.r = { dir: rnd() < 0.5 ? 'V' : 'H', l: y.r, r: x.r, a: 0 };
      x.l = y.l;
    }
  }
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

/** Fait pivoter une coupe autour de son milieu. */
function rotated({ p, q }: Cut, angle: number): Cut {
  const m = { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 };
  const c = Math.cos(angle), s = Math.sin(angle);
  const rot = (v: Pt): Pt => ({
    x: m.x + (v.x - m.x) * c - (v.y - m.y) * s,
    y: m.y + (v.x - m.x) * s + (v.y - m.y) * c,
  });
  return { p: rot(p), q: rot(q) };
}

export function generate(o: GenOptions): GenResult {
  const { settings: s } = o;
  const W = s.widthMm, H = s.heightMm;
  const n = o.aspects.length;
  if (n === 0) return { root: { id: 'r' }, cellOf: [] };
  const rnd = mulberry32(o.seed);
  const idx = [...Array(n).keys()];
  const minFrac = o.minAreaFrac ?? DEFAULT_MIN_AREA_FRAC;
  const sc = (t: Tree) => score(t, W, H, minFrac);
  const root: BspNode = { id: 'r' };
  const cellOf: string[] = new Array(n);

  // moulinet : au moins une photo par bloc ; « au hasard » tire la disposition à pile ou face
  const mode = o.mode ?? 'classic';
  const pinwheel = n >= 5 && (mode === 'pinwheel' || (mode === 'random' && rnd() < 0.5));
  if (pinwheel) {
    pinToBsp(bestPin(o, rnd, minFrac), W, H, rnd() < 0.5, root, cellOf);
    tilt(root, o, rnd);
    return { root, cellOf };
  }

  // 1. tirage : on garde les meilleurs arbres aléatoires
  const tries = o.tries ?? 1500;
  const pool: { t: Tree; s: number }[] = [];
  for (let k = 0; k < tries; k++) {
    const t = randomTree(shuffle(idx, rnd), o.aspects, rnd);
    pool.push({ t, s: sc(t) });
  }
  pool.sort((u, v) => u.s - v.s);

  // 2. amélioration locale des meilleurs candidats (on ne garde que les modifications utiles)
  let best = pool[0].t;
  let bestScore = pool[0].s;
  const steps = Math.min(6000, 1500 + n * 60);
  for (const cand of pool.slice(0, 4)) {
    let cur = cand.t, curScore = cand.s;
    for (let k = 0; k < steps; k++) {
      const next = cloneTree(cur);
      mutate(next, rnd);
      recompute(next, o.aspects);
      const s2 = sc(next);
      if (s2 <= curScore) { cur = next; curScore = s2; }
    }
    if (curScore < bestScore) { best = cur; bestScore = curScore; }
  }
  toBsp(best!, { x: 0, y: 0, w: W, h: H }, root, cellOf);
  tilt(root, o, rnd);
  return { root, cellOf };
}

/** Inclinaison : on tire les angles une fois, et on les réduit si une case s'écrase. */
function tilt(root: BspNode, o: GenOptions, rnd: () => number): void {
  const s = o.settings;
  const maxRad = (o.obliquityDeg * Math.PI) / 180;
  if (maxRad <= 0 || o.obliqueShare <= 0) return;
  const lines: { base: Cut; set: (c: Cut) => void }[] = [];
  forEachLine(root, (c, set) => lines.push({ base: { p: { ...c.p }, q: { ...c.q } }, set }));
  const angles = lines.map(() => {
    if (rnd() > o.obliqueShare) return 0;
    const a = maxRad * (0.35 + 0.65 * rnd());
    return rnd() < 0.5 ? -a : a;
  });
  for (const factor of [1, 0.6, 0.3, 0]) {
    lines.forEach((l, i) => l.set(rotated(l.base, angles[i] * factor)));
    if (isValid(computeCells(root, s), s)) break;
  }
}

/** Ratios de remplacement quand on génère sans photos. */
export function placeholderAspects(n: number, seed: number): number[] {
  const rnd = mulberry32(seed ^ 0x9e3779b9);
  const pool = [3 / 2, 3 / 2, 4 / 3, 2 / 3, 3 / 4, 1];
  return Array.from({ length: n }, () => pool[Math.floor(rnd() * pool.length)]);
}
