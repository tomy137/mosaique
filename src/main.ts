import './style.css';
import { scaleTree } from './geometry/bsp';
import { applyGenerate, fillEmpty } from './layout/edit';
import { DEFAULT_MIN_AREA_FRAC } from './layout/generate';
import { Library } from './photos/library';
import {
  ensurePermission, hasFsAccess, loadLocal, loadPresets, newDoc, pickFolder, PROJECT_FILE, readEntryFiles, readFileList, readFolder,
  currentProject, forgetRecent, listRecent, rememberHandle, saveLocal, savePresets, setCurrentProject, writeFile,
  type FolderContent, type RecentProject,
} from './project';
import { Editor, PHOTO_MIME } from './render/editor';
import { download, layoutSvg, pxForPrint, renderCanvas, toImageBlob, toPdfBlob } from './render/export';
import { Store } from './store';
import type { BspNode, Doc, FormatPreset } from './types';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const num = (id: string) => Number($<HTMLInputElement>(id).value);

// Chaque onglet a son projet (sessionStorage) et sa copie de secours : plusieurs projets en parallèle.
let project = currentProject();
const saved = loadLocal(project) ?? loadLocal();
const store = new Store(saved ?? newDoc());
const lib = new Library();
const editor = new Editor($('stage'), store, lib);

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

// ------------------------------------------------------------------ sauvegarde

let saveTimer = 0;
let savePending = false;
store.subscribe(() => {
  clearTimeout(saveTimer);
  savePending = true;
  saveTimer = window.setTimeout(() => save(store.doc), 600);
});

async function flushSave() {
  if (!savePending) return;
  clearTimeout(saveTimer);
  await save(store.doc);
}

async function save(doc: Doc) {
  savePending = false;
  saveLocal(doc, project);
  if (!folder) return;
  try {
    await writeFile(folder, PROJECT_FILE, JSON.stringify(doc, null, 1));
    $('project-status').textContent = `${folder.name}/${PROJECT_FILE} · enregistré ${new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`;
  } catch (e) {
    $('project-status').textContent = `Échec de l'enregistrement : ${(e as Error).message}`;
  }
}

// ------------------------------------------------------------------ dossier de projet

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
  let dir: string | null = null;
  try {
    const r = await fetch(`/api/locate?name=${encodeURIComponent(folderName)}&file=${encodeURIComponent(heic[0])}`);
    dir = (await r.json()).path ?? null;
  } catch { /* serveur sans l'API : commande générique */ }
  $('heic-cmd').textContent = heicCommand(dir);
  $('heic-after').textContent = (dir
    ? ''
    : `Chemin de « ${folderName} » introuvable automatiquement : remplacer la partie entre guillemets en glissant le dossier dans le Terminal. `)
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

/** Charge le contenu d'un dossier. `handle` est null en mode repli (sans accès en écriture). */
/**
 * Charge le contenu d'un dossier. `handle` : dossier accessible en écriture (sinon null).
 * `pending` : dossier lisible dont l'écriture reste à autoriser par un clic (dossier déposé dans Chrome).
 */
async function loadProject(name: string, content: FolderContent, handle: unknown | null, pending: unknown | null = null) {
  await flushSave(); // le projet précédent est enregistré avant de basculer
  folder = handle;
  pendingWrite = pending;
  $('btn-allow').hidden = !pending;
  project = name;
  setCurrentProject(name);
  const status = $('project-status');
  status.textContent = `${name} · chargement…`;
  lib.clear();
  store.replace(content.doc ?? newDoc(store.doc.settings));
  renderRecent();
  await lib.addFiles(content.images, (d, t) => (status.textContent = `${name} · photos ${d}/${t}`));
  status.textContent = handle
    ? `${name}/${PROJECT_FILE}`
    : pending ? `${name} · pas encore enregistré dans le dossier` : `${name} · sauvegarde dans le navigateur uniquement`;
  showHeicHelp(name, content.heic);

  if (!lib.photos.size) {
    toast(content.heic.length
      ? `Aucune photo lisible dans « ${name} » : uniquement des HEIC. La commande de conversion est dans le panneau Photos.`
      : `Aucune photo (JPEG, PNG, WebP…) trouvée dans « ${name} ».`, 20000);
    return;
  }
  let msg: string;
  if (!content.doc) {
    // nouveau projet : une case par photo, photos placées
    genCount.value = String(lib.photos.size);
    countTouched = false;
    generateLayout(true);
    msg = `${lib.photos.size} photo(s) chargée(s) et placée(s). « Variante » (⇧G) pour une autre mise en page.`;
  } else {
    msg = `Montage « ${name} » rouvert : ${lib.photos.size} photo(s).`;
    const used = new Set(Object.values(store.doc.crops).map((c) => c.photo));
    const fresh = [...lib.photos.keys()].filter((n) => !used.has(n)).length;
    if (fresh) {
      genCount.value = String(lib.photos.size);
      msg += ` ${fresh} photo(s) pas encore placée(s) : « Générer » (G) refait la mise en page avec toutes les photos.`;
    }
  }
  if (content.heic.length) msg += ` ${content.heic.length} photo(s) HEIC ignorée(s) : commande de conversion dans le panneau Photos.`;
  if (pending) msg += ' Pour enregistrer le montage dans le dossier, cliquer sur « Autoriser l’enregistrement dans le dossier » (en haut à gauche) : Chrome demande la permission une seule fois.';
  else if (!handle) msg += ' Ce navigateur (Safari, Firefox…) ne permet pas d’enregistrer dans le dossier : le montage est gardé dans le navigateur. Avec Chrome, il est enregistré dans le dossier.';
  toast(msg, content.heic.length || !handle ? 20000 : 8000);
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

// Glisser un dossier depuis le Finder sur la page = l'ouvrir comme projet (aucune fenêtre de choix).
window.addEventListener('dragover', (e) => {
  if (e.dataTransfer?.types.includes('Files')) e.preventDefault();
});
window.addEventListener('drop', (e) => {
  const items = [...(e.dataTransfer?.items ?? [])].filter((it) => it.kind === 'file');
  const dirItem = items.find((it) => it.webkitGetAsEntry()?.isDirectory);
  if (!dirItem) {
    // fichiers isolés hors de la zone de montage et de la bibliothèque : on les ajoute quand même
    if (e.dataTransfer?.files.length && !(e.target as Element).closest?.('svg, #sidebar')) {
      e.preventDefault();
      addFiles([...e.dataTransfer.files]);
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
    if (!(await ensurePermission(h))) { toast('Permission refusée : le montage reste gardé dans le navigateur.'); return; }
  } catch (e) {
    toast(`Autorisation impossible : ${(e as Error).message}`, 10000);
    return;
  }
  folder = h;
  pendingWrite = null;
  $('btn-allow').hidden = true;
  await save(store.doc);
  renderRecent();
  toast(`Enregistrement activé : le montage est enregistré dans ${h.name}/${PROJECT_FILE}.`, 6000);
};

$<HTMLInputElement>('dir-input').onchange = async (e) => {
  const input = e.target as HTMLInputElement;
  const files = [...(input.files ?? [])];
  input.value = '';
  if (!files.length) return;
  const name = files[0].webkitRelativePath.split('/')[0] || 'dossier';
  await loadProject(name, await readFileList(files), null);
};

// ------------------------------------------------------------------ projets récents

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
    open.title = isCurrent ? `${p.name} (projet ouvert) — cliquer pour le recharger` : `Ouvrir « ${p.name} »`;
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

function generateLayout(newSeed = true) {
  if (newSeed) seed = Math.floor(Math.random() * 1e9);
  const count = Math.max(1, Math.min(120, num('gen-count') || lib.photos.size || 30));
  store.change((d) => applyGenerate(d, lib, {
    count, seed, obliquityDeg: num('gen-angle'), obliqueShare: num('gen-share') / 100, minAreaFrac: num('gen-min') / 100,
  }));
  genInfo();
}
$('btn-gen').onclick = () => generateLayout(true);
$('btn-variant').onclick = () => { seed++; generateLayout(false); };
$('btn-fill').onclick = () => {
  let n = 0;
  store.change((d) => { n = fillEmpty(d, lib); });
  store.dropNoopCheckpoint();
  toast(n ? `${n} photo(s) placée(s).` : 'Aucune case vide ou aucune photo libre.');
};
$('btn-blank').onclick = () => store.change((d) => { d.root = { id: 'r' }; d.crops = {}; });

// ------------------------------------------------------------------ photos

async function addFiles(files: File[], cellId: string | null = null) {
  const heic = files.filter((f) => /\.(heic|heif)$/i.test(f.name)).length;
  const { names, skipped } = await lib.addFiles(files, (d, t) => toast(`Chargement des photos ${d}/${t}…`, 0));
  if (folder) {
    // le projet reste autonome : on copie dans le dossier les photos venues d'ailleurs
    for (const n of names) {
      const p = lib.get(n);
      if (p && !(await folderHas(n))) await writeFile(folder, n, p.file);
    }
  }
  if (cellId && names[0]) store.change((d) => { d.crops[cellId] = { photo: names[0], fx: 0.5, fy: 0.5, zoom: 1 }; });
  toast(`${names.length} photo(s) ajoutée(s)${skipped.length ? `, ${skipped.length} ignorée(s)` : ''}${heic ? ' (HEIC non lus : glisser plutôt leur dossier sur la page pour obtenir la commande de conversion)' : ''}.`);
  if (!countTouched) genCount.value = String(lib.photos.size || 30);
}

async function folderHas(name: string): Promise<boolean> {
  try { await folder.getFileHandle(name); return true; } catch { return false; }
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

function renderLibrary() {
  const used = new Map<string, number>();
  for (const c of Object.values(store.doc.crops)) used.set(c.photo, (used.get(c.photo) ?? 0) + 1);
  const box = $('library');
  const items = [...lib.photos.values()].sort((a, b) => a.name.localeCompare(b.name, 'fr', { numeric: true }));
  box.replaceChildren(...items.map((p) => {
    const fig = document.createElement('figure');
    fig.className = used.has(p.name) ? 'used' : '';
    fig.draggable = true;
    fig.title = `${p.name} — ${p.w} × ${p.h}${used.has(p.name) ? ' · utilisée' : ''}\nGlisser sur une case, ou cliquer pour la placer dans la case sélectionnée.`;
    const img = document.createElement('img');
    img.src = p.url;
    img.loading = 'lazy';
    img.draggable = false;
    fig.appendChild(img);
    fig.ondragstart = (e) => {
      e.dataTransfer!.setData(PHOTO_MIME, p.name);
      e.dataTransfer!.effectAllowed = 'copy';
    };
    fig.onclick = () => {
      const info = editor.cellInfo();
      if (!info) { toast('Sélectionner d’abord une case, ou glisser la photo dessus.'); return; }
      store.change((d) => { d.crops[info.id] = { photo: p.name, fx: 0.5, fy: 0.5, zoom: 1 }; });
    };
    return fig;
  }));
  const free = items.filter((p) => !used.has(p.name)).length;
  $('photo-count').textContent = items.length ? `${items.length} · ${free} libre(s)` : '';
}

// ------------------------------------------------------------------ export

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
    const base = folder ? folder.name : 'montage';
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
  }
}
$<HTMLInputElement>('screen-w').value = '2400';
$('btn-jpg').onclick = () => runExport('jpg');
$('btn-png').onclick = () => runExport('png');
$('btn-pdf').onclick = () => runExport('pdf');
$('btn-screen').onclick = () => runExport('screen');
$('btn-svg').onclick = () => download(new Blob([layoutSvg(store.doc)], { type: 'image/svg+xml' }), `${folder?.name ?? 'montage'}-trace.svg`);

// ------------------------------------------------------------------ barre d'outils

function renderToolbar() {
  $('mode-select').classList.toggle('active', editor.mode === 'select');
  $('mode-cut').classList.toggle('active', editor.mode === 'cut');
  $<HTMLButtonElement>('btn-undo').disabled = !store.canUndo;
  $<HTMLButtonElement>('btn-redo').disabled = !store.canRedo;
  const ctx = $('context');
  ctx.replaceChildren();
  const btn = (label: string, title: string, fn: () => void) => {
    const b = document.createElement('button');
    b.innerHTML = label;
    b.title = title;
    b.onclick = fn;
    ctx.appendChild(b);
  };
  const info = editor.cellInfo();
  if (info) {
    const span = document.createElement('span');
    span.className = 'ctx-info';
    if (!info.photo) span.textContent = 'Case vide : glisser une photo dessus';
    else if (info.missing) span.textContent = `${info.photo} · introuvable`;
    else {
      span.innerHTML = `${info.photo} · <b class="${info.dpi! < 150 ? 'low' : ''}">${info.dpi} dpi</b>`;
      span.title = 'Résolution effective à l’impression (au moins 150 dpi conseillé)';
    }
    ctx.appendChild(span);
    if (info.photo) {
      btn('Recentrer <kbd>0</kbd>', 'Recadrage par défaut (0 ou double-clic)', () => editor.resetCrop());
      btn('Retirer <kbd>⌫</kbd>', 'Retirer la photo de la case (Suppr)', () => editor.deleteSelection());
    }
  } else if (editor.sel?.kind === 'cut') {
    btn('Redresser <kbd>R</kbd>', 'Rendre la coupe horizontale ou verticale (R)', () => editor.straightenSelected());
    btn('Supprimer la coupe <kbd>⌫</kbd>', 'Fusionner les cases de part et d’autre (Suppr)', () => editor.deleteSelection());
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
  if (t.matches('input, select, textarea')) return;
  const k = e.key.toLowerCase();
  const mod = e.metaKey || e.ctrlKey;
  if (mod && k === 'z') { e.preventDefault(); e.shiftKey ? store.redo() : store.undo(); return; }
  if (mod && k === 'y') { e.preventDefault(); store.redo(); return; }
  if (mod) return;
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
  }
});

// ------------------------------------------------------------------ démarrage

syncInputs();
renderLibrary();
renderToolbar();
genInfo();
if (!saved) {
  // toute première ouverture : une mise en page d'exemple pour voir tout de suite le principe
  generateLayout(true);
  store.replace(store.doc);
}
renderRecent();
if (project) {
  // onglet rechargé : le montage est là, mais Chrome demande un clic pour relire les photos du dossier
  $('project-status').textContent = `${project} · cliquer sur le projet ci-dessous pour recharger ses photos`;
}
