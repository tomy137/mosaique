import { describe, expect, it } from 'vitest';
import { area, bbox, insetConvex, lineThroughPolygon, splitByLine, type Poly } from '../src/geometry/polygon';
import { computeCells, isValid, leafIds, removeCut, scaleTree, splitLeaf } from '../src/geometry/bsp';
import { generate, placeholderAspects } from '../src/layout/generate';
import { clampCrop, effectiveDpi, panCrop, placement, zoomCrop } from '../src/photos/crop';
import type { BspNode, Settings } from '../src/types';

const S: Settings = { widthMm: 600, heightMm: 400, dpi: 300, gutterMm: 4, marginMm: 6, bg: '#fff' };
const square: Poly = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }];

describe('polygones', () => {
  it('coupe un carré en deux par une verticale, enfant 0 à gauche (sens haut→bas)', () => {
    const [a, b] = splitByLine(square, { x: 4, y: 0 }, { x: 4, y: 10 });
    expect(area(a)).toBeCloseTo(40);
    expect(area(b)).toBeCloseTo(60);
    expect(bbox(a).x + bbox(a).w).toBeCloseTo(4);
  });

  it('coupe en diagonale en deux triangles', () => {
    const [a, b] = splitByLine(square, { x: 0, y: 0 }, { x: 10, y: 10 });
    expect(a.length).toBe(3);
    expect(b.length).toBe(3);
    expect(area(a) + area(b)).toBeCloseTo(100);
  });

  it('rétrécit un carré de manière uniforme', () => {
    const r = insetConvex(square, () => 1);
    expect(area(r)).toBeCloseTo(64);
  });

  it('rétrécissement trop fort → polygone vide', () => {
    expect(insetConvex(square, () => 6)).toEqual([]);
  });

  it('trouve les extrémités visibles d’une droite', () => {
    const seg = lineThroughPolygon(square, { x: 5, y: -100 }, { x: 5, y: 100 })!;
    expect(seg[0].y).toBeCloseTo(0);
    expect(seg[1].y).toBeCloseTo(10);
  });
});

describe('arbre de coupes', () => {
  const build = (): BspNode => {
    const root: BspNode = { id: 'r' };
    splitLeaf(root, 'r', { p: { x: 300, y: 0 }, q: { x: 300, y: 400 } }); // gauche r.0 / droite r.1
    splitLeaf(root, 'r.0', { p: { x: 300, y: 200 }, q: { x: 0, y: 200 } }); // haut r.0.0 / bas r.0.1
    return root;
  };

  it('calcule les cases avec la gouttière et la marge', () => {
    const cells = computeCells(build(), S);
    expect([...cells.leaves.keys()].sort()).toEqual(['r.0.0', 'r.0.1', 'r.1']);
    const tl = bbox(cells.insets.get('r.0.0')!);
    expect(tl.x).toBeCloseTo(6); // marge
    expect(tl.y).toBeCloseTo(6);
    expect(tl.x + tl.w).toBeCloseTo(298); // demi-gouttière
    expect(tl.y + tl.h).toBeCloseTo(198);
    expect(isValid(cells, S)).toBe(true);
  });

  it('les identifiants restent stables quand on déplace une coupe, et la jonction en T suit', () => {
    const root = build();
    root.cut = { p: { x: 350, y: 0 }, q: { x: 330, y: 400 } };
    const cells = computeCells(root, S);
    expect(leafIds(root)).toEqual(['r.0.0', 'r.0.1', 'r.1']);
    const top = bbox(cells.leaves.get('r.0.0')!);
    expect(top.x + top.w).toBeCloseTo(350); // la coupe horizontale s'est allongée jusqu'à la nouvelle frontière
    expect(isValid(cells, S)).toBe(true);
  });

  it('refuse une coupe qui écrase une case', () => {
    const root = build();
    root.cut = { p: { x: 1, y: 0 }, q: { x: 1, y: 400 } };
    expect(isValid(computeCells(root, S), S)).toBe(false);
  });

  it('supprime une coupe et fusionne les cases', () => {
    const root = build();
    expect(removeCut(root, 'r.0').sort()).toEqual(['r.0.0', 'r.0.1']);
    expect(leafIds(root)).toEqual(['r.0', 'r.1']);
  });

  it('suit un changement de format', () => {
    const root = build();
    scaleTree(root, 0.5, 0.5);
    const cells = computeCells(root, { ...S, widthMm: 300, heightMm: 200 });
    expect(bbox(cells.leaves.get('r.1')!).x).toBeCloseTo(150);
  });
});

describe('génération', () => {
  it('produit une case par photo, toutes valides, ratios proches', () => {
    const aspects = placeholderAspects(30, 1);
    const { root, cellOf } = generate({ aspects, settings: S, seed: 7, obliquityDeg: 0, obliqueShare: 0 });
    const cells = computeCells(root, S);
    expect(cells.leaves.size).toBe(30);
    expect(new Set(cellOf).size).toBe(30);
    expect(isValid(cells, S)).toBe(true);
    // la plupart des cases ont un ratio proche de celui de leur photo
    let close = 0;
    cellOf.forEach((id, i) => {
      const b = bbox(cells.leaves.get(id)!);
      if (Math.abs(Math.log(b.w / b.h / aspects[i])) < 0.25) close++;
    });
    expect(close).toBeGreaterThanOrEqual(24);
  });

  it('les coupes obliques restent valides', () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const { root } = generate({ aspects: placeholderAspects(25, seed), settings: S, seed, obliquityDeg: 12, obliqueShare: 0.5 });
      expect(isValid(computeCells(root, S), S)).toBe(true);
    }
  });
});

describe('cadrage', () => {
  const bb = { x: 0, y: 0, w: 100, h: 50 };
  const crop = { photo: 'a.jpg', fx: 0.5, fy: 0.5, zoom: 1 };

  it('couvre la case (cover)', () => {
    const p = placement(bb, 1000, 1000, crop);
    expect(p.w).toBeCloseTo(100);
    expect(p.y).toBeCloseTo(-25);
  });

  it('ne laisse jamais de vide en déplaçant', () => {
    const c = panCrop(bb, 1000, 1000, crop, 0, 500);
    const p = placement(bb, 1000, 1000, c);
    expect(p.y).toBeCloseTo(0);
  });

  it('zoome autour du curseur et calcule la résolution effective', () => {
    const z = zoomCrop(bb, 2000, 1000, crop, 2, { x: 50, y: 25 });
    expect(z.zoom).toBeCloseTo(2);
    expect(z.fx).toBeCloseTo(0.5);
    expect(effectiveDpi(bb, 2000, 1000, clampCrop(bb, 2000, 1000, z))).toBeCloseTo((25.4 * 2000) / 200);
  });
});
