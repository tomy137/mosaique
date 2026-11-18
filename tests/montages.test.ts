import { describe, expect, it } from 'vitest';
import { montageJson, montageZip, readImport, remapPhotos } from '../src/storage/archive';
import { nextDefaultName, safeFileBase, sameContent, uniqueFile, uniqueName, usageElsewhere, type Montage } from '../src/storage/montages';
import type { Library } from '../src/photos/library';
import { parseDoc } from '../src/storage/doc';
import type { Doc } from '../src/types';

const S = { widthMm: 600, heightMm: 400, dpi: 300, gutterMm: 4, marginMm: 6, bg: '#fff' };
const doc = (name: string, photos: string[]): Doc => ({
  version: 1, settings: S, root: { id: 'r' }, name,
  crops: Object.fromEntries(photos.map((p, i) => [`c${i}`, { photo: p, fx: 0.5, fy: 0.5, zoom: 1 }])),
});

describe('noms de montages', () => {
  it('nom de fichier sûr', () => {
    expect(safeFileBase('Noël 2026 / mamie : v2')).toBe('Noël 2026 - mamie - v2');
    expect(safeFileBase('...')).toBe('Montage');
  });

  it('fichier et nom uniques', () => {
    expect(uniqueFile('Noël', ['Noël.json', 'noël (2).json'])).toBe('Noël (3).json');
    expect(uniqueName('Noël (copie)', ['Noël (copie)'])).toBe('Noël (copie) (2)');
    expect(uniqueName('Album (2)', ['Album', 'Album (2)'])).toBe('Album (3)');
    expect(nextDefaultName([{ file: 'a.json', doc: doc('Montage 2', []) }])).toBe('Montage 3');
  });

  it('même contenu malgré un nom et des dates différents', () => {
    const a = doc('A', ['1.jpg']);
    expect(sameContent(a, { ...a, name: 'B', updatedAt: 5 })).toBe(true);
    expect(sameContent(a, doc('A', ['2.jpg']))).toBe(false);
  });

  it('repère les photos utilisées dans les autres montages', () => {
    const ms: Montage[] = [
      { file: 'a.json', doc: doc('Noël', ['1.jpg', '2.jpg']) },
      { file: 'b.json', doc: doc('Été', ['2.jpg', '3.jpg']) },
      { file: 'c.json', doc: doc('Mamie', ['2.jpg']) },
    ];
    const u = usageElsewhere(ms, 'a.json');
    expect(u.get('2.jpg')).toEqual(['Été', 'Mamie']);
    expect(u.has('1.jpg')).toBe(false);
    expect(u.get('3.jpg')).toEqual(['Été']);
  });
});

describe('export / import', () => {
  const bytes = (n: number, v: number) => new Uint8Array(n).fill(v);
  const fakeLib = {
    get: (name: string) => (name === 'absente.jpg' ? undefined : {
      name, w: 300, h: 200, url: '',
      file: new File([bytes(name === '1.jpg' ? 1000 : 2500, name.length)], name, { type: 'image/jpeg' }),
    }),
  } as unknown as Library;

  it('le json exporté se relit tel quel', () => {
    const d = doc('Noël', ['1.jpg']);
    const back = parseDoc(montageJson(d, fakeLib));
    expect(back.name).toBe('Noël');
    expect(back.crops).toEqual(d.crops);
  });

  it('aller-retour zip : montage + photos originales identiques', async () => {
    const d = doc('Noël', ['1.jpg', 'deux.jpg', 'absente.jpg']);
    const { blob, missing } = await montageZip(d, fakeLib);
    expect(missing).toEqual(['absente.jpg']);
    const imp = await readImport(new File([blob], 'Noël.mosaique.zip'));
    expect(imp.doc.name).toBe('Noël');
    expect(imp.doc.crops).toEqual(d.crops);
    expect(imp.photos.map((f) => f.name).sort()).toEqual(['1.jpg', 'deux.jpg']);
    const one = new Uint8Array(await imp.photos.find((f) => f.name === '1.jpg')!.arrayBuffer());
    expect(one.length).toBe(1000);
    expect(one.every((b) => b === '1.jpg'.length)).toBe(true);
  });

  it('import .json', async () => {
    const imp = await readImport(new File([montageJson(doc('Été', ['3.jpg']), fakeLib)], 'ete.mosaique.json'));
    expect(imp.doc.name).toBe('Été');
    expect(imp.photos).toEqual([]);
  });

  it('refuse un fichier qui n’est pas un montage', async () => {
    await expect(readImport(new File(['{"a":1}'], 'x.json'))).rejects.toThrow(/montage/);
  });

  it('renomme les photos importées en conflit', () => {
    const d = remapPhotos(doc('A', ['1.jpg', '2.jpg']), new Map([['1.jpg', '1 (import 2).jpg']]));
    expect(Object.values(d.crops).map((c) => c.photo)).toEqual(['1 (import 2).jpg', '2.jpg']);
  });
});
