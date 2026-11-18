import { describe, expect, it } from 'vitest';
import { computeCells } from '../src/geometry/bsp';
import { bbox } from '../src/geometry/polygon';
import { DEFAULT_SETTINGS } from '../src/storage/doc';
import type { BspNode } from '../src/types';

const root: BspNode = { id: 'r', cut: { p: { x: 300, y: 0 }, q: { x: 300, y: 400 } }, children: [{ id: 'r.0' }, { id: 'r.1' }] };

describe('fond perdu', () => {
  it('sans fond perdu : rien ne change', () => {
    const c = computeCells(root, { ...DEFAULT_SETTINGS, marginMm: 6 });
    const all = [...c.insets.values()].map(bbox);
    expect(Math.min(...all.map((b) => b.x))).toBeCloseTo(6);
  });

  it('marge à 0 : les cases vont jusqu’au bord du fond perdu', () => {
    const c = computeCells(root, { ...DEFAULT_SETTINGS, marginMm: 0, bleedMm: 3 });
    const all = [...c.insets.values()].map(bbox);
    expect(Math.min(...all.map((b) => b.x))).toBeCloseTo(-3);
    expect(Math.min(...all.map((b) => b.y))).toBeCloseTo(-3);
    expect(Math.max(...all.map((b) => b.x + b.w))).toBeCloseTo(603);
    expect(Math.max(...all.map((b) => b.y + b.h))).toBeCloseTo(403);
    expect(c.ok).toBe(true);
  });

  it('marge non nulle : mesurée depuis la ligne de coupe', () => {
    const c = computeCells(root, { ...DEFAULT_SETTINGS, marginMm: 8, bleedMm: 3 });
    const all = [...c.insets.values()].map(bbox);
    expect(Math.min(...all.map((b) => b.x))).toBeCloseTo(8);
    expect(Math.max(...all.map((b) => b.y + b.h))).toBeCloseTo(392);
    expect(c.ok).toBe(true);
  });
});
