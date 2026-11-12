// Géométrie plane de base. Unités : millimètres, repère SVG (y vers le bas).

export type Pt = { x: number; y: number };
export type Poly = Pt[];
export type BBox = { x: number; y: number; w: number; h: number };

export const EPS = 1e-7;

export const sub = (a: Pt, b: Pt): Pt => ({ x: a.x - b.x, y: a.y - b.y });
export const add = (a: Pt, b: Pt): Pt => ({ x: a.x + b.x, y: a.y + b.y });
export const mul = (a: Pt, k: number): Pt => ({ x: a.x * k, y: a.y * k });
export const dot = (a: Pt, b: Pt): number => a.x * b.x + a.y * b.y;
export const cross = (a: Pt, b: Pt): number => a.x * b.y - a.y * b.x;
export const len = (a: Pt): number => Math.hypot(a.x, a.y);
export const dist = (a: Pt, b: Pt): number => Math.hypot(a.x - b.x, a.y - b.y);

/** Côté du point p par rapport à la droite orientée a→b (>0 : un côté, <0 : l'autre). */
export function side(a: Pt, b: Pt, p: Pt): number {
  return cross(sub(b, a), sub(p, a));
}

export function signedArea(poly: Poly): number {
  let s = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    s += a.x * b.y - b.x * a.y;
  }
  return s / 2;
}

export const area = (poly: Poly): number => Math.abs(signedArea(poly));

export function bbox(poly: Poly): BBox {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of poly) {
    if (p.x < x0) x0 = p.x;
    if (p.y < y0) y0 = p.y;
    if (p.x > x1) x1 = p.x;
    if (p.y > y1) y1 = p.y;
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

export function centroid(poly: Poly): Pt {
  const a = signedArea(poly);
  if (Math.abs(a) < EPS) {
    const s = poly.reduce((acc, p) => add(acc, p), { x: 0, y: 0 });
    return mul(s, 1 / Math.max(1, poly.length));
  }
  let cx = 0, cy = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % poly.length];
    const f = p.x * q.y - q.x * p.y;
    cx += (p.x + q.x) * f;
    cy += (p.y + q.y) * f;
  }
  return { x: cx / (6 * a), y: cy / (6 * a) };
}

/** Supprime les points en double et les points alignés. */
export function cleanup(poly: Poly, tol = 1e-6): Poly {
  let pts = poly.slice();
  let changed = true;
  while (changed && pts.length >= 3) {
    changed = false;
    const out: Poly = [];
    for (let i = 0; i < pts.length; i++) {
      const prev = out.length ? out[out.length - 1] : pts[pts.length - 1];
      const cur = pts[i];
      const next = pts[(i + 1) % pts.length];
      if (dist(prev, cur) < tol) { changed = true; continue; }
      const e1 = sub(cur, prev), e2 = sub(next, cur);
      const l = len(e1) * len(e2);
      if (l > 0 && Math.abs(cross(e1, e2)) / l < 1e-9 && dot(e1, e2) > 0) { changed = true; continue; }
      out.push(cur);
    }
    pts = out;
  }
  return pts.length >= 3 ? pts : [];
}

/** Intersection des droites (a,b) et (c,d), ou null si parallèles. */
export function lineIntersection(a: Pt, b: Pt, c: Pt, d: Pt): Pt | null {
  const r = sub(b, a), s = sub(d, c);
  const den = cross(r, s);
  if (Math.abs(den) < EPS) return null;
  const t = cross(sub(c, a), s) / den;
  return add(a, mul(r, t));
}

/**
 * Garde la partie du polygone située du côté `sign` (+1 ou -1) de la droite a→b
 * (Sutherland–Hodgman sur un demi-plan).
 */
export function clipHalfPlane(poly: Poly, a: Pt, b: Pt, sign: 1 | -1): Poly {
  if (poly.length < 3) return [];
  const l = dist(a, b);
  if (l < EPS) return poly.slice();
  const s = (p: Pt) => (sign * side(a, b, p)) / l;
  const tol = 1e-9;
  const out: Poly = [];
  for (let i = 0; i < poly.length; i++) {
    const cur = poly[i];
    const prev = poly[(i + poly.length - 1) % poly.length];
    const sc = s(cur), sp = s(prev);
    const inCur = sc >= -tol, inPrev = sp >= -tol;
    if (inCur) {
      if (!inPrev) out.push(segLine(prev, cur, sp, sc));
      out.push(cur);
    } else if (inPrev) {
      out.push(segLine(prev, cur, sp, sc));
    }
  }
  return cleanup(out);
}

function segLine(p: Pt, q: Pt, sp: number, sq: number): Pt {
  const t = sp / (sp - sq);
  return { x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t };
}

/** Coupe un polygone convexe par la droite a→b : [côté positif, côté négatif]. */
export function splitByLine(poly: Poly, a: Pt, b: Pt): [Poly, Poly] {
  return [clipHalfPlane(poly, a, b, 1), clipHalfPlane(poly, a, b, -1)];
}

/**
 * Rétrécit un polygone convexe : chaque bord i est décalé vers l'intérieur de offset(i).
 * Calculé comme l'intersection des demi-plans décalés, donc robuste même si des bords disparaissent.
 */
export function insetConvex(poly: Poly, offset: (i: number) => number): Poly {
  const n = poly.length;
  if (n < 3) return [];
  const orient: 1 | -1 = signedArea(poly) > 0 ? 1 : -1;
  let res = poly.slice();
  for (let i = 0; i < n && res.length >= 3; i++) {
    const a = poly[i], b = poly[(i + 1) % n];
    const e = sub(b, a);
    const l = len(e);
    if (l < EPS) continue;
    // side(a,b,p) > 0 pour p = a + nl : nl est la normale « positive »
    const nl = { x: -e.y / l, y: e.x / l };
    const nIn = orient > 0 ? nl : mul(nl, -1);
    const d = offset(i);
    res = clipHalfPlane(res, add(a, mul(nIn, d)), add(b, mul(nIn, d)), orient);
  }
  return res.length >= 3 && area(res) > 1e-6 ? res : [];
}

/** Point dans un polygone (simple, convexe ou non). */
export function pointInPolygon(poly: Poly, p: Pt): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) {
      inside = !inside;
    }
  }
  return inside;
}

export function closestOnSegment(a: Pt, b: Pt, p: Pt): Pt {
  const ab = sub(b, a);
  const l2 = dot(ab, ab);
  if (l2 < EPS) return a;
  const t = Math.max(0, Math.min(1, dot(sub(p, a), ab) / l2));
  return add(a, mul(ab, t));
}

/** Point du contour du polygone le plus proche de p. */
export function closestOnBoundary(poly: Poly, p: Pt): Pt {
  let best = poly[0];
  let bd = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const c = closestOnSegment(poly[i], poly[(i + 1) % poly.length], p);
    const d = dist(c, p);
    if (d < bd) { bd = d; best = c; }
  }
  return best;
}

/**
 * Points où la droite infinie a→b traverse le contour d'un polygone convexe,
 * triés dans le sens a→b. Renvoie null si la droite ne le traverse pas.
 */
export function lineThroughPolygon(poly: Poly, a: Pt, b: Pt): [Pt, Pt] | null {
  const dir = sub(b, a);
  const pts: { p: Pt; t: number }[] = [];
  for (let i = 0; i < poly.length; i++) {
    const c = poly[i], d = poly[(i + 1) % poly.length];
    const sc = side(a, b, c), sd = side(a, b, d);
    if ((sc > 0 && sd > 0) || (sc < 0 && sd < 0)) continue;
    if (sc === 0 && sd === 0) continue;
    const p = sc === sd ? c : segLine(c, d, sc, sd);
    pts.push({ p, t: dot(sub(p, a), dir) });
  }
  if (pts.length < 2) return null;
  pts.sort((u, v) => u.t - v.t);
  const first = pts[0], last = pts[pts.length - 1];
  if (dist(first.p, last.p) < 1e-6) return null;
  return [first.p, last.p];
}

export function polyToPoints(poly: Poly): string {
  return poly.map((p) => `${round(p.x)},${round(p.y)}`).join(' ');
}

const round = (v: number) => Math.round(v * 1000) / 1000;
