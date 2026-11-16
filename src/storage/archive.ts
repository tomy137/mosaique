// Export / import d'un montage : .json seul, ou .zip avec les photos originales.
// Format du zip : montage.json + photos/<nom de fichier>. Les photos ne sont pas recompressées.

import { strFromU8, strToU8, unzip, Zip, ZipDeflate, ZipPassThrough } from 'fflate';
import { isImageName, type Library } from '../photos/library';
import { parseDoc } from './doc';
import type { Doc } from '../types';

export const ZIP_DOC = 'montage.json';
export const ZIP_PHOTOS = 'photos/';

export interface PhotoRef { name: string; w: number; h: number; size: number }

/** JSON exporté : le montage lui-même + de quoi vérifier les photos (relisible tel quel par parseDoc). */
export function montageJson(doc: Doc, lib: Library): string {
  const names = [...new Set(Object.values(doc.crops).map((c) => c.photo))].sort();
  const photos: PhotoRef[] = names.map((n) => {
    const p = lib.get(n);
    return { name: n, w: p?.w ?? 0, h: p?.h ?? 0, size: p?.file.size ?? 0 };
  });
  return JSON.stringify({ ...doc, app: 'mosaique', exportedAt: Date.now(), photos }, null, 1);
}

/** Zip du montage avec ses photos originales. Renvoie aussi les photos absentes (non incluses). */
export async function montageZip(
  doc: Doc, lib: Library, onProgress?: (done: number, total: number) => void,
): Promise<{ blob: Blob; missing: string[] }> {
  const chunks: Uint8Array[] = [];
  let fail: Error | null = null;
  let finished!: () => void;
  const done = new Promise<void>((r) => (finished = r));
  const zip = new Zip((err, data, final) => {
    if (err) { fail = err; finished(); return; }
    chunks.push(data);
    if (final) finished();
  });
  const json = new ZipDeflate(ZIP_DOC, { level: 6 });
  zip.add(json);
  json.push(strToU8(montageJson(doc, lib)), true);
  const names = [...new Set(Object.values(doc.crops).map((c) => c.photo))].sort();
  const missing: string[] = [];
  let i = 0;
  for (const n of names) {
    const p = lib.get(n);
    if (!p) { missing.push(n); continue; }
    const entry = new ZipPassThrough(ZIP_PHOTOS + n);
    zip.add(entry);
    entry.push(new Uint8Array(await p.file.arrayBuffer()), true);
    onProgress?.(++i, names.length);
  }
  zip.end();
  await done;
  if (fail) throw fail;
  return { blob: new Blob(chunks as BlobPart[], { type: 'application/zip' }), missing };
}

export interface Imported { doc: Doc; photos: File[] }

const MIME: Record<string, string> = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', avif: 'image/avif',
  gif: 'image/gif', bmp: 'image/bmp', tif: 'image/tiff', tiff: 'image/tiff',
};

export const isImportFile = (f: { name: string }) => /\.(json|zip)$/i.test(f.name);

/** Lit un montage exporté (.json ou .zip). */
export async function readImport(file: File): Promise<Imported> {
  if (/\.json$/i.test(file.name)) return { doc: parseDoc(await file.text()), photos: [] };
  const bytes = new Uint8Array(await file.arrayBuffer());
  const entries = await new Promise<Record<string, Uint8Array>>((res, rej) =>
    unzip(bytes, (err, data) => (err ? rej(err) : res(data))));
  const paths = Object.keys(entries).filter((p) => !p.startsWith('__MACOSX/') && !p.endsWith('/'));
  // montage.json à la racine du zip, ou dans un unique dossier englobant
  const docPath = paths.find((p) => p === ZIP_DOC) ?? paths.find((p) => p.endsWith(`/${ZIP_DOC}`))
    ?? paths.find((p) => /\.json$/i.test(p));
  if (!docPath) throw new Error('Aucun montage (montage.json) dans ce zip');
  const doc = parseDoc(strFromU8(entries[docPath]));
  const photos = paths
    .filter((p) => p !== docPath && isImageName(p))
    .map((p) => {
      const name = p.split('/').pop()!;
      const ext = name.split('.').pop()!.toLowerCase();
      return new File([entries[p] as BlobPart], name, { type: MIME[ext] ?? 'application/octet-stream' });
    });
  return { doc, photos };
}

/** Renomme les photos d'un montage importé (quand une photo de même nom mais différente existe déjà). */
export function remapPhotos(doc: Doc, renames: Map<string, string>): Doc {
  if (!renames.size) return doc;
  const crops = Object.fromEntries(Object.entries(doc.crops).map(([id, c]) => [id, { ...c, photo: renames.get(c.photo) ?? c.photo }]));
  return { ...doc, crops };
}
