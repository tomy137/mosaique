// Ouverture d'un dossier de photos (bouton, glisser-déposer, repli lecture seule) et dossiers récents.
// Rien n'est jamais perdu : l'ancien montage.json et les copies gardées par le navigateur deviennent des montages.

import { isImportFile } from '../storage/archive';
import {
  ensurePermission, hasFsAccess, pickFolder, readEntryFiles, readFileList, readFolder,
  type DirHandle, type FolderContent,
} from '../storage/folder';
import { listLocalMontages, loadLocal, removeLocal, setCurrentMontageFile, setCurrentProject } from '../storage/local';
import { montageName, nextDefaultName, readMontages, sameContent, uniqueFile, uniqueName, writeMontage, type Montage } from '../storage/montages';
import { forgetRecent, listRecent, rememberHandle, type RecentProject } from '../storage/recent';
import { $, ago, clone } from './dom';
import { showHeicHelp } from './heic';
import { addFiles, renderLibrary } from './library';
import { createMontage, importMontage, refreshUsage, renderMontages } from './montages';
import { flushSave, save, showDoc, snapshotCurrent } from './persistence';
import { app, currentMontage, currentName, lib, store } from './state';
import { toast } from './toast';

/**
 * Reprend les montages d'un dossier sans rien perdre : l'ancien montage.json (s'il n'y a encore aucun montage),
 * les copies du navigateur plus récentes ou jamais écrites, et l'ancienne copie de secours (un montage par dossier).
 */
function recoverMontages(name: string, list: Montage[], legacyFile: FolderContent['doc']) {
  const recovered: Montage[] = [];
  const notes: string[] = [];
  const now = Date.now();
  if (!list.length && legacyFile) {
    const m = { file: uniqueFile(name, []), doc: { ...legacyFile, name, createdAt: now } };
    list.push(m); recovered.push(m);
    notes.push('l’ancien montage.json devient le premier montage (le fichier d’origine est conservé)');
  }
  for (const l of listLocalMontages(name)) {
    const m = list.find((x) => x.file === l.file);
    if (!m) {
      list.push(l); recovered.push(l);
      notes.push(`« ${montageName(l)} », gardé seulement dans le navigateur, est réintégré`);
    } else if ((l.doc.updatedAt ?? 0) > (m.doc.updatedAt ?? 0) && !sameContent(l.doc, m.doc)) {
      m.doc = { ...l.doc, name: l.doc.name ?? m.doc.name };
      recovered.push(m);
      notes.push(`la version plus récente de « ${montageName(m)} » gardée par le navigateur est reprise`);
    }
  }
  const legacyLocal = loadLocal(name);
  if (legacyLocal && !list.some((m) => sameContent(m.doc, legacyLocal))) {
    const nm = uniqueName(`${name} (version du navigateur)`, list.map(montageName));
    const m = { file: uniqueFile(nm, list.map((x) => x.file)), doc: { ...legacyLocal, name: nm, createdAt: now } };
    list.push(m); recovered.push(m);
    notes.push(`une version plus récente gardée par le navigateur est récupérée sous « ${nm} »`);
  }
  return { recovered, notes, hadLegacyLocal: !!legacyLocal };
}

/**
 * Charge un dossier : ses photos et ses montages. `handle` : dossier accessible en écriture (sinon null).
 * `pending` : dossier lisible dont l'écriture reste à autoriser par un clic (dossier déposé dans Chrome).
 */
export async function loadProject(name: string, content: FolderContent, handle: DirHandle | null, pending: DirHandle | null = null) {
  await flushSave(); // le montage précédent est enregistré avant de basculer
  await snapshotCurrent();
  const wantedFile = name === app.project ? app.currentFile : '';
  app.folder = handle;
  app.pendingWrite = pending;
  $('btn-allow').hidden = !pending;
  app.project = name;
  setCurrentProject(name);
  const status = $('project-status');
  status.textContent = `${name} · chargement…`;
  lib.clear();
  renderRecent();

  const readable = handle ?? pending;
  const list: Montage[] = readable ? await readMontages(readable) : [];
  const { recovered, notes, hadLegacyLocal } = recoverMontages(name, list, content.doc);
  app.montages = list;
  if (handle) {
    for (const m of recovered) await writeMontage(handle, m);
    if (hadLegacyLocal) removeLocal(name); // ancienne copie de secours, désormais écrite dans le dossier
  }

  await lib.addFiles(content.images, (d, t) => (status.textContent = `${name} · photos ${d}/${t}`));
  showHeicHelp(name, content.heic);

  // montage à ouvrir : celui de cet onglet, sinon le plus récent
  const date = (m: Montage) => m.doc.updatedAt ?? m.doc.createdAt ?? 0;
  const cur = app.montages.find((m) => m.file === wantedFile) ?? [...app.montages].sort((a, b) => date(b) - date(a))[0];
  let msg: string;
  if (cur) {
    app.currentFile = cur.file;
    setCurrentMontageFile(cur.file);
    showDoc(clone(cur.doc));
    refreshUsage();
    msg = `${lib.photos.size} photo(s) · ${app.montages.length} montage(s) · ouvert : « ${montageName(cur)} ».`;
    const used = new Set(Object.values(store.doc.crops).map((c) => c.photo));
    const fresh = [...lib.photos.keys()].filter((n) => !used.has(n) && !app.usage.has(n)).length;
    if (fresh) msg += ` ${fresh} photo(s) utilisée(s) dans aucun montage.`;
  } else {
    await createMontage(nextDefaultName([]), lib.photos.size > 0);
    msg = lib.photos.size
      ? `${lib.photos.size} photo(s) chargée(s) et placée(s) dans « ${currentName()} ». « Variante » (⇧G) pour une autre mise en page.`
      : '';
  }
  if (notes.length) msg += ` Reprise : ${notes.join(' ; ')}.`;
  renderMontages();
  renderLibrary();

  status.textContent = handle
    ? `${name} › ${currentName()}`
    : pending ? `${name} · pas encore enregistré dans le dossier` : `${name} · sauvegarde dans le navigateur uniquement`;
  if (!lib.photos.size) {
    toast(content.heic.length
      ? `Aucune photo lisible dans « ${name} » : uniquement des HEIC. La commande de conversion est dans le panneau Photos.`
      : `Aucune photo (JPEG, PNG, WebP…) trouvée dans « ${name} ».`, 20000);
    return;
  }
  if (content.heic.length) msg += ` ${content.heic.length} photo(s) HEIC ignorée(s) : commande de conversion dans le panneau Photos.`;
  if (pending) msg += ' Pour enregistrer dans le dossier, cliquer sur « Autoriser l’enregistrement dans le dossier » (en haut à gauche) : Chrome demande la permission une seule fois.';
  else if (!handle) msg += ' Ce navigateur (Safari, Firefox…) ne permet pas d’enregistrer dans le dossier : les montages sont gardés dans le navigateur. Avec Chrome, ils sont enregistrés dans le dossier.';
  toast(msg, notes.length || content.heic.length || !handle ? 20000 : 8000);
}

/** Dossier déposé : lisible tout de suite, mais Chrome n'accorde l'écriture qu'après un clic. */
async function openDropped(handleP: Promise<DirHandle> | null, entry: FileSystemDirectoryEntry) {
  try {
    const handle = handleP ? await handleP : null;
    if (handle?.kind === 'directory') {
      await rememberHandle(handle);
      let writable = (await handle.queryPermission({ mode: 'readwrite' })) === 'granted';
      if (!writable) {
        try { writable = (await handle.requestPermission({ mode: 'readwrite' })) === 'granted'; } catch { /* pas de clic récent */ }
      }
      await loadProject(handle.name, await readFolder(handle), writable ? handle : null, writable ? null : handle);
      return;
    }
  } catch { /* repli en lecture seule ci-dessous */ }
  try {
    await loadProject(entry.name, await readFileList(await readEntryFiles(entry)), null);
  } catch (err) {
    toast(`Impossible de lire le dossier « ${entry.name} » : ${(err as Error).message}`, 12000);
  }
}

/** Glisser un dossier sur la page = l'ouvrir ; un .json / .zip = importer un montage ; des photos = les ajouter. */
function onWindowDrop(e: DragEvent) {
  const items = [...(e.dataTransfer?.items ?? [])].filter((it) => it.kind === 'file');
  const dirItem = items.find((it) => it.webkitGetAsEntry()?.isDirectory);
  const files = [...(e.dataTransfer?.files ?? [])];
  if (!dirItem) {
    if (files.length && files.every(isImportFile)) {
      e.preventDefault();
      e.stopPropagation();
      (async () => { for (const f of files) await importMontage(f); })();
      return;
    }
    // fichiers isolés hors de la zone de montage et des volets : on les ajoute quand même
    if (files.length && !(e.target as Element).closest?.('svg, #sidebar, #photos')) {
      e.preventDefault();
      addFiles(files);
    }
    return;
  }
  e.preventDefault();
  e.stopPropagation();
  // les éléments du dépôt ne sont lisibles que pendant l'événement : on récupère tout tout de suite
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const getHandle = (dirItem as any).getAsFileSystemHandle;
  const handleP: Promise<DirHandle> | null = typeof getHandle === 'function' ? getHandle.call(dirItem) : null;
  openDropped(handleP, dirItem.webkitGetAsEntry() as FileSystemDirectoryEntry);
}

/** « Autoriser l'enregistrement dans le dossier » : tous les montages en mémoire sont écrits. */
async function allowWrite() {
  const h = app.pendingWrite;
  if (!h) return;
  try {
    if (!(await ensurePermission(h))) { toast('Permission refusée : les montages restent gardés dans le navigateur.'); return; }
  } catch (e) {
    toast(`Autorisation impossible : ${(e as Error).message}`, 10000);
    return;
  }
  app.folder = h;
  app.pendingWrite = null;
  $('btn-allow').hidden = true;
  await flushSave();
  const cur = currentMontage();
  if (cur) cur.doc = clone(store.doc);
  try {
    for (const m of app.montages) await writeMontage(h, m);
    removeLocal(app.project); // ancienne copie de secours, désormais écrite dans le dossier
    await save(true);
  } catch (e) {
    toast(`Échec de l'écriture : ${(e as Error).message}`, 12000);
    return;
  }
  renderRecent();
  toast(`Enregistrement activé : ${app.montages.length} montage(s) enregistré(s) dans ${h.name}/mosaique-montages.`, 6000);
}

// ------------------------------------------------------------------ dossiers récents

export async function renderRecent() {
  const list = await listRecent();
  $('recent').replaceChildren(...list.map((p) => {
    const isCurrent = p.name === app.project && !!(app.folder || app.pendingWrite);
    const row = document.createElement('div');
    row.className = `recent-item${isCurrent ? ' current' : ''}`;
    const open = document.createElement('button');
    open.className = 'recent-open';
    open.title = isCurrent ? `${p.name} (dossier ouvert) — cliquer pour le recharger` : `Ouvrir « ${p.name} »`;
    const label = document.createElement('span');
    label.className = 'recent-name';
    label.textContent = p.name;
    const when = document.createElement('span');
    when.className = 'recent-date';
    when.textContent = isCurrent ? 'ouvert' : ago(p.opened);
    open.append(label, when);
    open.onclick = () => reopenRecent(p);
    const forget = document.createElement('button');
    forget.className = 'recent-forget';
    forget.textContent = '×';
    forget.title = 'Retirer de la liste (le dossier et ses photos ne sont pas touchés)';
    forget.onclick = async () => { await forgetRecent(p.name); renderRecent(); };
    row.append(open, forget);
    return row;
  }));
  $('recent-block').hidden = !list.length;
}

async function reopenRecent(p: RecentProject) {
  try {
    if (!(await ensurePermission(p.handle))) { toast('Accès au dossier refusé.'); return; }
    await rememberHandle(p.handle);
    await loadProject(p.name, await readFolder(p.handle), p.handle);
  } catch (e) {
    toast(`Impossible d’ouvrir « ${p.name} » : ${(e as Error).message}. Le dossier a peut-être été déplacé ou renommé : le glisser à nouveau sur la page.`, 12000);
  }
}

export function initFolder() {
  $('btn-open').onclick = async () => {
    if (!hasFsAccess()) {
      // Safari, Firefox, Brave… : choix de dossier classique, sans écriture dans le dossier
      $<HTMLInputElement>('dir-input').click();
      return;
    }
    try {
      const handle = await pickFolder();
      await rememberHandle(handle);
      await loadProject(handle.name, await readFolder(handle), handle);
    } catch (e) {
      if ((e as Error).name !== 'AbortError') toast(`Ouverture impossible : ${(e as Error).message}`, 12000);
    }
  };
  $<HTMLInputElement>('dir-input').onchange = async (e) => {
    const input = e.target as HTMLInputElement;
    const files = [...(input.files ?? [])];
    input.value = '';
    if (!files.length) return;
    await loadProject(files[0].webkitRelativePath.split('/')[0] || 'dossier', await readFileList(files), null);
  };
  $('btn-allow').onclick = allowWrite;
  window.addEventListener('dragover', (e) => { if (e.dataTransfer?.types.includes('Files')) e.preventDefault(); });
  window.addEventListener('drop', onWindowDrop, true);
}
