import { describe, expect, it } from 'vitest';
import { computeCells, isValid, leafIds } from '../src/geometry/bsp';
import { mergeAt } from '../src/layout/edit';
import { generate, placeholderAspects } from '../src/layout/generate';
import type { BspNode, Doc, Settings } from '../src/types';

const S: Settings = { widthMm: 600, heightMm: 400, dpi: 300, gutterMm: 4, marginMm: 6, bg: '#fff' };
const crop = (photo: string) => ({ photo, fx: 0.5, fy: 0.5, zoom: 1 });
const V = (x: number) => ({ p: { x, y: 0 }, q: { x, y: 400 } }); // enfant 0 à gauche
const H = (y: number) => ({ p: { x: 600, y }, q: { x: 0, y } }); // enfant 0 en haut

/**
 * Situation de la vidéo : en haut une case ; en bas, à gauche la photo du bébé, puis une case vide,
 * la photo du mariage et une autre photo.
 */
function videoDoc(): Doc {
  const root: BspNode = {
    id: 'r', cut: H(200), children: [
      { id: 'r.0' },
      {
        id: 'r.1', cut: V(150), children: [
          { id: 'r.1.0' }, // bébé
          {
            id: 'r.1.1', cut: V(300), children: [
              { id: 'r.1.1.0' }, // case vide
              { id: 'r.1.1.1', cut: V(450), children: [{ id: 'r.1.1.1.0' }, { id: 'r.1.1.1.1' }] },
            ],
          },
        ],
      },
    ],
  };
  return {
    version: 1, settings: S, root,
    crops: { 'r.0': crop('haut.jpg'), 'r.1.0': crop('bebe.jpg'), 'r.1.1.1.0': crop('mariage.jpg'), 'r.1.1.1.1': crop('autre.jpg') },
  };
}

describe('supprimer une coupe', () => {
  it('cas de la vidéo : seules la case du bébé et la case vide fusionnent', () => {
    const doc = videoDoc();
    const res = mergeAt(doc, 'r.1', computeCells(doc.root, S));
    expect(res.ok).toBe(true);
    expect(res.dropped).toEqual([]);
    const cells = computeCells(doc.root, S);
    expect(isValid(cells, S)).toBe(true);
    expect(leafIds(doc.root)).toHaveLength(4); // une case de moins, pas tout le bloc
    // la photo du bébé arrive dans la case vide agrandie, les autres photos ne bougent pas
    const where = (photo: string) => Object.entries(doc.crops).find(([, c]) => c.photo === photo)?.[0];
    expect(Object.values(doc.crops).map((c) => c.photo).sort()).toEqual(['autre.jpg', 'bebe.jpg', 'haut.jpg', 'mariage.jpg']);
    expect(res.cellId).toBe(where('bebe.jpg'));
    const big = cells.leaves.get(where('bebe.jpg')!)!;
    expect(Math.min(...big.map((p) => p.x))).toBeCloseTo(0);
    expect(Math.max(...big.map((p) => p.x))).toBeCloseTo(300);
    const wedding = cells.leaves.get(where('mariage.jpg')!)!;
    expect(Math.min(...wedding.map((p) => p.x))).toBeCloseTo(300);
  });

  it('deux cases simples : une seule case, avec la photo de la plus grande', () => {
    const doc: Doc = {
      version: 1, settings: S, root: { id: 'r', cut: V(200), children: [{ id: 'r.0' }, { id: 'r.1' }] },
      crops: { 'r.0': crop('petite.jpg'), 'r.1': crop('grande.jpg') },
    };
    const res = mergeAt(doc, 'r', computeCells(doc.root, S));
    expect(res.ok).toBe(true);
    expect(leafIds(doc.root)).toEqual(['r']);
    expect(doc.crops.r.photo).toBe('grande.jpg');
  });

  it('la case agrandie avait déjà une photo : celle de la case absorbée sort du montage', () => {
    const doc = videoDoc();
    doc.crops['r.1.1.0'] = crop('pleine.jpg');
    const res = mergeAt(doc, 'r.1', computeCells(doc.root, S));
    expect(res.ok).toBe(true);
    expect(res.dropped).toEqual(['bebe.jpg']);
    expect(Object.values(doc.crops).some((c) => c.photo === 'pleine.jpg')).toBe(true);
  });

  it('sur des montages générés, supprimer n’importe quelle coupe garde une mise en page valide et ne perd aucune photo en silence', () => {
    for (const [mode, seed] of [['classic', 1], ['classic', 2], ['pinwheel', 3], ['pinwheel', 4]] as const) {
      const aspects = placeholderAspects(20, seed);
      const { root, cellOf } = generate({ aspects, settings: S, seed, obliquityDeg: 10, obliqueShare: 0.5, mode });
      const base: Doc = { version: 1, settings: S, root, crops: Object.fromEntries(cellOf.map((id, i) => [id, crop(`p${i}.jpg`)])) };
      for (const c of computeCells(root, S).cuts) {
        const doc: Doc = JSON.parse(JSON.stringify(base));
        const res = mergeAt(doc, c.id, computeCells(doc.root, S));
        if (!res.ok) { expect(JSON.stringify(doc)).toBe(JSON.stringify(base)); continue; } // refus : rien ne change
        expect(isValid(computeCells(doc.root, S), S)).toBe(true);
        expect(leafIds(doc.root).length).toBeLessThan(20);
        expect(Object.keys(doc.crops).length + res.dropped.length).toBe(20);
        for (const id of Object.keys(doc.crops)) expect(leafIds(doc.root)).toContain(id);
      }
    }
  });

  it('moulinet : refusé si les blocs sont découpés, fusion si ce sont des cases simples', () => {
    const pin = [
      { p: { x: 0, y: 150 }, q: { x: 400, y: 150 } }, { p: { x: 400, y: 0 }, q: { x: 400, y: 260 } },
      { p: { x: 600, y: 260 }, q: { x: 200, y: 260 } }, { p: { x: 200, y: 400 }, q: { x: 200, y: 150 } },
    ];
    const blocks = [0, 1, 2, 3, 4].map((i) => ({ id: `r.${i}` } as BspNode));
    blocks[0] = { id: 'r.0', cut: V(100), children: [{ id: 'r.0.0' }, { id: 'r.0.1' }] };
    const doc: Doc = { version: 1, settings: S, root: { id: 'r', pin, children: blocks }, crops: {} };
    const refused = mergeAt(doc, 'r#2', computeCells(doc.root, S));
    expect(refused.ok).toBe(false);
    expect(leafIds(doc.root)).toHaveLength(6);
    doc.root.children![0] = { id: 'r.0' };
    expect(mergeAt(doc, 'r#2', computeCells(doc.root, S)).ok).toBe(true);
    expect(leafIds(doc.root)).toEqual(['r']);
  });
});
