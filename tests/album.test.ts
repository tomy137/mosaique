import { describe, expect, it } from 'vitest';
import {
  albumPages, allPhotos, duplicatePage, forEachPage, forWrite, goToPage, insertPage, isAlbum, mapPhotos, movePage,
  pageCount, removePage, spreadOf, spreads, toAlbum, usageInAlbum,
} from '../src/storage/album';
import { newDoc, parseDoc } from '../src/storage/doc';
import { sameContent } from '../src/storage/montages';
import type { Doc } from '../src/types';

const crop = (photo: string) => ({ photo, fx: 0.5, fy: 0.5, zoom: 1 });
const split = (doc: Doc, a: string, b: string) => {
  doc.root = { id: 'r', cut: { p: { x: 300, y: 0 }, q: { x: 300, y: 400 } }, children: [{ id: 'r.0' }, { id: 'r.1' }] };
  doc.crops = { 'r.0': crop(a), 'r.1': crop(b) };
};

function album(n = 4): Doc {
  const d = newDoc();
  split(d, 'cover-a.jpg', 'cover-b.jpg');
  toAlbum(d, n);
  return d;
}

describe('album', () => {
  it('un montage devient la couverture d’un album', () => {
    const d = album(4);
    expect(isAlbum(d)).toBe(true);
    expect(pageCount(d)).toBe(4);
    expect(Object.keys(albumPages(d)[0].crops)).toEqual(['r.0', 'r.1']);
    expect(albumPages(d)[1].root).toEqual({ id: 'r' });
  });

  it('changer de page garde les modifications de la page quittée', () => {
    const d = album(3);
    goToPage(d, 1);
    expect(d.crops).toEqual({});
    d.crops['r'] = crop('p1.jpg');
    goToPage(d, 2);
    goToPage(d, 1);
    expect(d.crops['r'].photo).toBe('p1.jpg');
    goToPage(d, 0);
    expect(d.crops['r.0'].photo).toBe('cover-a.jpg');
  });

  it('les photos et l’usage couvrent toutes les pages', () => {
    const d = album(3);
    goToPage(d, 2);
    d.crops['r'] = crop('cover-a.jpg');
    expect([...allPhotos(d)].sort()).toEqual(['cover-a.jpg', 'cover-b.jpg']);
    const u = usageInAlbum(d);
    expect(u.get('cover-a.jpg')).toEqual(['Couverture']);
    expect(u.get('cover-b.jpg')).toEqual(['Couverture']);
    goToPage(d, 0);
    expect(usageInAlbum(d).get('cover-a.jpg')).toEqual(['p. 2']);
    expect(usageInAlbum(d).has('cover-b.jpg')).toBe(false);
  });

  it('ajouter, dupliquer, déplacer et retirer des pages', () => {
    const d = album(2);
    goToPage(d, 1);
    d.crops['r'] = crop('x.jpg');
    duplicatePage(d, 1);
    expect(pageCount(d)).toBe(3);
    expect(d.album!.index).toBe(2);
    expect(d.crops['r'].photo).toBe('x.jpg');
    d.crops['r'] = crop('y.jpg'); // la copie est indépendante
    expect(albumPages(d)[1].crops['r'].photo).toBe('x.jpg');
    insertPage(d, 0);
    expect(d.album!.index).toBe(0);
    expect(albumPages(d)[3].crops['r'].photo).toBe('y.jpg');
    goToPage(d, 3);
    movePage(d, 3, 1);
    expect(d.album!.index).toBe(1);
    expect(d.crops['r'].photo).toBe('y.jpg');
    expect(removePage(d, 1)).toBe(true);
    expect(pageCount(d)).toBe(3);
    expect(albumPages(d).map((p) => p.crops['r']?.photo ?? Object.keys(p.crops).length)).toEqual([0, 2, 'x.jpg']);
    while (pageCount(d) > 1) removePage(d, 0);
    expect(removePage(d, 0)).toBe(false);
  });

  it('écrit puis relit un album sans rien perdre (page ouverte comprise)', () => {
    const d = album(3);
    goToPage(d, 2);
    d.crops['r'] = crop('z.jpg');
    const back = parseDoc(JSON.stringify(forWrite(d)));
    expect(back.album!.index).toBe(2);
    expect(back.album!.pages[2].crops['r'].photo).toBe('z.jpg');
    expect(back.crops['r'].photo).toBe('z.jpg');
    expect(sameContent(back, d)).toBe(true);
    goToPage(back, 0);
    expect(sameContent(back, d)).toBe(true); // changer de page ne modifie pas le contenu
    back.crops['r.0'] = crop('autre.jpg');
    expect(sameContent(back, d)).toBe(false);
  });

  it('un montage simple reste lisible et comparable', () => {
    const d = newDoc();
    split(d, 'a.jpg', 'b.jpg');
    const back = parseDoc(JSON.stringify(forWrite(d)));
    expect(isAlbum(back)).toBe(false);
    expect(sameContent(back, d)).toBe(true);
  });

  it('renomme les photos de toutes les pages', () => {
    const d = album(2);
    goToPage(d, 1);
    d.crops['r'] = crop('cover-a.jpg');
    const out = mapPhotos(d, (p) => (p === 'cover-a.jpg' ? 'renamed.jpg' : p));
    expect([...allPhotos(out)].sort()).toEqual(['cover-b.jpg', 'renamed.jpg']);
  });

  it('transformation de toutes les pages', () => {
    const d = album(3);
    let n = 0;
    forEachPage(d, () => n++);
    expect(n).toBe(3);
  });

  it('doubles pages : couverture seule, page 1 à droite, puis par deux', () => {
    expect(spreads(1)).toEqual([[0]]);
    expect(spreads(6)).toEqual([[0], [1], [2, 3], [4, 5]]);
    expect(spreads(5)).toEqual([[0], [1], [2, 3], [4]]);
    expect(spreadOf(6, 3)).toEqual([2, 3]);
  });
});
