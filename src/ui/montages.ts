// Montages du dossier : liste, ouvrir, créer, dupliquer, supprimer (corbeille), renommer,
// export / import (.json, .zip avec photos), et repérage des photos utilisées ailleurs.

import { montageJson, montageZip, readImport, remapPhotos } from '../storage/archive';
import { newDoc } from '../storage/doc';
import { fileExists, writeFile } from '../storage/folder';
import { montageKey, removeLocal, saveLocal, setCurrentMontageFile } from '../storage/local';
import {
  montageName, nextDefaultName, removeMontageFile, renameMontageFile, trashMontage, uniqueFile, uniqueName, usageElsewhere,
  type Montage,
} from '../storage/montages';
import { download } from '../render/export';
import type { Doc } from '../types';
import { $, ago, clone, fileSafe, photoCount } from './dom';
import { generateLayout } from './layout';
import { renderLibrary } from './library';
import { cancelPendingSave, flushSave, save, showDoc, snapshotCurrent } from './persistence';
import { app, currentMontage, currentName, editor, lib, store } from './state';
import { toast } from './toast';

/** Recalcule les photos utilisées dans les autres montages (pastilles orange). */
export function refreshUsage() {
  app.usage = usageElsewhere(app.montages, app.currentFile);
  editor.render();
}

export function warnIfUsedElsewhere(photo: string) {
  const others = app.usage.get(photo);
  if (others?.length) toast(`Attention : « ${photo} » est déjà utilisée dans ${others.map((n) => `« ${n} »`).join(', ')}.`, 7000);
}

export function renderMontages() {
  const sorted = [...app.montages].sort((a, b) => montageName(a).localeCompare(montageName(b), 'fr', { numeric: true }));
  $('montage-list').replaceChildren(...sorted.map((m) => {
    const isCur = m.file === app.currentFile;
    const b = document.createElement('button');
    b.className = `montage-item${isCur ? ' current' : ''}`;
    const name = document.createElement('span');
    name.className = 'm-name';
    name.textContent = montageName(m);
    const meta = document.createElement('span');
    meta.className = 'm-meta';
    const n = photoCount((isCur ? store.doc : m.doc).crops);
    meta.textContent = `${n} photo${n > 1 ? 's' : ''} · ${isCur ? 'ouvert' : ago(m.doc.updatedAt ?? m.doc.createdAt ?? 0)}`;
    b.title = `${montageName(m)}\n${m.file}`;
    b.append(name, meta);
    b.onclick = () => openMontage(m);
    return b;
  }));
  const input = $<HTMLInputElement>('montage-name');
  if (document.activeElement !== input) input.value = currentName();
  $<HTMLButtonElement>('btn-m-del').disabled = !app.montages.length;
  $('montage-info').textContent = app.folder
    ? `Enregistré dans ${app.folder.name}/mosaique-montages (historique et corbeille inclus). Le .zip contient aussi les photos originales.`
    : app.pendingWrite ? 'Pas encore enregistré dans le dossier : cliquer sur « Autoriser l’enregistrement ».' : 'Gardé dans le navigateur : ouvrir un dossier pour enregistrer les montages à côté des photos.';
  // résumés visibles quand les sections sont repliées, et titre dans la barre d'outils
  const n = photoCount(store.doc.crops);
  $('sum-montage').textContent = `${currentName()} · ${n} photo${n > 1 ? 's' : ''}${app.montages.length > 1 ? ` · ${app.montages.length} montages` : ''}`;
  $('sum-dossier').textContent = app.project || 'aucun dossier';
  $('doc-title').textContent = app.project ? `${app.project} › ${currentName()}` : currentName();
}

/** Bascule sur un autre montage du dossier (le précédent est enregistré et copié dans l'historique). */
async function openMontage(m: Montage) {
  if (m.file === app.currentFile) return;
  await flushSave();
  await snapshotCurrent();
  setCurrent(m.file);
  showDoc(clone(m.doc));
  refreshUsage();
  renderMontages();
  renderLibrary();
  if (app.folder) $('project-status').textContent = `${app.folder.name} › ${montageName(m)}`;
  toast(`Montage « ${montageName(m)} » ouvert.`, 2500);
}

function setCurrent(file: string) {
  app.currentFile = file;
  setCurrentMontageFile(file);
}

/** Nouveau montage ; avec `generate`, mise en page générée avec les photos pas encore utilisées. */
export async function createMontage(name: string, generate: boolean, base?: Doc) {
  await flushSave();
  await snapshotCurrent();
  const doc: Doc = { ...(base ? clone(base) : newDoc(store.doc.settings)), name, createdAt: Date.now() };
  const m: Montage = { file: uniqueFile(name, app.montages.map((x) => x.file)), doc };
  app.montages.push(m);
  setCurrent(m.file);
  showDoc(clone(doc));
  refreshUsage();
  if (generate && lib.photos.size) generateLayout(true);
  await save(true);
  renderMontages();
  renderLibrary();
}

async function newMontage() {
  const name = nextDefaultName(app.montages);
  await createMontage(name, true);
  const placed = Object.keys(store.doc.crops).length;
  toast(`« ${name} » créé${placed ? ` avec ${placed} photo(s) pas encore utilisée(s)` : ''}. Le renommer dans le champ « Nom du montage ».`, 6000);
  $<HTMLInputElement>('montage-name').select();
}

async function duplicateMontage() {
  const name = uniqueName(`${currentName()} (copie)`, app.montages.map(montageName));
  await createMontage(name, false, store.doc);
  toast(`Copie enregistrée sous « ${name} ». Ses photos sont donc aussi signalées comme utilisées dans l’autre montage.`, 6000);
}

/** Retire un montage de la liste (et sa copie de secours) puis ouvre le plus récent, ou un nouveau. */
async function removeFromList(m: Montage) {
  app.montages = app.montages.filter((x) => x !== m);
  if (app.project) removeLocal(montageKey(app.project, m.file));
  app.currentFile = '';
  const next = [...app.montages].sort((a, c) => (c.doc.updatedAt ?? 0) - (a.doc.updatedAt ?? 0))[0];
  if (next) await openMontage(next);
  else await createMontage(nextDefaultName([]), lib.photos.size > 0);
  refreshUsage();
  renderMontages();
}

let deleteArmed = 0;
/** Suppression en deux clics ; le montage part dans la corbeille du dossier. */
async function deleteMontage() {
  const b = $<HTMLButtonElement>('btn-m-del');
  const m = currentMontage();
  if (!m) return;
  if (!deleteArmed) {
    b.classList.add('confirm');
    b.textContent = 'Confirmer ?';
    deleteArmed = window.setTimeout(() => { deleteArmed = 0; b.classList.remove('confirm'); b.textContent = 'Supprimer'; }, 4000);
    return;
  }
  clearTimeout(deleteArmed);
  deleteArmed = 0;
  b.classList.remove('confirm');
  b.textContent = 'Supprimer';
  await flushSave();
  if (app.folder) {
    try { await trashMontage(app.folder, { ...m, doc: clone(store.doc) }); } catch (e) {
      toast(`Suppression impossible : ${(e as Error).message}`, 10000);
      return;
    }
  }
  const name = montageName(m);
  await removeFromList(m);
  toast(app.folder
    ? `« ${name} » supprimé (une copie reste dans ${app.folder.name}/mosaique-montages/.corbeille).`
    : `« ${name} » supprimé.`, 8000);
}

async function renameCurrent(raw: string) {
  const m = currentMontage();
  const name = raw.trim();
  if (!m || !name || name === montageName(m)) { renderMontages(); return; }
  const others = app.montages.filter((x) => x !== m);
  const unique = uniqueName(name, others.map(montageName));
  await flushSave();
  const newFile = uniqueFile(unique, others.map((x) => x.file));
  store.doc.name = unique;
  const doc = clone(store.doc);
  try {
    if (app.folder) await renameMontageFile(app.folder, { file: m.file, doc }, newFile);
  } catch (e) {
    toast(`Renommage impossible : ${(e as Error).message}`, 10000);
    return;
  }
  saveLocal(doc, montageKey(app.project, newFile));
  if (app.project && newFile !== m.file) removeLocal(montageKey(app.project, m.file));
  m.file = newFile;
  m.doc = doc;
  setCurrent(newFile);
  refreshUsage();
  renderMontages();
  if (app.folder) $('project-status').textContent = `${app.folder.name} › ${unique}`;
  toast(`Montage renommé en « ${unique} ».`, 3000);
}

// ------------------------------------------------------------------ export / import

async function exportJson() {
  await flushSave();
  download(new Blob([montageJson(store.doc, lib)], { type: 'application/json' }), `${fileSafe(currentName())}.mosaique.json`);
  toast('Montage exporté (.json). Pour le rouvrir avec ses photos sur un autre ordinateur, préférer l’export .zip.', 6000);
}

async function exportZip() {
  await flushSave();
  try {
    const { blob, missing } = await montageZip(store.doc, lib, (d, t) => toast(`Préparation du zip : photo ${d}/${t}…`, 0));
    const name = `${fileSafe(currentName())}.mosaique.zip`;
    download(blob, name);
    toast(`${name} · ${(blob.size / 1e6).toFixed(1)} Mo${missing.length ? ` · ${missing.length} photo(s) introuvable(s), non incluse(s)` : ''}.`, 8000);
  } catch (e) {
    toast(`Échec de l'export : ${(e as Error).message}`, 10000);
  }
}

/** Le montage ouvert est vide (aucune coupe, aucune photo) : on le retire, il ne contient rien à perdre. */
async function discardIfEmpty() {
  const m = currentMontage();
  if (!m || store.doc.root.children || Object.keys(store.doc.crops).length) return;
  cancelPendingSave();
  app.montages = app.montages.filter((x) => x !== m);
  if (app.project) removeLocal(montageKey(app.project, m.file));
  if (app.folder) await removeMontageFile(app.folder, m.file);
  app.currentFile = '';
}

/** Importe un montage (.json ou .zip) comme nouveau montage du dossier. Rien n'est écrasé. */
export async function importMontage(file: File) {
  try {
    toast(`Import de « ${file.name} »…`, 0);
    const { doc, photos } = await readImport(file);
    // photos du zip : on réutilise celles déjà présentes, on renomme celles qui entreraient en conflit
    const taken = async (n: string) => !!lib.get(n) || (await fileExists(app.folder, n));
    const renames = new Map<string, string>();
    const added: File[] = [];
    for (const f of photos) {
      const existing = lib.get(f.name);
      if (existing && existing.file.size === f.size) continue;
      let target = f.name;
      if (await taken(target)) {
        for (let i = 2; await taken(target); i++) target = f.name.replace(/(\.[^.]+)$/, ` (import ${i})$1`);
        renames.set(f.name, target);
      }
      added.push(target === f.name ? f : new File([f], target, { type: f.type }));
    }
    if (added.length) {
      await lib.addFiles(added);
      if (app.folder) for (const f of added) if (!(await fileExists(app.folder, f.name))) await writeFile(app.folder, f.name, f);
    }
    await discardIfEmpty();
    const base = doc.name?.trim() || file.name.replace(/(\.mosaique)?\.(json|zip)$/i, '');
    const name = uniqueName(base, app.montages.map(montageName));
    await createMontage(name, false, remapPhotos(doc, renames));
    const missing = [...new Set(Object.values(store.doc.crops).map((c) => c.photo))].filter((p) => !lib.get(p));
    toast(`Montage « ${name} » importé${added.length ? `, ${added.length} photo(s) ajoutée(s)${app.folder ? ' au dossier' : ''}` : ''}`
      + `${renames.size ? ` (${renames.size} renommée(s) pour ne rien écraser)` : ''}`
      + `${missing.length ? `. ${missing.length} photo(s) introuvable(s) : importer plutôt le .zip, ou ouvrir le dossier qui les contient` : ''}.`, 12000);
  } catch (e) {
    toast(`Import impossible (« ${file.name} ») : ${(e as Error).message}`, 12000);
  }
}

export function initMontages() {
  editor.usedElsewhere = (photo) => app.usage.get(photo) ?? [];
  editor.onPhotoPlaced = warnIfUsedElsewhere;
  $('btn-m-new').onclick = newMontage;
  $('btn-m-dup').onclick = duplicateMontage;
  $('btn-m-del').onclick = deleteMontage;
  $('btn-m-json').onclick = exportJson;
  $('btn-m-zip').onclick = exportZip;
  const nameInput = $<HTMLInputElement>('montage-name');
  nameInput.onchange = () => renameCurrent(nameInput.value);
  nameInput.onkeydown = (e) => {
    if (e.key === 'Enter') nameInput.blur();
    if (e.key === 'Escape') { nameInput.value = currentName(); nameInput.blur(); }
  };
  $<HTMLInputElement>('import-input').onchange = async (e) => {
    const input = e.target as HTMLInputElement;
    const files = [...(input.files ?? [])];
    input.value = '';
    for (const f of files) await importMontage(f);
  };
}
