// Accès au dossier de photos (File System Access API de Chrome), avec un repli en lecture seule
// pour les autres navigateurs (<input webkitdirectory>) et les dossiers déposés.

import { isHeicName, isImageName } from '../photos/library';
import type { Doc } from '../types';
import { parseDoc } from './doc';

/* eslint-disable @typescript-eslint/no-explicit-any */
/** Poignée de dossier (FileSystemDirectoryHandle, avec les méthodes de permission propres à Chrome). */
export type DirHandle = any;

/** Ancien format : un seul montage à la racine du dossier (jamais modifié, repris comme premier montage). */
export const LEGACY_FILE = 'montage.json';

export const hasFsAccess = () => typeof (window as any).showDirectoryPicker === 'function';

export async function pickFolder(): Promise<DirHandle> {
  return (window as any).showDirectoryPicker({ id: 'mosaique', mode: 'readwrite' });
}

export async function ensurePermission(handle: DirHandle): Promise<boolean> {
  const opts = { mode: 'readwrite' };
  if ((await handle.queryPermission(opts)) === 'granted') return true;
  return (await handle.requestPermission(opts)) === 'granted';
}

export interface FolderContent { images: File[]; heic: string[]; doc: Doc | null }

const baseName = (n: string) => n.replace(/\.[^.]+$/, '').toLowerCase();

/** HEIC restant à convertir : ceux qui n'ont pas déjà une image du même nom (IMG_1234.HEIC → IMG_1234.jpg). */
export function pendingHeic(heic: string[], images: { name: string }[]): string[] {
  const done = new Set(images.map((f) => baseName(f.name)));
  return heic.filter((h) => !done.has(baseName(h)));
}

/** Trie les fichiers d'un dossier : photos lisibles, HEIC à convertir, ancien montage.json. */
async function classify(files: { name: string; get: () => Promise<File> }[]): Promise<FolderContent> {
  const images: File[] = [];
  const heic: string[] = [];
  let doc: Doc | null = null;
  for (const f of files) {
    if (f.name === LEGACY_FILE) {
      try { doc = parseDoc(await (await f.get()).text()); } catch { /* ignoré */ }
    } else if (isImageName(f.name)) images.push(await f.get());
    else if (isHeicName(f.name)) heic.push(f.name);
  }
  return { images, heic: pendingHeic(heic, images), doc };
}

/** Contenu d'un dossier ouvert avec la File System Access API (premier niveau seulement). */
export async function readFolder(handle: DirHandle): Promise<FolderContent> {
  const files: { name: string; get: () => Promise<File> }[] = [];
  for await (const entry of handle.values()) {
    if (entry.kind === 'file') files.push({ name: entry.name, get: () => entry.getFile() });
  }
  return classify(files);
}

/** Mode repli : fichiers d'un <input webkitdirectory> ou d'un dossier déposé, premier niveau seulement. */
export async function readFileList(files: File[]): Promise<FolderContent> {
  return classify(files
    .filter((f) => f.webkitRelativePath.split('/').length <= 2) // sous-dossiers ignorés, comme en mode Chrome
    .map((f) => ({ name: f.name, get: async () => f })));
}

/** Fichiers (premier niveau) d'un dossier déposé, via l'API d'entrées (lecture seule). */
export function readEntryFiles(dir: FileSystemDirectoryEntry): Promise<File[]> {
  return new Promise((resolve, reject) => {
    const reader = dir.createReader();
    const entries: FileSystemEntry[] = [];
    const next = () => reader.readEntries((batch) => {
      if (batch.length) { entries.push(...batch); next(); return; }
      const files = entries.filter((e) => e.isFile).map((e) =>
        new Promise<File>((res, rej) => (e as FileSystemFileEntry).file(res, rej)));
      Promise.all(files).then(resolve, reject);
    }, reject);
    next();
  });
}

export async function writeFile(handle: DirHandle, name: string, data: Blob | string): Promise<void> {
  const fh = await handle.getFileHandle(name, { create: true });
  const w = await fh.createWritable();
  await w.write(data);
  await w.close();
}

export async function fileExists(handle: DirHandle | null, name: string): Promise<boolean> {
  if (!handle) return false;
  try { await handle.getFileHandle(name); return true; } catch { return false; }
}
