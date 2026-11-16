import './style.css';
import { isImportFile, montageJson, montageZip, readImport, remapPhotos } from './archive';
import { scaleTree } from './geometry/bsp';
import { applyGenerate, fillEmpty } from './layout/edit';
import { DEFAULT_MIN_AREA_FRAC } from './layout/generate';
import {
  montageName, nextDefaultName, readMontages, renameMontageFile, sameContent, snapshotMontage, trashMontage,
  uniqueFile, uniqueName, usageElsewhere, writeMontage, type Montage,
} from './montages';
import { Library } from './photos/library';
import {
  currentMontageFile, currentProject, dropLocal, ensurePermission, forgetRecent, hasFsAccess, listLocalMontages, listRecent, loadLocal,
  loadPresets, montageKey, newDoc, pickFolder, readEntryFiles, readFileList, readFolder, rememberHandle, removeLocal, saveLocal,
  savePresets, setCurrentMontageFile, setCurrentProject, writeFile, type FolderContent, type RecentProject,
} from './project';
import { Editor, PHOTO_MIME } from './render/editor';
import { download, layoutSvg, pxForPrint, renderCanvas, toImageBlob, toPdfBlob } from './render/export';
import { Store } from './store';
import type { BspNode, Doc, FormatPreset } from './types';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const num = (id: string) => Number($<HTMLInputElement>(id).value);
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));

// Chaque onglet a son dossier et son montage (sessionStorage) : plusieurs montages en parallèle.
let project = currentProject();
let currentFile = currentMontageFile();
const saved = loadLocal(montageKey(project, currentFile)) ?? loadLocal(project) ?? loadLocal();
const store = new Store(saved ?? newDoc());
const lib = new Library();
const editor = new Editor($('stage'), store, lib);

/** Montages du dossier courant (le montage ouvert y est recopié à chaque enregistrement). */
let montages: Montage[] = [];
/** Photo → autres montages qui l'utilisent. */
let usage = new Map<string, string[]>();

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let folder: any = null;
/** Dossier ouvert en lecture seule, dont l'écriture attend un clic sur « Autoriser l'enregistrement ». */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let pendingWrite: any = null;
let presets: FormatPreset[] = loadPresets();
let seed = Math.floor(Math.random() * 1e9);

// ------------------------------------------------------------------ barre d'état

let toastTimer = 0;
function toast(msg: string, ms = 4000) {
  $('toast-msg').textContent = msg;
  $('toast').hidden = !msg;
  clearTimeout(toastTimer);
  if (ms && msg) toastTimer = window.setTimeout(() => toast(''), ms);
}
$('toast-close').onclick = () => toast('');
editor.onToast = (m) => toast(m);

function updateHelp() {
  $('help').textContent = editor.mode === 'cut'
    ? 'Clic : coupe droite au point cliqué · Glisser : coupe libre (aimantée H/V, ⇧ force H/V, ⌥ angle libre) · Échap : sélection'
    : 'Glisser une photo : recadrer · Molette : zoom · Double-clic : recentrer · ⇧+glisser : échanger deux photos · Glisser une coupe ou ses poignées pour la déplacer (⌥ sans aimant)';
}

const hhmm = () => new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
const currentMontage = () => montages.find((m) => m.file === currentFile);
const currentName = () => store.doc.name?.trim() || currentMontage()?.doc.name || 'Montage';

// ------------------------------------------------------------------ sauvegarde

let saveTimer = 0;
let savePending = false;
let skipNextSave = false; // ouvrir un montage n'est pas une modification
const lastSnapshot = new Map<string, number>();
const SNAPSHOT_EVERY = 10 * 60 * 1000;

store.subscribe(() => {
  if (skipNextSave) { skipNextSave = false; return; }
  clearTimeout(saveTimer);
  savePending = true;
  saveTimer = window.setTimeout(() => save(), 600);
});

/** Remplace le document affiché sans le compter comme une modification. */
function showDoc(doc: Doc) {
  skipNextSave = true;
  store.replace(doc);
  skipNextSave = false;
}

async function flushSave() {
  if (!savePending) return;
  clearTimeout(saveTimer);
  await save();
}

async function save(forceSnapshot = false) {
  savePending = false;
  const doc = store.doc;
  doc.updatedAt = Date.now();
  if (!doc.name) doc.name = currentMontage()?.doc.name ?? 'Montage 1';
  saveLocal(doc, montageKey(project, currentFile));
  const m = currentMontage();
  if (m) m.doc = clone(doc);
  renderMontages();
  if (!folder || !m) return;
  try {
    await writeMontage(folder, m);
    if (forceSnapshot || Date.now() - (lastSnapshot.get(m.file) ?? 0) > SNAPSHOT_EVERY) {
      await snapshotMontage(folder, m);
      lastSnapshot.set(m.file, Date.now());
    }
    $('project-status').textContent = `${folder.name} › ${montageName(m)} · enregistré ${hhmm()}`;
  } catch (e) {
    $('project-status').textContent = `Échec de l'enregistrement : ${(e as Error).message}`;
    toast(`Échec de l'enregistrement dans le dossier : ${(e as Error).message}. Le montage reste gardé dans le navigateur.`, 12000);
  }
}

/** Copie datée du montage ouvert dans l'historique (avant de basculer, de supprimer…). */
async function snapshotCurrent() {
  const m = currentMontage();
  if (!folder || !m) return;
  try { await snapshotMontage(folder, m); lastSnapshot.set(m.file, Date.now()); } catch { /* ignore */ }
}

async function saveNow() {
  await flushSave();
  await save(true);
  toast(folder
    ? `« ${currentName()} » enregistré dans ${folder.name}/mosaique-montages, avec une copie datée dans l'historique.`
    : pendingWrite
      ? 'Enregistré dans le navigateur. Cliquer sur « Autoriser l’enregistrement dans le dossier » pour l’écrire aussi dans le dossier.'
      : 'Enregistré dans le navigateur. Ouvrir (ou glisser) un dossier pour enregistrer les montages à côté des photos.', 8000);
}
$('btn-save').onclick = saveNow;

// ------------------------------------------------------------------ conversion HEIC

const shellQuote = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;

/** Commande de conversion : un .jpg à côté de chaque .HEIC (sips garderait sinon l'extension .HEIC). */
function heicCommand(dir: string | null): string {
  const cd = dir ? `cd ${shellQuote(dir)}` : `cd « glisser ici le dossier depuis le Finder »`;
  return `${cd} && for f in *.[hH][eE][iI][cC]; do sips -s format jpeg "$f" --out "\${f%.*}.jpg" >/dev/null; done && echo "Conversion terminée"`;
}

async function showHeicHelp(folderName: string, heic: string[]) {
  if (!heic.length) { $('heic-box').hidden = true; return; }
  $('heic-count').textContent = `${heic.length} photo(s) HEIC ignorée(s)`;
  $('heic-cmd').textContent = heicCommand(null);
  $('heic-after').textContent = 'Recherche du chemin du dossier…';
  $('heic-box').hidden = false;
  // Le chemin complet n'est connu qu'en version locale (serveur de dev, /api/locate) ; en ligne, commande générique.
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);
  let dir: string | null = null;
  if (local) {
    try {
      const r = await fetch(`/api/locate?name=${encodeURIComponent(folderName)}&file=${encodeURIComponent(heic[0])}`);
      dir = (await r.json()).path ?? null;
    } catch { /* serveur sans l'API : commande générique */ }
  }
  $('heic-cmd').textContent = heicCommand(dir);
  $('heic-after').textContent = (dir
    ? ''
    : `${local ? `Chemin de « ${folderName} » introuvable automatiquement` : 'Version en ligne : chemin du dossier inconnu'} : remplacer la partie entre guillemets en glissant le dossier dans le Terminal. `)
    + 'Une fois la conversion terminée, glisser à nouveau le dossier sur la page.';
}

$('btn-heic-copy').onclick = async () => {
  try {
    await navigator.clipboard.writeText($('heic-cmd').textContent ?? '');
    toast('Commande copiée : la coller dans le Terminal (⌘V puis Entrée).');
  } catch {
    toast('Copie impossible : sélectionner la commande et faire ⌘C.');
  }
};
$('btn-heic-close').onclick = () => ($('heic-box').hidden = true);

// ------------------------------------------------------------------ dossier de photos

/**
 * Charge un dossier : ses photos et ses montages. `handle` : dossier accessible en écriture (sinon null).
 * `pending` : dossier lisible dont l'écriture reste à autoriser par un clic (dossier déposé dans Chrome).
 * Rien n'est jamais perdu : l'ancien montage.json et la copie gardée par le navigateur deviennent des montages.
 */
async function loadProject(name: string, content: FolderContent, handle: unknown | null, pending: unknown | null = null) {
  await flushSave(); // le montage précédent est enregistré avant de basculer
  await snapshotCurrent();
  const sameProject = name === project;
  const wantedFile = sameProject ? currentFile : '';
  folder = handle;
  pendingWrite = pending;
  $('btn-allow').hidden = !pending;
  project = name;
  setCurrentProject(name);
  const status = $('project-status');
  status.textContent = `${name} · chargement…`;
  lib.clear();
  renderRecent();

  // --- montages du dossier, et reprise sans perte des anciennes versions
  const readable = handle ?? pending;
  const list: Montage[] = readable ? await readMontages(readable) : [];
  const recovered: Montage[] = [];
  const notes: string[] = [];
  const now = Date.now();
  if (!list.length && content.doc) {
    const m = { file: uniqueFile(name, []), doc: { ...content.doc, name, createdAt: now } };
    list.push(m); recovered.push(m);
    notes.push('l’ancien montage.json devient le premier montage (le fichier d’origine est conservé)');
  }
  // copies gardées par le navigateur : plus récentes que le dossier, ou jamais écrites dans le dossier
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
  montages = list;
  if (handle) {
    for (const m of recovered) await writeMontage(handle, m);
    if (legacyLocal) dropLocal(name);
  }

  await lib.addFiles(content.images, (d, t) => (status.textContent = `${name} · photos ${d}/${t}`));
  showHeicHelp(name, content.heic);

  // --- montage à ouvrir : celui de cet onglet, sinon le plus récent
  const byDate = [...montages].sort((a, b) => (b.doc.updatedAt ?? b.doc.createdAt ?? 0) - (a.doc.updatedAt ?? a.doc.createdAt ?? 0));
  const cur = montages.find((m) => m.file === wantedFile) ?? byDate[0];
  let msg: string;
  if (cur) {
    currentFile = cur.file;
    setCurrentMontageFile(cur.file);
    showDoc(clone(cur.doc));
    refreshUsage();
    msg = `${lib.photos.size} photo(s) · ${montages.length} montage(s) · ouvert : « ${montageName(cur)} ».`;
    const used = new Set(Object.values(store.doc.crops).map((c) => c.photo));
    const fresh = [...lib.photos.keys()].filter((n) => !used.has(n) && !usage.has(n)).length;
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

// Glisser un dossier depuis le Finder sur la page = l'ouvrir ; glisser un .json / .zip = importer un montage.
window.addEventListener('dragover', (e) => {
  if (e.dataTransfer?.types.includes('Files')) e.preventDefault();
});
window.addEventListener('drop', (e) => {
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
    // fichiers isolés hors de la zone de montage et de la bibliothèque : on les ajoute quand même
    if (files.length && !(e.target as Element).closest?.('svg, #sidebar')) {
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
  const handleP: Promise<any> | null = typeof getHandle === 'function' ? getHandle.call(dirItem) : null;
  const entry = dirItem.webkitGetAsEntry() as FileSystemDirectoryEntry;
  openDropped(handleP, entry);
}, true);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function openDropped(handleP: Promise<any> | null, entry: FileSystemDirectoryEntry) {
  try {
    const handle = handleP ? await handleP : null;
    if (handle?.kind === 'directory') {
      // Un dossier déposé est lisible tout de suite, mais Chrome n'accorde l'écriture qu'après un clic :
      // si la demande échoue ici, on propose le bouton « Autoriser l'enregistrement ».
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

$('btn-allow').onclick = async () => {
  const h = pendingWrite;
  if (!h) return;
  try {
    if (!(await ensurePermission(h))) { toast('Permission refusée : les montages restent gardés dans le navigateur.'); return; }
  } catch (e) {
    toast(`Autorisation impossible : ${(e as Error).message}`, 10000);
    return;
  }
  folder = h;
  pendingWrite = null;
  $('btn-allow').hidden = true;
  // tous les montages en mémoire (y compris ceux récupérés) sont écrits dans le dossier
  await flushSave();
  const cur = currentMontage();
  if (cur) cur.doc = clone(store.doc);
  try {
    for (const m of montages) await writeMontage(h, m);
    dropLocal(project);
    await save(true);
  } catch (e) {
    toast(`Échec de l'écriture : ${(e as Error).message}`, 12000);
    return;
  }
  renderRecent();
  toast(`Enregistrement activé : ${montages.length} montage(s) enregistré(s) dans ${h.name}/mosaique-montages.`, 6000);
};

$<HTMLInputElement>('dir-input').onchange = async (e) => {
  const input = e.target as HTMLInputElement;
  const files = [...(input.files ?? [])];
  input.value = '';
  if (!files.length) return;
  const name = files[0].webkitRelativePath.split('/')[0] || 'dossier';
  await loadProject(name, await readFileList(files), null);
};

// ------------------------------------------------------------------ dossiers récents

function ago(t: number): string {
  if (!t) return '';
  const d = Math.round((Date.now() - t) / 86400000);
  if (d <= 0) return 'aujourd’hui';
  if (d === 1) return 'hier';
  if (d < 30) return `il y a ${d} j`;
  return new Date(t).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });
}

async function renderRecent() {
  const list = await listRecent();
  const box = $('recent');
  box.replaceChildren(...list.map((p) => {
    const row = document.createElement('div');
    const isCurrent = p.name === project && !!(folder || pendingWrite);
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

// ------------------------------------------------------------------ montages du dossier

function refreshUsage() {
  usage = usageElsewhere(montages, currentFile);
  editor.render();
}
editor.usedElsewhere = (photo) => usage.get(photo) ?? [];

function warnIfUsedElsewhere(photo: string) {
  const others = usage.get(photo);
  if (others?.length) toast(`Attention : « ${photo} » est déjà utilisée dans ${others.map((n) => `« ${n} »`).join(', ')}.`, 7000);
}
editor.onPhotoPlaced = warnIfUsedElsewhere;

function renderMontages() {
  const box = $('montage-list');
  const sorted = [...montages].sort((a, b) => montageName(a).localeCompare(montageName(b), 'fr', { numeric: true }));
  box.replaceChildren(...sorted.map((m) => {
    const b = document.createElement('button');
    const isCur = m.file === currentFile;
    b.className = `montage-item${isCur ? ' current' : ''}`;
    const n = document.createElement('span');
    n.className = 'm-name';
    n.textContent = montageName(m);
    const meta = document.createElement('span');
    meta.className = 'm-meta';
    const doc = isCur ? store.doc : m.doc;
    const photos = new Set(Object.values(doc.crops).map((c) => c.photo)).size;
    meta.textContent = `${photos} photo${photos > 1 ? 's' : ''} · ${isCur ? 'ouvert' : ago(m.doc.updatedAt ?? m.doc.createdAt ?? 0)}`;
    b.title = `${montageName(m)}\n${m.file}`;
    b.append(n, meta);
    b.onclick = () => openMontage(m);
    return b;
  }));
  const input = $<HTMLInputElement>('montage-name');
  if (document.activeElement !== input) input.value = currentName();
  $<HTMLButtonElement>('btn-m-del').disabled = !montages.length;
  $('montage-info').textContent = folder
    ? `Enregistré dans ${folder.name}/mosaique-montages (historique et corbeille inclus). Le .zip contient aussi les photos originales.`
    : pendingWrite ? 'Pas encore enregistré dans le dossier : cliquer sur « Autoriser l’enregistrement ».' : 'Gardé dans le navigateur : ouvrir un dossier pour enregistrer les montages à côté des photos.';
}

async function openMontage(m: Montage) {
  if (m.file === currentFile) return;
  await flushSave();
  await snapshotCurrent();
  currentFile = m.file;
  setCurrentMontageFile(m.file);
  showDoc(clone(m.doc));
  refreshUsage();
  renderMontages();
  renderLibrary();
  if (folder) $('project-status').textContent = `${folder.name} › ${montageName(m)}`;
  toast(`Montage « ${montageName(m)} » ouvert.`, 2500);
}

/** Nouveau montage ; avec `generate`, mise en page générée avec les photos pas encore utilisées. */
async function createMontage(name: string, generate: boolean, base?: Doc) {
  await flushSave();
  await snapshotCurrent();
  const doc: Doc = base ? { ...clone(base), name, createdAt: Date.now() } : { ...newDoc(store.doc.settings), name, createdAt: Date.now() };
  const m: Montage = { file: uniqueFile(name, montages.map((x) => x.file)), doc };
  montages.push(m);
  currentFile = m.file;
  setCurrentMontageFile(m.file);
  showDoc(clone(doc));
  refreshUsage();
  if (generate && lib.photos.size) generateLayout(true);
  await save(true);
  renderMontages();
  renderLibrary();
}

$('btn-m-new').onclick = async () => {
  const name = nextDefaultName(montages);
  await createMontage(name, true);
  const free = Object.keys(store.doc.crops).length;
  toast(`« ${name} » créé${free ? ` avec ${free} photo(s) pas encore utilisée(s)` : ''}. Le renommer dans le champ « Nom du montage ».`, 6000);
  $<HTMLInputElement>('montage-name').select();
};

$('btn-m-dup').onclick = async () => {
  const name = uniqueName(`${currentName()} (copie)`, montages.map(montageName));
  await createMontage(name, false, store.doc);
  toast(`Copie enregistrée sous « ${name} ». Ses photos sont donc aussi signalées comme utilisées dans l’autre montage.`, 6000);
};

let deleteArmed = 0;
$('btn-m-del').onclick = async () => {
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
  if (folder) {
    try { await trashMontage(folder, { ...m, doc: clone(store.doc) }); } catch (e) {
      toast(`Suppression impossible : ${(e as Error).message}`, 10000);
      return;
    }
  }
  montages = montages.filter((x) => x !== m);
  if (project) removeLocal(montageKey(project, m.file));
  const name = montageName(m);
  const next = [...montages].sort((a, c) => (c.doc.updatedAt ?? 0) - (a.doc.updatedAt ?? 0))[0];
  currentFile = '';
  if (next) await openMontage(next);
  else await createMontage(nextDefaultName([]), lib.photos.size > 0);
  refreshUsage();
  renderMontages();
  toast(folder
    ? `« ${name} » supprimé (une copie reste dans ${folder.name}/mosaique-montages/.corbeille).`
    : `« ${name} » supprimé.`, 8000);
};

async function renameCurrent(raw: string) {
  const m = currentMontage();
  const name = raw.trim();
  if (!m || !name || name === montageName(m)) { renderMontages(); return; }
  const unique = uniqueName(name, montages.filter((x) => x !== m).map(montageName));
  await flushSave();
  const newFile = uniqueFile(unique, montages.filter((x) => x !== m).map((x) => x.file));
  store.doc.name = unique;
  const doc = clone(store.doc);
  try {
    if (folder) await renameMontageFile(folder, { file: m.file, doc }, newFile);
  } catch (e) {
    toast(`Renommage impossible : ${(e as Error).message}`, 10000);
    return;
  }
  saveLocal(doc, montageKey(project, newFile));
  if (project && newFile !== m.file) removeLocal(montageKey(project, m.file));
  m.file = newFile;
  m.doc = doc;
  currentFile = newFile;
  setCurrentMontageFile(newFile);
  refreshUsage();
  renderMontages();
  if (folder) $('project-status').textContent = `${folder.name} › ${unique}`;
  toast(`Montage renommé en « ${unique} ».`, 3000);
}
const nameInput = $<HTMLInputElement>('montage-name');
nameInput.onchange = () => renameCurrent(nameInput.value);
nameInput.onkeydown = (e) => {
  if (e.key === 'Enter') nameInput.blur();
  if (e.key === 'Escape') { nameInput.value = currentName(); nameInput.blur(); }
};

// ------------------------------------------------------------------ export / import de montages

const fileSafe = (s: string) => s.replace(/[\\/:*?"<>|]/g, '-');

$('btn-m-json').onclick = async () => {
  await flushSave();
  download(new Blob([montageJson(store.doc, lib)], { type: 'application/json' }), `${fileSafe(currentName())}.mosaique.json`);
  toast('Montage exporté (.json). Pour le rouvrir avec ses photos sur un autre ordinateur, préférer l’export .zip.', 6000);
};

$('btn-m-zip').onclick = async () => {
  await flushSave();
  try {
    const { blob, missing } = await montageZip(store.doc, lib, (d, t) => toast(`Préparation du zip : photo ${d}/${t}…`, 0));
    const name = `${fileSafe(currentName())}.mosaique.zip`;
    download(blob, name);
    toast(`${name} · ${(blob.size / 1e6).toFixed(1)} Mo${missing.length ? ` · ${missing.length} photo(s) introuvable(s), non incluse(s)` : ''}.`, 8000);
  } catch (e) {
    toast(`Échec de l'export : ${(e as Error).message}`, 10000);
  }
};

async function folderHas(name: string): Promise<boolean> {
  if (!folder) return false;
  try { await folder.getFileHandle(name); return true; } catch { return false; }
}

/** Le montage ouvert est vide (aucune coupe, aucune photo) : on le retire, il ne contient rien à perdre. */
async function discardIfEmpty() {
  const m = currentMontage();
  if (!m || store.doc.root.children || Object.keys(store.doc.crops).length) return;
  clearTimeout(saveTimer);
  savePending = false;
  montages = montages.filter((x) => x !== m);
  if (project) removeLocal(montageKey(project, m.file));
  if (folder) {
    try { await (await folder.getDirectoryHandle('mosaique-montages')).removeEntry(m.file); } catch { /* jamais écrit */ }
  }
  currentFile = '';
}

/** Importe un montage (.json ou .zip) comme nouveau montage du dossier. Rien n'est écrasé. */
async function importMontage(file: File) {
  try {
    toast(`Import de « ${file.name} »…`, 0);
    const { doc, photos } = await readImport(file);
    // photos du zip : on réutilise celles déjà présentes, on renomme celles qui entreraient en conflit
    const renames = new Map<string, string>();
    const added: File[] = [];
    for (const f of photos) {
      const existing = lib.get(f.name);
      if (existing && existing.file.size === f.size) continue;
      let target = f.name;
      if (existing || (await folderHas(target))) {
        for (let i = 2; lib.get(target) || (await folderHas(target)); i++) target = f.name.replace(/(\.[^.]+)$/, ` (import ${i})$1`);
        renames.set(f.name, target);
      }
      added.push(target === f.name ? f : new File([f], target, { type: f.type }));
    }
    if (added.length) {
      await lib.addFiles(added);
      if (folder) for (const f of added) if (!(await folderHas(f.name))) await writeFile(folder, f.name, f);
    }
    await discardIfEmpty();
    const base = doc.name?.trim() || file.name.replace(/(\.mosaique)?\.(json|zip)$/i, '');
    const name = uniqueName(base, montages.map(montageName));
    await createMontage(name, false, remapPhotos(doc, renames));
    const missing = [...new Set(Object.values(store.doc.crops).map((c) => c.photo))].filter((p) => !lib.get(p));
    toast(`Montage « ${name} » importé${added.length ? `, ${added.length} photo(s) ajoutée(s)${folder ? ' au dossier' : ''}` : ''}`
      + `${renames.size ? ` (${renames.size} renommée(s) pour ne rien écraser)` : ''}`
      + `${missing.length ? `. ${missing.length} photo(s) introuvable(s) : importer plutôt le .zip, ou ouvrir le dossier qui les contient` : ''}.`, 12000);
  } catch (e) {
    toast(`Import impossible (« ${file.name} ») : ${(e as Error).message}`, 12000);
  }
}

$<HTMLInputElement>('import-input').onchange = async (e) => {
  const input = e.target as HTMLInputElement;
  const files = [...(input.files ?? [])];
  input.value = '';
  for (const f of files) await importMontage(f);
};

// ------------------------------------------------------------------ format & tailles préférées

function syncInputs() {
  const s = store.doc.settings;
  $<HTMLInputElement>('w').value = String(+(s.widthMm / 10).toFixed(2));
  $<HTMLInputElement>('h').value = String(+(s.heightMm / 10).toFixed(2));
  $<HTMLInputElement>('dpi').value = String(s.dpi);
  $<HTMLInputElement>('gutter').value = String(s.gutterMm);
  $<HTMLInputElement>('margin').value = String(s.marginMm);
  $<HTMLInputElement>('bg').value = s.bg;
  renderPresets();
  const px = pxForPrint(store.doc);
  const pxH = Math.round((s.heightMm / s.widthMm) * px);
  $('export-info').textContent = `Impression : ${px} × ${pxH} px (${s.widthMm / 10} × ${s.heightMm / 10} cm à ${s.dpi} dpi)`;
}

function renderPresets() {
  const s = store.doc.settings;
  const sel = $<HTMLSelectElement>('preset');
  const match = presets.findIndex((p) =>
    p.dpi === s.dpi &&
    ((p.widthMm === s.widthMm && p.heightMm === s.heightMm) || (p.widthMm === s.heightMm && p.heightMm === s.widthMm)));
  sel.replaceChildren(
    ...presets.map((p, i) => new Option(`${p.name} — ${p.widthMm / 10} × ${p.heightMm / 10} cm, ${p.dpi} dpi`, String(i))),
    new Option('Format personnalisé', '-1'),
  );
  sel.value = String(match);
  $<HTMLButtonElement>('btn-preset-del').disabled = match < 0;
}

function resize(widthMm: number, heightMm: number, dpi = store.doc.settings.dpi) {
  if (!(widthMm > 0 && heightMm > 0)) return;
  store.change((d) => {
    scaleTree(d.root, widthMm / d.settings.widthMm, heightMm / d.settings.heightMm);
    d.settings.widthMm = widthMm;
    d.settings.heightMm = heightMm;
    d.settings.dpi = dpi;
  });
}

/** Échange largeur et hauteur en transposant la mise en page (x ↔ y). */
function transpose(n: BspNode) {
  if (n.cut) {
    const { p, q } = n.cut;
    // la symétrie inverse les côtés : on échange p et q pour garder chaque photo dans sa case
    n.cut = { p: { x: q.y, y: q.x }, q: { x: p.y, y: p.x } };
  }
  n.children?.forEach(transpose);
}

$('preset').onchange = () => {
  const i = Number($<HTMLSelectElement>('preset').value);
  const p = presets[i];
  if (!p) return;
  const s = store.doc.settings;
  const portrait = s.heightMm > s.widthMm;
  const [w, h] = portrait ? [Math.min(p.widthMm, p.heightMm), Math.max(p.widthMm, p.heightMm)] : [Math.max(p.widthMm, p.heightMm), Math.min(p.widthMm, p.heightMm)];
  resize(w, h, p.dpi);
};
$('btn-preset-save').onclick = () => {
  const s = store.doc.settings;
  const input = $<HTMLInputElement>('preset-name');
  const name = input.value.trim() || `${s.widthMm / 10} × ${s.heightMm / 10}`;
  presets = presets.filter((p) => p.name !== name);
  presets.push({ name, widthMm: s.widthMm, heightMm: s.heightMm, dpi: s.dpi });
  savePresets(presets);
  input.value = '';
  renderPresets();
  toast(`Taille préférée « ${name} » enregistrée.`);
};
$('btn-preset-del').onclick = () => {
  const i = Number($<HTMLSelectElement>('preset').value);
  if (i < 0) return;
  const [p] = presets.splice(i, 1);
  savePresets(presets);
  renderPresets();
  toast(`« ${p.name} » retirée des tailles préférées.`);
};
$('btn-rotate').onclick = () => store.change((d) => {
  transpose(d.root);
  [d.settings.widthMm, d.settings.heightMm] = [d.settings.heightMm, d.settings.widthMm];
});
for (const id of ['w', 'h', 'dpi']) {
  $(id).onchange = () => resize(num('w') * 10, num('h') * 10, Math.max(72, num('dpi') || 300));
}
$('gutter').onchange = () => store.change((d) => { d.settings.gutterMm = Math.max(0, num('gutter')); });
$('margin').onchange = () => store.change((d) => { d.settings.marginMm = Math.max(0, num('margin')); });
$('bg').oninput = () => { store.doc.settings.bg = $<HTMLInputElement>('bg').value; editor.render(); };
$('bg').onchange = () => store.change((d) => { d.settings.bg = $<HTMLInputElement>('bg').value; });

// ------------------------------------------------------------------ mise en page

const genCount = $<HTMLInputElement>('gen-count');
$<HTMLInputElement>('gen-angle').value = '6';
$<HTMLInputElement>('gen-share').value = '35';
$<HTMLInputElement>('gen-min').value = String(DEFAULT_MIN_AREA_FRAC * 100);
genCount.value = '30';
let countTouched = false;
genCount.oninput = () => (countTouched = true);

function genInfo() {
  $('gen-info').textContent = `Obliquité ${num('gen-angle')}° sur ${num('gen-share')} % des coupes · plus petite case ≥ ${num('gen-min')} % de la moyenne · variante n° ${seed % 1000}`;
}
$('gen-angle').oninput = genInfo;
$('gen-share').oninput = genInfo;
$('gen-min').oninput = genInfo;

/** Photos à écarter : celles déjà placées dans un autre montage du dossier (si la case est cochée). */
const excluded = () => ($<HTMLInputElement>('gen-exclude').checked ? new Set(usage.keys()) : new Set<string>());

function generateLayout(newSeed = true) {
  if (newSeed) seed = Math.floor(Math.random() * 1e9);
  const count = Math.max(1, Math.min(120, num('gen-count') || lib.photos.size || 30));
  store.change((d) => applyGenerate(d, lib, {
    count, seed, obliquityDeg: num('gen-angle'), obliqueShare: num('gen-share') / 100, minAreaFrac: num('gen-min') / 100,
  }, excluded()));
  genInfo();
}
$('btn-gen').onclick = () => generateLayout(true);
$('btn-variant').onclick = () => { seed++; generateLayout(false); };
$('btn-fill').onclick = () => {
  let n = 0;
  store.change((d) => { n = fillEmpty(d, lib, excluded()); });
  store.dropNoopCheckpoint();
  toast(n ? `${n} photo(s) placée(s).` : 'Aucune case vide, ou plus aucune photo libre (non utilisée dans les autres montages).');
};
$('btn-blank').onclick = () => store.change((d) => { d.root = { id: 'r' }; d.crops = {}; });

// ------------------------------------------------------------------ photos

async function addFiles(files: File[], cellId: string | null = null) {
  const heic = files.filter((f) => /\.(heic|heif)$/i.test(f.name)).length;
  const { names, skipped } = await lib.addFiles(files, (d, t) => toast(`Chargement des photos ${d}/${t}…`, 0));
  if (folder) {
    // le dossier reste autonome : on y copie les photos venues d'ailleurs
    for (const n of names) {
      const p = lib.get(n);
      if (p && !(await folderHas(n))) await writeFile(folder, n, p.file);
    }
  }
  if (cellId && names[0]) {
    store.change((d) => { d.crops[cellId] = { photo: names[0], fx: 0.5, fy: 0.5, zoom: 1 }; });
    warnIfUsedElsewhere(names[0]);
  }
  toast(`${names.length} photo(s) ajoutée(s)${skipped.length ? `, ${skipped.length} ignorée(s)` : ''}${heic ? ' (HEIC non lus : glisser plutôt leur dossier sur la page pour obtenir la commande de conversion)' : ''}.`);
  if (!countTouched) genCount.value = String(lib.photos.size || 30);
}

editor.onDropFiles = (files, cellId) => addFiles(files, files.length === 1 ? cellId : null);
$<HTMLInputElement>('file-input').onchange = (e) => {
  const input = e.target as HTMLInputElement;
  addFiles([...(input.files ?? [])]);
  input.value = '';
};
const sidebar = $('sidebar');
sidebar.addEventListener('dragover', (e) => { if (e.dataTransfer?.types.includes('Files')) e.preventDefault(); });
sidebar.addEventListener('drop', (e) => {
  if (!e.dataTransfer?.files.length) return;
  e.preventDefault();
  addFiles([...e.dataTransfer.files]);
});

type LibFilter = 'all' | 'free' | 'here' | 'elsewhere';
let libFilter: LibFilter = 'all';
$('lib-filter').onclick = (e) => {
  const b = (e.target as HTMLElement).closest('button');
  if (!b) return;
  libFilter = b.dataset.f as LibFilter;
  $('lib-filter').querySelectorAll('button').forEach((x) => x.classList.toggle('active', x === b));
  renderLibrary();
};

function renderLibrary() {
  const here = new Set(Object.values(store.doc.crops).map((c) => c.photo));
  const box = $('library');
  const all = [...lib.photos.values()].sort((a, b) => a.name.localeCompare(b.name, 'fr', { numeric: true }));
  const keep = (n: string) =>
    libFilter === 'all' ? true
      : libFilter === 'free' ? !here.has(n) && !usage.has(n)
        : libFilter === 'here' ? here.has(n) : usage.has(n);
  const items = all.filter((p) => keep(p.name));
  box.replaceChildren(...items.map((p) => {
    const fig = document.createElement('figure');
    const others = usage.get(p.name) ?? [];
    fig.className = `${here.has(p.name) ? 'used' : ''}${others.length ? ' elsewhere' : ''}`;
    fig.draggable = true;
    fig.title = `${p.name} — ${p.w} × ${p.h}${here.has(p.name) ? ' · dans ce montage' : ''}`
      + `${others.length ? `\nDéjà utilisée dans : ${others.map((n) => `« ${n} »`).join(', ')}` : ''}`
      + '\nGlisser sur une case, ou cliquer pour la placer dans la case sélectionnée.';
    const img = document.createElement('img');
    img.src = p.url;
    img.loading = 'lazy';
    img.draggable = false;
    fig.appendChild(img);
    if (others.length) {
      const badge = document.createElement('span');
      badge.className = 'elsewhere-badge';
      badge.textContent = others.length > 1 ? `${others.length} autres` : 'ailleurs';
      fig.appendChild(badge);
    }
    fig.ondragstart = (e) => {
      e.dataTransfer!.setData(PHOTO_MIME, p.name);
      e.dataTransfer!.effectAllowed = 'copy';
    };
    fig.onclick = () => {
      const info = editor.cellInfo();
      if (!info) { toast('Sélectionner d’abord une case, ou glisser la photo dessus.'); return; }
      store.change((d) => { d.crops[info.id] = { photo: p.name, fx: 0.5, fy: 0.5, zoom: 1 }; });
      warnIfUsedElsewhere(p.name);
    };
    return fig;
  }));
  const free = all.filter((p) => !here.has(p.name) && !usage.has(p.name)).length;
  const elsewhere = all.filter((p) => usage.has(p.name)).length;
  $('photo-count').textContent = all.length
    ? `${all.length} · ${free} libre(s)${elsewhere ? ` · ${elsewhere} dans d’autres montages` : ''}`
    : '';
}

// ------------------------------------------------------------------ export image

async function runExport(kind: 'jpg' | 'png' | 'pdf' | 'screen') {
  const doc = store.doc;
  const width = kind === 'screen' ? Math.max(400, num('screen-w') || 2400) : pxForPrint(doc);
  const missing = Object.values(doc.crops).filter((c) => !lib.get(c.photo)).length;
  if (missing) toast(`${missing} photo(s) manquante(s) : leurs cases seront grises.`);
  const buttons = document.querySelectorAll<HTMLButtonElement>('#sidebar button');
  buttons.forEach((b) => (b.disabled = true));
  try {
    const canvas = await renderCanvas(doc, lib, width, (d, t) => toast(`Export : case ${d}/${t}…`, 0));
    toast('Encodage…', 0);
    const base = fileSafe(currentName());
    const size = `${doc.settings.widthMm / 10}x${doc.settings.heightMm / 10}cm`;
    let blob: Blob, name: string;
    if (kind === 'pdf') { blob = await toPdfBlob(canvas, doc); name = `${base}-${size}.pdf`; }
    else if (kind === 'png') { blob = await toImageBlob(canvas, 'image/png'); name = `${base}-${size}.png`; }
    else if (kind === 'screen') { blob = await toImageBlob(canvas, 'image/jpeg', 0.88); name = `${base}-ecran-${width}px.jpg`; }
    else { blob = await toImageBlob(canvas, 'image/jpeg', 0.93); name = `${base}-${size}-${doc.settings.dpi}dpi.jpg`; }
    download(blob, name);
    toast(`${name} · ${(blob.size / 1e6).toFixed(1)} Mo · ${canvas.width} × ${canvas.height} px`, 8000);
  } catch (e) {
    toast(`Échec de l'export : ${(e as Error).message}`, 10000);
  } finally {
    buttons.forEach((b) => (b.disabled = false));
    renderPresets();
    renderMontages();
  }
}
$<HTMLInputElement>('screen-w').value = '2400';
$('btn-jpg').onclick = () => runExport('jpg');
$('btn-png').onclick = () => runExport('png');
$('btn-pdf').onclick = () => runExport('pdf');
$('btn-screen').onclick = () => runExport('screen');
$('btn-svg').onclick = () => download(new Blob([layoutSvg(store.doc)], { type: 'image/svg+xml' }), `${fileSafe(currentName())}-trace.svg`);

// ------------------------------------------------------------------ plein écran

function setPresentation(on: boolean) {
  document.body.classList.toggle('presentation', on);
  $('exit-presentation').hidden = !on;
  if (on) {
    editor.sel = null;
    document.documentElement.requestFullscreen?.().catch(() => { /* reste en plein écran dans la fenêtre */ });
  } else if (document.fullscreenElement) {
    document.exitFullscreen().catch(() => { /* ignore */ });
  }
  requestAnimationFrame(() => editor.renderOverlay());
  renderToolbar();
}
$('btn-present').onclick = () => setPresentation(true);
$('exit-presentation').onclick = () => setPresentation(false);
document.addEventListener('fullscreenchange', () => {
  // Échap du navigateur : on quitte aussi le mode montage seul
  if (!document.fullscreenElement && document.body.classList.contains('presentation')) setPresentation(false);
});

// ------------------------------------------------------------------ barre d'outils

function renderToolbar() {
  $('mode-select').classList.toggle('active', editor.mode === 'select');
  $('mode-cut').classList.toggle('active', editor.mode === 'cut');
  $<HTMLButtonElement>('btn-undo').disabled = !store.canUndo;
  $<HTMLButtonElement>('btn-redo').disabled = !store.canRedo;
  const ctx = $('context');
  ctx.replaceChildren();
  // Aucun innerHTML : les noms de photos et de montages viennent de fichiers (éventuellement importés) et
  // sont toujours insérés comme texte.
  const btn = (label: string, key: string, title: string, fn: () => void) => {
    const b = document.createElement('button');
    const k = document.createElement('kbd');
    k.textContent = key;
    b.append(`${label} `, k);
    b.title = title;
    b.onclick = fn;
    ctx.appendChild(b);
  };
  const bold = (text: string, low: boolean) => {
    const b = document.createElement('b');
    if (low) b.className = 'low';
    b.textContent = text;
    return b;
  };
  const info = editor.cellInfo();
  if (info) {
    const span = document.createElement('span');
    span.className = 'ctx-info';
    if (!info.photo) span.textContent = 'Case vide : glisser une photo dessus';
    else if (info.missing) span.textContent = `${info.photo} · introuvable`;
    else {
      const others = usage.get(info.photo) ?? [];
      span.append(`${info.photo} · `, bold(`${info.dpi} dpi`, info.dpi! < 150));
      if (others.length) span.append(' · ', bold(`aussi dans ${others.map((n) => `« ${n} »`).join(', ')}`, true));
      span.title = 'Résolution effective à l’impression (au moins 150 dpi conseillé)';
    }
    ctx.appendChild(span);
    if (info.photo) {
      btn('Recentrer', '0', 'Recadrage par défaut (0 ou double-clic)', () => editor.resetCrop());
      btn('Retirer', '⌫', 'Retirer la photo de la case (Suppr)', () => editor.deleteSelection());
    }
  } else if (editor.sel?.kind === 'cut') {
    btn('Redresser', 'R', 'Rendre la coupe horizontale ou verticale (R)', () => editor.straightenSelected());
    btn('Supprimer la coupe', '⌫', 'Fusionner les cases de part et d’autre (Suppr)', () => editor.deleteSelection());
  }
  updateHelp();
}
editor.onUi = renderToolbar;
$('mode-select').onclick = () => editor.setMode('select');
$('mode-cut').onclick = () => editor.setMode('cut');
$('btn-undo').onclick = () => store.undo();
$('btn-redo').onclick = () => store.redo();

store.subscribe(() => { syncInputs(); renderLibrary(); renderToolbar(); });
lib.subscribe(() => renderLibrary());

// ------------------------------------------------------------------ clavier

window.addEventListener('keydown', (e) => {
  const t = e.target as HTMLElement;
  const k = e.key.toLowerCase();
  const mod = e.metaKey || e.ctrlKey;
  if (mod && k === 's') { e.preventDefault(); saveNow(); return; }
  if (t.matches('input, select, textarea')) return;
  if (mod && k === 'z') { e.preventDefault(); e.shiftKey ? store.redo() : store.undo(); return; }
  if (mod && k === 'y') { e.preventDefault(); store.redo(); return; }
  if (mod) return;
  if (document.body.classList.contains('presentation') && (k === 'escape' || k === 'p')) { setPresentation(false); return; }
  switch (k) {
    case 'v': editor.setMode('select'); break;
    case 'c': editor.setMode('cut'); break;
    case 'escape': toast(''); editor.sel = null; editor.setMode('select'); break;
    case 'delete': case 'backspace': e.preventDefault(); editor.deleteSelection(); break;
    case 'r': editor.straightenSelected(); break;
    case '0': editor.resetCrop(); break;
    case 'g': e.shiftKey ? $('btn-variant').click() : $('btn-gen').click(); break;
    case 'f': $('btn-fill').click(); break;
    case 'a': $<HTMLInputElement>('file-input').click(); break;
    case 'o': $('btn-open').click(); break;
    case 'e': $('btn-jpg').click(); break;
    case 'n': $('btn-m-new').click(); break;
    case 'p': setPresentation(true); break;
  }
});

// Fermer l'onglet : on enregistre ce qui est en attente (au moins dans le navigateur).
window.addEventListener('pagehide', () => { if (savePending) saveLocal(store.doc, montageKey(project, currentFile)); });

// ------------------------------------------------------------------ démarrage

syncInputs();
renderToolbar();
genInfo();
if (!saved) {
  // toute première ouverture : une mise en page d'exemple pour voir tout de suite le principe
  store.doc.name = 'Montage 1';
  generateLayout(true);
  store.replace(store.doc);
}
// Sans dossier ouvert, le montage affiché est le seul de la liste (gardé dans le navigateur).
if (!store.doc.name) store.doc.name = 'Montage 1';
if (!currentFile) currentFile = uniqueFile(store.doc.name, []);
montages = [{ file: currentFile, doc: clone(store.doc) }];
renderMontages();
renderLibrary();
renderRecent();
if (project) {
  // onglet rechargé : le montage est là, mais Chrome demande un clic pour relire les photos du dossier
  $('project-status').textContent = `${project} · cliquer sur le dossier ci-dessous pour recharger ses photos`;
}
