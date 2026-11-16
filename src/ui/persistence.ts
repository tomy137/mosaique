// Enregistrement : automatique (600 ms après une modification), copie de secours dans le navigateur,
// fichier du montage dans le dossier, et copie datée dans l'historique au plus toutes les 10 minutes.

import { saveLocal, montageKey } from '../storage/local';
import { montageName, snapshotMontage, writeMontage } from '../storage/montages';
import type { Doc } from '../types';
import { $, clone, hhmm } from './dom';
import { renderMontages } from './montages';
import { app, currentMontage, currentName, store } from './state';
import { toast } from './toast';

const SNAPSHOT_EVERY = 10 * 60 * 1000;
let timer = 0;
let pending = false;
let skipNext = false; // ouvrir un montage n'est pas une modification
const lastSnapshot = new Map<string, number>();

/** Remplace le document affiché sans le compter comme une modification. */
export function showDoc(doc: Doc) {
  skipNext = true;
  store.replace(doc);
  skipNext = false;
}

/** Abandonne l'enregistrement en attente (montage vide qu'on retire). */
export function cancelPendingSave() {
  clearTimeout(timer);
  pending = false;
}

export async function flushSave() {
  if (!pending) return;
  clearTimeout(timer);
  await save();
}

export async function save(forceSnapshot = false) {
  pending = false;
  const doc = store.doc;
  doc.updatedAt = Date.now();
  if (!doc.name) doc.name = currentMontage()?.doc.name ?? 'Montage 1';
  saveLocal(doc, montageKey(app.project, app.currentFile));
  const m = currentMontage();
  if (m) m.doc = clone(doc);
  renderMontages();
  if (!app.folder || !m) return;
  try {
    await writeMontage(app.folder, m);
    if (forceSnapshot || Date.now() - (lastSnapshot.get(m.file) ?? 0) > SNAPSHOT_EVERY) {
      await snapshotMontage(app.folder, m);
      lastSnapshot.set(m.file, Date.now());
    }
    $('project-status').textContent = `${app.folder.name} › ${montageName(m)} · enregistré ${hhmm()}`;
  } catch (e) {
    $('project-status').textContent = `Échec de l'enregistrement : ${(e as Error).message}`;
    toast(`Échec de l'enregistrement dans le dossier : ${(e as Error).message}. Le montage reste gardé dans le navigateur.`, 12000);
  }
}

/** Copie datée du montage ouvert dans l'historique (avant de basculer, de supprimer…). */
export async function snapshotCurrent() {
  const m = currentMontage();
  if (!app.folder || !m) return;
  try { await snapshotMontage(app.folder, m); lastSnapshot.set(m.file, Date.now()); } catch { /* ignore */ }
}

/** ⌘S : enregistre tout de suite, avec une copie dans l'historique. */
export async function saveNow() {
  await flushSave();
  await save(true);
  toast(app.folder
    ? `« ${currentName()} » enregistré dans ${app.folder.name}/mosaique-montages, avec une copie datée dans l'historique.`
    : app.pendingWrite
      ? 'Enregistré dans le navigateur. Cliquer sur « Autoriser l’enregistrement dans le dossier » pour l’écrire aussi dans le dossier.'
      : 'Enregistré dans le navigateur. Ouvrir (ou glisser) un dossier pour enregistrer les montages à côté des photos.', 8000);
}

export function initPersistence() {
  store.subscribe(() => {
    if (skipNext) { skipNext = false; return; }
    clearTimeout(timer);
    pending = true;
    timer = window.setTimeout(() => save(), 600);
  });
  $('btn-save').onclick = saveNow;
  // Fermer l'onglet : on enregistre ce qui est en attente (au moins dans le navigateur).
  window.addEventListener('pagehide', () => { if (pending) saveLocal(store.doc, montageKey(app.project, app.currentFile)); });
}
