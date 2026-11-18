// Bibliothèque de photos (volet de droite) : ajout, filtres, vignettes à glisser ou cliquer.

import { PHOTO_MIME, photoUses } from '../render/editor';
import { fileExists, writeFile } from '../storage/folder';
import { defaultCrop } from '../photos/crop';
import { $ } from './dom';
import { suggestCount } from './layout';
import { warnIfUsedElsewhere } from './montages';
import { app, editor, isUsedElsewhere, lib, store, usedElsewhere } from './state';
import { toast } from './toast';

type LibFilter = 'all' | 'free' | 'here' | 'elsewhere';
let filter: LibFilter = 'all';

/** Ajoute des photos ; avec `cellId`, la première est placée dans cette case. */
export async function addFiles(files: File[], cellId: string | null = null) {
  const heic = files.filter((f) => /\.(heic|heif)$/i.test(f.name)).length;
  const { names, skipped } = await lib.addFiles(files, (d, t) => toast(`Chargement des photos ${d}/${t}…`, 0));
  if (app.folder) {
    // le dossier reste autonome : on y copie les photos venues d'ailleurs
    for (const n of names) {
      const p = lib.get(n);
      if (p && !(await fileExists(app.folder, n))) await writeFile(app.folder, n, p.file);
    }
  }
  if (cellId && names[0]) placePhoto(cellId, names[0]);
  toast(`${names.length} photo(s) ajoutée(s)${skipped.length ? `, ${skipped.length} ignorée(s)` : ''}${heic ? ' (HEIC non lus : glisser plutôt leur dossier sur la page pour obtenir la commande de conversion)' : ''}.`);
  suggestCount(lib.photos.size);
}

function placePhoto(cellId: string, photo: string) {
  store.change((d) => { d.crops[cellId] = defaultCrop(photo); });
  warnIfUsedElsewhere(photo);
}

function thumbnail(p: { name: string; w: number; h: number; url: string }, here: Map<string, number>): HTMLElement {
  const others = usedElsewhere(p.name);
  const fig = document.createElement('figure');
  fig.className = `${here.has(p.name) ? 'used' : ''}${others.length ? ' elsewhere' : ''}`;
  fig.draggable = true;
  const uses = here.get(p.name) ?? 0;
  fig.title = `${p.name} — ${p.w} × ${p.h}${uses ? ` · ${uses > 1 ? `${uses} fois` : ''} dans ce montage` : ''}`
    + `${others.length ? `\nDéjà utilisée dans : ${others.map((n) => `« ${n} »`).join(', ')}` : ''}`
    + '\nGlisser sur une case, ou cliquer pour la placer dans la case sélectionnée.';
  const img = document.createElement('img');
  img.src = p.url;
  img.loading = 'lazy';
  img.draggable = false;
  const cap = document.createElement('figcaption'); // nom affiché sur les grandes miniatures
  cap.textContent = p.name;
  fig.append(img, cap);
  if (uses > 1) {
    const twin = document.createElement('span');
    twin.className = 'twin-badge';
    twin.textContent = `×${uses}`;
    fig.appendChild(twin);
  }
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
    placePhoto(info.id, p.name);
  };
  return fig;
}

export function renderLibrary() {
  const here = photoUses(store.doc.crops); // photo → nombre de cases de ce montage
  const all = [...lib.photos.values()].sort((a, b) => a.name.localeCompare(b.name, 'fr', { numeric: true }));
  const isFree = (n: string) => !here.has(n) && !isUsedElsewhere(n);
  const keep: Record<LibFilter, (n: string) => boolean> = {
    all: () => true, free: isFree, here: (n) => here.has(n), elsewhere: isUsedElsewhere,
  };
  $('library').replaceChildren(...all.filter((p) => keep[filter](p.name)).map((p) => thumbnail(p, here)));
  const free = all.filter((p) => isFree(p.name)).length;
  const elsewhere = all.filter((p) => isUsedElsewhere(p.name)).length;
  $('photo-count').textContent = all.length
    ? `${all.length} · ${free} libre(s)${elsewhere ? ` · ${elsewhere} ${store.doc.album ? 'ailleurs' : 'dans d’autres montages'}` : ''}`
    : '';
}

export function initLibrary() {
  editor.onDropFiles = (files, cellId) => addFiles(files, files.length === 1 ? cellId : null);
  $<HTMLInputElement>('file-input').onchange = (e) => {
    const input = e.target as HTMLInputElement;
    addFiles([...(input.files ?? [])]);
    input.value = '';
  };
  // des photos déposées sur l'un des deux volets sont ajoutées à la bibliothèque
  for (const panel of [$('sidebar'), $('photos')]) {
    panel.addEventListener('dragover', (e) => { if (e.dataTransfer?.types.includes('Files')) e.preventDefault(); });
    panel.addEventListener('drop', (e) => {
      if (!e.dataTransfer?.files.length) return;
      e.preventDefault();
      addFiles([...e.dataTransfer.files]);
    });
  }
  $('lib-filter').onclick = (e) => {
    const b = (e.target as HTMLElement).closest('button');
    if (!b) return;
    filter = b.dataset.f as LibFilter;
    $('lib-filter').querySelectorAll('button').forEach((x) => x.classList.toggle('active', x === b));
    renderLibrary();
  };
  lib.subscribe(renderLibrary);
}
