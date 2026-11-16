import { describe, expect, it } from 'vitest';
import { computeCells, getLine, isValid, leafIds, pinwheelRegions, removeCut, rootPoly, scaleTree, setLine } from '../src/geometry/bsp';
import { area, bbox, side } from '../src/geometry/polygon';
import { generate, placeholderAspects, type LayoutMode } from '../src/layout/generate';
import type { BspNode, Cut, Settings } from '../src/types';

const S: Settings = { widthMm: 600, heightMm: 400, dpi: 300, gutterMm: 4, marginMm: 6, bg: '#fff' };

/** Plus grande proportion de la page traversée par une coupe visible (1 = d'un bord à l'autre). */
function longestCrossing(root: BspNode, s: Settings): number {
  return Math.max(...computeCells(root, s).cuts.map(({ seg: [a, b] }) =>
    Math.max(Math.abs(b.x - a.x) / s.widthMm, Math.abs(b.y - a.y) / s.heightMm)));
}

describe('moulinet : géométrie', () => {
  // A en haut à gauche, B à droite, C en bas, D à gauche, centre ; droites orientées vers leur bloc
  const owned = (p: Cut['p'], q: Cut['q'], o: Cut['p']): Cut => (side(p, q, o) > 0 ? { p, q } : { p: q, q: p });
  const pin: Cut[] = [
    owned({ x: 0, y: 150 }, { x: 400, y: 150 }, { x: 100, y: 50 }),
    owned({ x: 400, y: 0 }, { x: 400, y: 260 }, { x: 500, y: 100 }),
    owned({ x: 600, y: 260 }, { x: 200, y: 260 }, { x: 400, y: 330 }),
    owned({ x: 200, y: 400 }, { x: 200, y: 150 }, { x: 100, y: 300 }),
  ];

  it('les cinq zones couvrent exactement la page, sans chevauchement', () => {
    const regions = pinwheelRegions(rootPoly(600, 400), pin);
    expect(regions.map((r) => Math.round(area(r)))).toEqual([400 * 150, 200 * 260, 400 * 140, 200 * 250, 200 * 110]);
    expect(regions.reduce((s, r) => s + area(r), 0)).toBeCloseTo(600 * 400);
  });

  it('aucun trait ne traverse la page, et chacun se déplace en gardant les cases valides', () => {
    const root: BspNode = { id: 'r', pin: pin.map((c) => ({ ...c })), children: [0, 1, 2, 3, 4].map((i) => ({ id: `r.${i}` })) };
    const cells = computeCells(root, S);
    expect(isValid(cells, S)).toBe(true);
    expect(cells.cuts.map((c) => c.id)).toEqual(['r#0', 'r#1', 'r#2', 'r#3']);
    expect(longestCrossing(root, S)).toBeLessThan(0.7);
    // déplacer le trait du haut : le bloc A rétrécit, le centre grandit
    const l0 = getLine(root, 'r#0')!;
    setLine(root, 'r#0', { p: { ...l0.p, y: 120 }, q: { ...l0.q, y: 120 } });
    const moved = computeCells(root, S);
    expect(bbox(moved.leaves.get('r.0')!).h).toBeCloseTo(120);
    expect(bbox(moved.leaves.get('r.4')!).h).toBeCloseTo(140);
    // redimensionner la page suit aussi les traits du moulinet
    scaleTree(root, 0.5, 0.5);
    expect(isValid(computeCells(root, { ...S, widthMm: 300, heightMm: 200 }), { ...S, widthMm: 300, heightMm: 200 })).toBe(true);
    // supprimer un trait supprime tout le moulinet
    expect(removeCut(root, 'r#2').sort()).toEqual(['r.0', 'r.1', 'r.2', 'r.3', 'r.4']);
    expect(leafIds(root)).toEqual(['r']);
  });
});

describe('moulinet : génération', () => {
  const gen = (n: number, seed: number, mode: LayoutMode, obliquityDeg = 0) =>
    generate({ aspects: placeholderAspects(n, seed), settings: S, seed, obliquityDeg, obliqueShare: obliquityDeg ? 0.5 : 0, mode });

  it('en classique, une coupe traverse toujours la page ; en moulinet, jamais', () => {
    for (const seed of [1, 2, 3]) {
      expect(longestCrossing(gen(24, seed, 'classic').root, S)).toBeGreaterThan(0.99);
      expect(longestCrossing(gen(24, seed, 'pinwheel').root, S)).toBeLessThan(0.85);
    }
  });

  it('une case par photo, valide, tailles et ratios respectés', () => {
    for (const [n, seed] of [[12, 4], [30, 5], [60, 6]]) {
      const aspects = placeholderAspects(n, seed);
      const { root, cellOf } = generate({ aspects, settings: S, seed, obliquityDeg: 0, obliqueShare: 0, mode: 'pinwheel' });
      expect(root.pin).toBeDefined();
      const cells = computeCells(root, S);
      expect(isValid(cells, S)).toBe(true);
      expect(cells.leaves.size).toBe(n);
      expect(new Set(cellOf).size).toBe(n);
      const mean = (S.widthMm * S.heightMm) / n;
      expect(Math.min(...[...cells.leaves.values()].map(area)) / mean).toBeGreaterThan(0.3);
      const close = cellOf.filter((id, i) => {
        const b = bbox(cells.leaves.get(id)!);
        return Math.abs(Math.log(b.w / b.h / aspects[i])) < 0.35;
      }).length;
      expect(close / n).toBeGreaterThan(0.7);
    }
  });

  it('avec des coupes obliques, reste valide', () => {
    for (const seed of [7, 8, 9]) expect(isValid(computeCells(gen(30, seed, 'pinwheel', 10).root, S), S)).toBe(true);
  });

  it('moins de 5 photos : retombe sur la disposition classique', () => {
    expect(gen(4, 1, 'pinwheel').root.pin).toBeUndefined();
  });
});
