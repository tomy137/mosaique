// Plusieurs montages par dossier de photos.
// Chaque montage est un fichier JSON dans <dossier>/mosaique-montages/. Sécurité :
//  - historique : copies datées dans mosaique-montages/.historique/ (les 30 dernières par montage) ;
//  - suppression = déplacement dans mosaique-montages/.corbeille/ ;
//  - l'ancien montage.json à la racine n'est jamais modifié (il est seulement copié comme premier montage).

import { parseDoc } from './project';
import type { Doc } from './types';

/* eslint-disable @typescript-eslint/no-explicit-any */
type DirHandle = any;

export const MONTAGES_DIR = 'mosaique-montages';
export const HISTORY_DIR = '.historique';
export const TRASH_DIR = '.corbeille';
const HISTORY_KEEP = 30;

export interface Montage { file: string; doc: Doc }

export const montageName = (m: Montage) => m.doc.name?.trim() || m.file.replace(/\.json$/i, '');

/** Nom de fichier sûr pour macOS / Windows, à partir du nom du montage. */
export function safeFileBase(name: string): string {
  const s = name.normalize('NFC').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '-').replace(/\s+/g, ' ').trim().replace(/^\.+/, '');
  return (s || 'Montage').slice(0, 80);
}

/** Nom de fichier unique (« Noël.json », « Noël (2).json »…). */
export function uniqueFile(name: string, taken: Iterable<string>): string {
  const set = new Set([...taken].map((f) => f.toLowerCase()));
  const base = safeFileBase(name);
  for (let i = 1; ; i++) {
    const f = `${base}${i > 1 ? ` (${i})` : ''}.json`;
    if (!set.has(f.toLowerCase())) return f;
  }
}

/** Nom de montage unique dans la liste (« Montage 2 », « Noël (copie) »…). */
export function uniqueName(name: string, taken: Iterable<string>): string {
  const set = new Set([...taken].map((n) => n.toLowerCase()));
  if (!set.has(name.toLowerCase())) return name;
  for (let i = 2; ; i++) {
    const n = `${name} (${i})`;
    if (!set.has(n.toLowerCase())) return n;
  }
}

export function nextDefaultName(montages: Montage[]): string {
  const names = new Set(montages.map(montageName));
  for (let i = montages.length + 1; ; i++) if (!names.has(`Montage ${i}`)) return `Montage ${i}`;
}

/** Même mise en page et mêmes photos (le nom et les dates ne comptent pas). */
export function sameContent(a: Doc, b: Doc): boolean {
  const key = (d: Doc) => JSON.stringify([d.settings, d.root, d.crops]);
  return key(a) === key(b);
}

export const photosOf = (doc: Doc): Set<string> => new Set(Object.values(doc.crops).map((c) => c.photo));

/** Pour chaque photo : les autres montages du dossier qui l'utilisent. */
export function usageElsewhere(montages: Montage[], currentFile: string): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const m of montages) {
    if (m.file === currentFile) continue;
    for (const p of photosOf(m.doc)) out.set(p, [...(out.get(p) ?? []), montageName(m)]);
  }
  return out;
}

// ------------------------------------------------------------------ lecture / écriture dans le dossier

async function subdir(dir: DirHandle, name: string, create: boolean): Promise<DirHandle | null> {
  try { return await dir.getDirectoryHandle(name, { create }); } catch { return null; }
}

async function write(dir: DirHandle, name: string, data: Blob | string): Promise<void> {
  const fh = await dir.getFileHandle(name, { create: true });
  const w = await fh.createWritable();
  await w.write(data);
  await w.close();
}

export async function readMontages(dir: DirHandle): Promise<Montage[]> {
  const md = await subdir(dir, MONTAGES_DIR, false);
  if (!md) return [];
  const out: Montage[] = [];
  for await (const e of md.values()) {
    if (e.kind !== 'file' || !/\.json$/i.test(e.name) || e.name.startsWith('.')) continue;
    try { out.push({ file: e.name, doc: parseDoc(await (await e.getFile()).text()) }); } catch { /* fichier illisible : ignoré */ }
  }
  return out.sort((a, b) => montageName(a).localeCompare(montageName(b), 'fr', { numeric: true }));
}

export async function writeMontage(dir: DirHandle, m: Montage): Promise<void> {
  const md = await subdir(dir, MONTAGES_DIR, true);
  await write(md, m.file, JSON.stringify(m.doc, null, 1));
}

const stamp = (t = new Date()) =>
  `${t.getFullYear()}${String(t.getMonth() + 1).padStart(2, '0')}${String(t.getDate()).padStart(2, '0')}-` +
  `${String(t.getHours()).padStart(2, '0')}${String(t.getMinutes()).padStart(2, '0')}${String(t.getSeconds()).padStart(2, '0')}`;

/** Copie datée dans l'historique ; on garde les HISTORY_KEEP plus récentes de chaque montage. */
export async function snapshotMontage(dir: DirHandle, m: Montage): Promise<void> {
  const md = await subdir(dir, MONTAGES_DIR, true);
  const hd = await subdir(md, HISTORY_DIR, true);
  const base = m.file.replace(/\.json$/i, '');
  await write(hd, `${base}__${stamp()}.json`, JSON.stringify(m.doc, null, 1));
  const mine: string[] = [];
  for await (const e of hd.values()) if (e.kind === 'file' && e.name.startsWith(`${base}__`)) mine.push(e.name);
  mine.sort();
  for (const old of mine.slice(0, Math.max(0, mine.length - HISTORY_KEEP))) {
    try { await hd.removeEntry(old); } catch { /* ignore */ }
  }
}

/** Suppression sûre : copie dans la corbeille, puis retrait de la liste. */
export async function trashMontage(dir: DirHandle, m: Montage): Promise<void> {
  const md = await subdir(dir, MONTAGES_DIR, true);
  const td = await subdir(md, TRASH_DIR, true);
  await write(td, `${m.file.replace(/\.json$/i, '')}__${stamp()}.json`, JSON.stringify(m.doc, null, 1));
  await md.removeEntry(m.file);
}

/** Renommage : on écrit d'abord le nouveau fichier, puis on retire l'ancien. */
export async function renameMontageFile(dir: DirHandle, m: Montage, newFile: string): Promise<void> {
  await writeMontage(dir, { ...m, file: newFile });
  if (newFile !== m.file) {
    const md = await subdir(dir, MONTAGES_DIR, false);
    try { await md?.removeEntry(m.file); } catch { /* déjà absent */ }
  }
}
