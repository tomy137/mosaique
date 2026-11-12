// Persistance : dossier de projet (File System Access API) contenant les photos et montage.json,
// copie de secours dans le navigateur, et tailles préférées.

import type { Doc, FormatPreset, Settings } from './types';
import { isHeicName, isImageName } from './photos/library';

export const PROJECT_FILE = 'montage.json';

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

export function parseDoc(text: string): Doc {
  const d = JSON.parse(text);
  if (d?.version !== 1 || !d.root || !d.settings) throw new Error('Fichier montage.json invalide');
  return { version: 1, settings: { ...DEFAULT_SETTINGS, ...d.settings }, root: d.root, crops: d.crops ?? {} };
}

// ---------- stockage navigateur (toujours protégé : peut être indisponible) ----------

const LS_DOC = 'mosaique.doc';
const LS_PRESETS = 'mosaique.presets';
const SS_CURRENT = 'mosaique.current';

/** Copie de secours, une par projet (projet = nom du dossier ; '' = montage hors dossier). */
const docKey = (project: string) => (project ? `${LS_DOC}:${project}` : LS_DOC);

export function saveLocal(doc: Doc, project = ''): void {
  try { localStorage.setItem(docKey(project), JSON.stringify(doc)); } catch { /* stockage indisponible */ }
}

export function loadLocal(project = ''): Doc | null {
  try {
    const t = localStorage.getItem(docKey(project));
    return t ? parseDoc(t) : null;
  } catch { return null; }
}

/** Projet ouvert dans cet onglet (chaque onglet peut avoir le sien). */
export function currentProject(): string {
  try { return sessionStorage.getItem(SS_CURRENT) ?? ''; } catch { return ''; }
}

export function setCurrentProject(name: string): void {
  try { sessionStorage.setItem(SS_CURRENT, name); } catch { /* ignore */ }
}

// ---------- tailles préférées ----------

export const DEFAULT_PRESETS: FormatPreset[] = [
  { name: 'Poster 60 × 40', widthMm: 600, heightMm: 400, dpi: 300 },
  { name: 'Tirage 45 × 30', widthMm: 450, heightMm: 300, dpi: 300 },
  { name: 'Tirage 30 × 20', widthMm: 300, heightMm: 200, dpi: 300 },
];

export function loadPresets(): FormatPreset[] {
  try {
    const t = localStorage.getItem(LS_PRESETS);
    if (t) {
      const arr = JSON.parse(t);
      if (Array.isArray(arr)) return arr;
    }
  } catch { /* ignore */ }
  return DEFAULT_PRESETS.slice();
}

export function savePresets(list: FormatPreset[]): void {
  try { localStorage.setItem(LS_PRESETS, JSON.stringify(list)); } catch { /* ignore */ }
}

// ---------- dossier de projet ----------

/* eslint-disable @typescript-eslint/no-explicit-any */
type DirHandle = any;

export const hasFsAccess = () => typeof (window as any).showDirectoryPicker === 'function';

const IDB_NAME = 'mosaique';
const IDB_STORE = 'handles';

function idb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(IDB_STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export interface RecentProject { name: string; handle: DirHandle; opened: number }

const RECENT_PREFIX = 'p:';
const RECENT_MAX = 12;

async function idbAll(): Promise<{ key: string; value: any }[]> {
  const db = await idb();
  return new Promise((res) => {
    const out: { key: string; value: any }[] = [];
    const req = db.transaction(IDB_STORE).objectStore(IDB_STORE).openCursor();
    req.onsuccess = () => {
      const c = req.result;
      if (!c) { res(out); return; }
      out.push({ key: String(c.key), value: c.value });
      c.continue();
    };
    req.onerror = () => res(out);
  });
}

async function idbWrite(fn: (store: IDBObjectStore) => void): Promise<void> {
  const db = await idb();
  await new Promise<void>((res, rej) => {
    const tx = db.transaction(IDB_STORE, 'readwrite');
    fn(tx.objectStore(IDB_STORE));
    tx.oncomplete = () => res();
    tx.onerror = () => rej(tx.error);
  });
}

/** Projets récents, du plus récent au plus ancien. */
export async function listRecent(): Promise<RecentProject[]> {
  try {
    const all = await idbAll();
    const legacy = all.find((e) => e.key === 'last');
    if (legacy?.value?.name) {
      // ancienne version : un seul dossier mémorisé
      await idbWrite((s) => {
        s.put({ handle: legacy.value, opened: 0 }, RECENT_PREFIX + legacy.value.name);
        s.delete('last');
      });
      return listRecent();
    }
    return all
      .filter((e) => e.key.startsWith(RECENT_PREFIX) && e.value?.handle)
      .map((e) => ({ name: e.key.slice(RECENT_PREFIX.length), handle: e.value.handle, opened: e.value.opened ?? 0 }))
      .sort((a, b) => b.opened - a.opened);
  } catch { return []; }
}

export async function rememberHandle(handle: DirHandle): Promise<void> {
  try {
    await idbWrite((s) => s.put({ handle, opened: Date.now() }, RECENT_PREFIX + handle.name));
    const extra = (await listRecent()).slice(RECENT_MAX);
    if (extra.length) await idbWrite((s) => extra.forEach((p) => s.delete(RECENT_PREFIX + p.name)));
  } catch { /* ignore */ }
}

export async function forgetRecent(name: string): Promise<void> {
  try { await idbWrite((s) => s.delete(RECENT_PREFIX + name)); } catch { /* ignore */ }
}

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

export async function readFolder(handle: DirHandle): Promise<FolderContent> {
  const images: File[] = [];
  const heic: string[] = [];
  let doc: Doc | null = null;
  for await (const entry of handle.values()) {
    if (entry.kind !== 'file') continue;
    if (entry.name === PROJECT_FILE) {
      try { doc = parseDoc(await (await entry.getFile()).text()); } catch { /* ignoré */ }
    } else if (isImageName(entry.name)) {
      images.push(await entry.getFile());
    } else if (isHeicName(entry.name)) {
      heic.push(entry.name);
    }
  }
  return { images, heic: pendingHeic(heic, images), doc };
}

/** Mode repli (navigateurs sans File System Access) : fichiers d'un <input webkitdirectory>, premier niveau seulement. */
export async function readFileList(files: File[]): Promise<FolderContent> {
  const images: File[] = [];
  const heic: string[] = [];
  let doc: Doc | null = null;
  for (const f of files) {
    if (f.webkitRelativePath.split('/').length > 2) continue; // sous-dossiers ignorés, comme en mode Chrome
    if (f.name === PROJECT_FILE) {
      try { doc = parseDoc(await f.text()); } catch { /* ignoré */ }
    } else if (isImageName(f.name)) images.push(f);
    else if (isHeicName(f.name)) heic.push(f.name);
  }
  return { images, heic: pendingHeic(heic, images), doc };
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
