// Document d'un montage : valeurs par défaut et lecture sûre d'un fichier JSON.

import type { Doc, Page, Settings } from '../types';

export const DEFAULT_SETTINGS: Settings = {
  widthMm: 600,
  heightMm: 400,
  dpi: 300,
  gutterMm: 4,
  marginMm: 6,
  bg: '#ffffff',
};

export const newDoc = (settings: Settings = DEFAULT_SETTINGS): Doc => ({
  version: 1,
  settings: { ...settings },
  root: { id: 'r' },
  crops: {},
});

/** Lit un montage (fichier du dossier, copie de secours, export). Refuse ce qui n'en est pas un. */
export function parseDoc(text: string): Doc {
  const d = JSON.parse(text);
  if (d?.version !== 1 || !d.root || !d.settings) throw new Error('Ce fichier n’est pas un montage Mosaïque');
  const doc: Doc = { version: 1, settings: { ...DEFAULT_SETTINGS, ...d.settings }, root: d.root, crops: d.crops ?? {} };
  if (Array.isArray(d.texts)) doc.texts = d.texts;
  if (Array.isArray(d.album?.pages) && d.album.pages.length) {
    const pages = d.album.pages.filter((p: Partial<Page>) => p?.root);
    if (!pages.length) throw new Error('Album sans page lisible');
    const index = Math.max(0, Math.min(pages.length - 1, Number(d.album.index) || 0));
    doc.album = { index, pages: pages.map((p: Page) => ({ root: p.root, crops: p.crops ?? {}, texts: p.texts ?? [] })) };
  }
  if (typeof d.name === 'string') doc.name = d.name;
  if (typeof d.createdAt === 'number') doc.createdAt = d.createdAt;
  if (typeof d.updatedAt === 'number') doc.updatedAt = d.updatedAt;
  return doc;
}
