// Album : un document à plusieurs pages, chacune avec sa mise en page, ses photos et ses textes.
// La page ouverte vit dans le document lui-même (root, crops, texts) : l'éditeur, la génération et l'export
// travaillent donc sur un Doc ordinaire. Les autres pages sont dans doc.album.pages.

import type { AlbumData, Doc, Page } from '../types';

export type AlbumDoc = Doc & { album: AlbumData };

export const isAlbum = (doc: Doc): doc is AlbumDoc => !!doc.album?.pages?.length;

export const blankPage = (): Page => ({ root: { id: 'r' }, crops: {}, texts: [] });

const livePage = (doc: Doc): Page => ({ root: doc.root, crops: doc.crops, texts: doc.texts ?? [] });

/** Toutes les pages, la page ouverte à jour (sans modifier le document). */
export function albumPages(doc: Doc): Page[] {
  if (!isAlbum(doc)) return [livePage(doc)];
  return doc.album.pages.map((p, i) => (i === doc.album.index ? livePage(doc) : p));
}

/** Recopie la page ouverte dans la liste des pages (avant d'écrire le document). */
export function syncAlbum<T extends Doc>(doc: T): T {
  if (isAlbum(doc)) doc.album.pages[doc.album.index] = livePage(doc);
  return doc;
}

/** Copie à écrire : la page ouverte recopiée dans la liste, sans modifier le document. */
export function forWrite(doc: Doc): Doc {
  return isAlbum(doc) ? { ...doc, album: { ...doc.album, pages: albumPages(doc) } } : doc;
}

export const pageCount =(doc: Doc) => (isAlbum(doc) ? doc.album.pages.length : 1);
export const pageIndex = (doc: Doc) => (isAlbum(doc) ? doc.album.index : 0);

/** Nom d'une page : la première est la couverture. */
export const pageLabel = (i: number) => (i === 0 ? 'Couverture' : `p. ${i}`);

/**
 * Doubles pages telles que l'album s'ouvre : la couverture seule, la page 1 seule à droite,
 * puis 2-3, 4-5… (la dernière page paire reste seule à gauche).
 */
export function spreads(n: number): number[][] {
  const out: number[][] = [];
  if (n > 0) out.push([0]);
  if (n > 1) out.push([1]);
  for (let i = 2; i < n; i += 2) out.push(i + 1 < n ? [i, i + 1] : [i]);
  return out;
}

export const spreadOf = (n: number, i: number) => spreads(n).find((s) => s.includes(i)) ?? [i];

/** Document d'une seule page (vignettes, export), avec les réglages communs de l'album. */
export function pageDoc(doc: Doc, i: number): Doc {
  const p = albumPages(doc)[i];
  return { version: 1, settings: doc.settings, root: p.root, crops: p.crops, texts: p.texts ?? [] };
}

function loadPage(doc: AlbumDoc, i: number) {
  const p = doc.album.pages[i];
  doc.album.index = i;
  doc.root = p.root;
  doc.crops = p.crops;
  doc.texts = p.texts ?? [];
}

/** Ouvre la page i dans le document (la page quittée est recopiée dans la liste). */
export function goToPage(doc: Doc, i: number) {
  if (!isAlbum(doc)) return;
  syncAlbum(doc);
  loadPage(doc, Math.max(0, Math.min(doc.album.pages.length - 1, i)));
}

/** Transforme un montage en album : il devient la couverture, suivie de pages vides. */
export function toAlbum(doc: Doc, nPages: number) {
  if (isAlbum(doc)) return;
  doc.texts ??= [];
  doc.album = { index: 0, pages: [livePage(doc), ...Array.from({ length: Math.max(0, nPages - 1) }, blankPage)] };
}

/** Insère une page (vide, ou une copie de celle donnée) à la position `at` et l'ouvre. */
export function insertPage(doc: Doc, at: number, page: Page = blankPage()) {
  if (!isAlbum(doc)) return;
  syncAlbum(doc);
  const pages = [...doc.album.pages];
  at = Math.max(0, Math.min(pages.length, at));
  pages.splice(at, 0, JSON.parse(JSON.stringify(page)));
  doc.album.pages = pages;
  loadPage(doc, at);
}

export function duplicatePage(doc: Doc, i: number) {
  insertPage(doc, i + 1, albumPages(doc)[i]);
}

/** Retire une page (jamais la dernière restante) et ouvre sa voisine. */
export function removePage(doc: Doc, i: number): boolean {
  if (!isAlbum(doc) || doc.album.pages.length < 2) return false;
  syncAlbum(doc);
  const open = doc.album.index;
  doc.album.pages = doc.album.pages.filter((_, k) => k !== i);
  const next = open === i ? Math.min(i, doc.album.pages.length - 1) : open > i ? open - 1 : open;
  loadPage(doc, next);
  return true;
}

/** Déplace la page `from` à la position `to` (la page ouverte reste ouverte). */
export function movePage(doc: Doc, from: number, to: number) {
  if (!isAlbum(doc)) return;
  syncAlbum(doc);
  const pages = [...doc.album.pages];
  to = Math.max(0, Math.min(pages.length - 1, to));
  if (from === to || !pages[from]) return;
  const openPage = pages[doc.album.index];
  const [p] = pages.splice(from, 1);
  pages.splice(to, 0, p);
  doc.album.pages = pages;
  loadPage(doc, pages.indexOf(openPage));
}

/**
 * Remplace la mise en page et les photos des pages `from`, `from + 1`… (les textes restent).
 * Les pages manquantes sont ajoutées. La page ouverte est rechargée.
 */
export function setPages(doc: Doc, from: number, layouts: Pick<Page, 'root' | 'crops'>[]) {
  if (!isAlbum(doc)) return;
  syncAlbum(doc);
  const pages = [...doc.album.pages];
  layouts.forEach((l, k) => {
    const i = from + k;
    pages[i] = { ...(pages[i] ?? blankPage()), root: l.root, crops: l.crops };
  });
  doc.album.pages = pages;
  loadPage(doc, doc.album.index);
}

/** Applique une transformation à toutes les pages (changement de format, orientation). */
export function forEachPage(doc: Doc, fn: (p: Page) => void) {
  fn(livePage(doc));
  if (isAlbum(doc)) doc.album.pages.forEach((p, i) => { if (i !== doc.album.index) fn(p); });
}

/** Photos de tout le document (toutes les pages d'un album). */
export function allPhotos(doc: Doc): Set<string> {
  const out = new Set<string>();
  for (const p of albumPages(doc)) for (const c of Object.values(p.crops)) out.add(c.photo);
  return out;
}

/** Pour chaque photo : les autres pages de l'album ouvert qui l'utilisent (« p. 4 »). */
export function usageInAlbum(doc: Doc): Map<string, string[]> {
  const out = new Map<string, string[]>();
  if (!isAlbum(doc)) return out;
  doc.album.pages.forEach((p, i) => {
    if (i === doc.album.index) return;
    for (const photo of new Set(Object.values(p.crops).map((c) => c.photo))) {
      out.set(photo, [...(out.get(photo) ?? []), pageLabel(i)]);
    }
  });
  return out;
}

/** Renomme des photos dans toutes les pages (import d'un .zip). */
export function mapPhotos(doc: Doc, fn: (photo: string) => string): Doc {
  const remap = (crops: Page['crops']) => Object.fromEntries(Object.entries(crops).map(([id, c]) => [id, { ...c, photo: fn(c.photo) }]));
  const out: Doc = { ...doc, crops: remap(doc.crops) };
  if (isAlbum(doc)) out.album = { ...doc.album, pages: doc.album.pages.map((p) => ({ ...p, crops: remap(p.crops) })) };
  return out;
}
