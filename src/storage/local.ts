// Stockage dans le navigateur (toujours protégé : il peut être indisponible).
// - localStorage : une copie de secours par montage (« mosaique.doc:<dossier>/<fichier> ») ;
// - sessionStorage : dossier et montage ouverts dans cet onglet (un onglet par montage).

import type { Doc } from '../types';
import { forWrite } from './album';
import { parseDoc } from './doc';

const LS_DOC = 'mosaique.doc';
const SS_CURRENT = 'mosaique.current';

/** Clé de la copie de secours d'un montage : dossier + fichier du montage ('' = montage hors dossier). */
export const montageKey = (project: string, file: string) => (project && file ? `${project}/${file}` : project);

const docKey = (key: string) => (key ? `${LS_DOC}:${key}` : LS_DOC);

export function saveLocal(doc: Doc, key = ''): void {
  try { localStorage.setItem(docKey(key), JSON.stringify(forWrite(doc))); } catch { /* stockage indisponible */ }
}

export function loadLocal(key = ''): Doc | null {
  try {
    const t = localStorage.getItem(docKey(key));
    return t ? parseDoc(t) : null;
  } catch { return null; }
}

/** Retire la copie de secours d'un montage (après suppression ou renommage). */
export function removeLocal(key: string): void {
  try { localStorage.removeItem(docKey(key)); } catch { /* ignore */ }
}

/** Copies de secours des montages d'un dossier : { fichier du montage → document }. */
export function listLocalMontages(project: string): { file: string; doc: Doc }[] {
  const out: { file: string; doc: Doc }[] = [];
  try {
    const prefix = `${docKey(project)}/`;
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k?.startsWith(prefix)) continue;
      try { out.push({ file: k.slice(prefix.length), doc: parseDoc(localStorage.getItem(k) ?? '') }); } catch { /* ignoré */ }
    }
  } catch { /* stockage indisponible */ }
  return out;
}

const session = {
  get: (k: string) => { try { return sessionStorage.getItem(k) ?? ''; } catch { return ''; } },
  set: (k: string, v: string) => { try { sessionStorage.setItem(k, v); } catch { /* ignore */ } },
};

/** Dossier et montage ouverts dans cet onglet (chaque onglet peut avoir les siens). */
export const currentProject = () => session.get(SS_CURRENT);
export const setCurrentProject = (name: string) => session.set(SS_CURRENT, name);
export const currentMontageFile = () => session.get(`${SS_CURRENT}.montage`);
export const setCurrentMontageFile = (file: string) => session.set(`${SS_CURRENT}.montage`, file);

/** Petite préférence d'interface (disposition choisie…), mémorisée dans le navigateur. */
export const pref = {
  get: (k: string) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* ignore */ } },
};
