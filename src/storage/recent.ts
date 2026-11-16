// Dossiers récents : accès aux dossiers mémorisés dans IndexedDB (clé « p:<nom> »).

import type { DirHandle } from './folder';

/* eslint-disable @typescript-eslint/no-explicit-any */

const IDB_NAME = 'mosaique';
const IDB_STORE = 'handles';
const RECENT_PREFIX = 'p:';
const RECENT_MAX = 12;

export interface RecentProject { name: string; handle: DirHandle; opened: number }

function idb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(IDB_STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

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

/** Dossiers récents, du plus récent au plus ancien. */
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
