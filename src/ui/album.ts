// Album : création, bande de pages (vignettes groupées par double page), navigation, ajout, copie,
// suppression et déplacement de pages. La page ouverte est éditée comme un montage ordinaire.

import { pageSvg } from '../render/thumb';
import {
  albumPages, duplicatePage, goToPage, insertPage, isAlbum, movePage, pageCount, pageDoc, pageIndex, pageLabel,
  removePage, setPages, spreadOf, spreads, toAlbum,
} from '../storage/album';
import { distribute } from '../layout/album';
import { layoutPhotos } from '../layout/edit';
import { pref } from '../storage/local';
import { newDoc } from '../storage/doc';
import { uniqueName, montageName } from '../storage/montages';
import { $, num } from './dom';
import { avoidOthers, genParams } from './layout';
import { createMontage, renderMontages } from './montages';
import { app, editor, lib, store } from './state';
import { toast } from './toast';

/** Change de page sans point d'annulation (⌘Z annule les modifications, pas la navigation). */
export function goPage(i: number) {
  if (!isAlbum(store.doc) || i === pageIndex(store.doc)) return;
  if (i < 0 || i >= pageCount(store.doc)) return;
  goToPage(store.doc, i);
  store.emit();
}

export const nextPage = (step: number) => goPage(pageIndex(store.doc) + step);

/** Nouvel album : la couverture seule ; les pages s'ajoutent ensuite (« + », ou en répartissant les photos). */
export async function newAlbum() {
  const base = newDoc(store.doc.settings);
  // réglages d'impression habituels des services d'album (à vérifier sur le site choisi)
  if (!base.settings.bleedMm) base.settings.bleedMm = 3;
  if (!base.settings.safeMm) base.settings.safeMm = 5;
  toAlbum(base, 1);
  const name = uniqueName('Album', app.montages.map(montageName));
  await createMontage(name, false, base);
  toast(`« ${name} » créé avec sa couverture. Ajouter des pages avec « + » au bout de la bande de pages, ou « Répartir les photos » pour en créer autant que nécessaire.`, 9000);
}

// ------------------------------------------------------------------ bande de pages

const thumbCache = new Map<number, { key: string; svg: SVGSVGElement }>();
let renderTimer = 0;
let dragFrom = -1;

function thumb(i: number): SVGSVGElement {
  const d = pageDoc(store.doc, i);
  const key = JSON.stringify([d.settings, d.root, d.crops, d.texts, lib.photos.size]);
  const hit = thumbCache.get(i);
  if (hit?.key === key) return hit.svg;
  const svg = pageSvg(d, lib);
  thumbCache.set(i, { key, svg });
  return svg;
}

// ------------------------------------------------------------------ double page

let spreadView = pref.get('mosaique.spread') !== '0';
const neighborCache = new Map<number, { key: string; svg: SVGSVGElement }>();

/** Page en vis-à-vis de la page ouverte (même double page), pour l'éditeur. */
function neighbor() {
  if (!spreadView || !isAlbum(store.doc)) return null;
  const cur = pageIndex(store.doc);
  const sp = spreadOf(pageCount(store.doc), cur);
  if (sp.length < 2) return null;
  const other = sp[0] === cur ? sp[1] : sp[0];
  const d = pageDoc(store.doc, other);
  const key = JSON.stringify([d.settings, d.root, d.crops, d.texts, lib.photos.size]);
  let hit = neighborCache.get(other);
  if (hit?.key !== key) {
    hit = { key, svg: pageSvg(d, lib) };
    neighborCache.set(other, hit);
  }
  return { svg: hit.svg, side: (other > cur ? 1 : -1) as 1 | -1, label: pageLabel(other), open: () => goPage(other) };
}

function setSpreadView(on: boolean) {
  spreadView = on;
  pref.set('mosaique.spread', on ? '1' : '0');
  $('page-spread').classList.toggle('active', on);
  editor.render();
}

export const toggleSpreadView = () => { if (isAlbum(store.doc)) setSpreadView(!spreadView); };

function pageButton(i: number, current: number): HTMLElement {
  const b = document.createElement('button');
  b.className = `page-thumb${i === current ? ' current' : ''}`;
  b.draggable = i > 0; // la couverture reste en tête
  const s = store.doc.settings;
  b.style.aspectRatio = `${s.widthMm} / ${s.heightMm}`;
  const n = new Set(Object.values(albumPages(store.doc)[i].crops).map((c) => c.photo)).size;
  b.title = `${pageLabel(i)} · ${n} photo${n > 1 ? 's' : ''}${i > 0 ? '\nGlisser pour déplacer la page' : ''}`;
  b.appendChild(thumb(i));
  b.onclick = () => goPage(i);
  b.ondragstart = (e) => { dragFrom = i; e.dataTransfer!.effectAllowed = 'move'; e.dataTransfer!.setData('text/plain', String(i)); };
  b.ondragover = (e) => { if (dragFrom > 0 && i > 0) { e.preventDefault(); b.classList.add('drop'); } };
  b.ondragleave = () => b.classList.remove('drop');
  b.ondrop = (e) => {
    e.preventDefault();
    b.classList.remove('drop');
    const from = dragFrom;
    dragFrom = -1;
    if (from > 0 && i > 0 && from !== i) {
      store.change((d) => movePage(d, from, i));
      thumbCache.clear();
      toast(`${pageLabel(from)} déplacée en ${pageLabel(i)}.`, 2500);
    }
  };
  b.ondragend = () => { dragFrom = -1; };
  return b;
}

/** Ajoute une page vide en fin d'album et l'ouvre. */
function addPageAtEnd() {
  store.change((d) => insertPage(d, pageCount(d)));
  thumbCache.clear();
}

/** Case « + » au bout de la bande : l'album grandit au fur et à mesure. */
function addTile(): HTMLElement {
  const g = document.createElement('div');
  g.className = 'spread';
  const b = document.createElement('button');
  b.className = 'page-add-tile';
  b.textContent = '+';
  b.title = 'Ajouter une page à la fin de l’album';
  b.style.aspectRatio = `${store.doc.settings.widthMm} / ${store.doc.settings.heightMm}`;
  b.onclick = addPageAtEnd;
  const cap = document.createElement('span');
  cap.className = 'spread-cap';
  cap.textContent = 'Ajouter';
  g.append(b, cap);
  return g;
}

function renderPagesNow() {
  const album = isAlbum(store.doc);
  $('pages').hidden = !album;
  $('album-panel').hidden = !album;
  document.body.classList.toggle('album', album);
  renderMontages(); // titre « Album › p. 3 »
  if (!album) { thumbCache.clear(); return; }
  const n = pageCount(store.doc), cur = pageIndex(store.doc);
  for (const k of [...thumbCache.keys()]) if (k >= n) thumbCache.delete(k);
  $('page-strip').style.setProperty('--page-ratio', String(store.doc.settings.widthMm / store.doc.settings.heightMm));
  $('page-strip').replaceChildren(...spreads(n).map((sp) => {
    const g = document.createElement('div');
    g.className = `spread${sp.includes(cur) ? ' current' : ''}${sp.length === 1 && sp[0] > 0 ? (sp[0] % 2 ? ' right' : ' left') : ''}`;
    const pages = document.createElement('div');
    pages.className = 'spread-pages';
    pages.append(...sp.map((i) => pageButton(i, cur)));
    const cap = document.createElement('span');
    cap.className = 'spread-cap';
    cap.textContent = sp.length > 1 ? `${sp[0]}-${sp[1]}` : sp[0] === 0 ? 'Couv.' : String(sp[0]);
    g.append(pages, cap);
    return g;
  }), addTile());
  $('page-label').textContent = `${pageLabel(cur)} · ${n} pages`;
  renderDistInfo();
  $<HTMLButtonElement>('page-prev').disabled = cur === 0;
  $<HTMLButtonElement>('page-next').disabled = cur === n - 1;
  $<HTMLButtonElement>('page-del').disabled = n < 2;
  // garder la page ouverte visible dans la bande
  $('page-strip').querySelector('.page-thumb.current')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}

/** Rendu différé : la bande ne suit pas chaque mouvement de souris pendant un glisser. */
export function renderPages() {
  clearTimeout(renderTimer);
  renderTimer = window.setTimeout(renderPagesNow, 120);
}

// ------------------------------------------------------------------ répartition chronologique

const fmtDay = (t: number) => new Date(t).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });

/** Pages visées par la répartition (bornes saisies, ramenées à des valeurs possibles). */
/**
 * Pages visées par la répartition. « à la page » vide = automatique : autant de pages que nécessaire
 * pour les photos disponibles, à raison de (min + max) / 2 photos par page en moyenne.
 */
function distRange(): [number, number] {
  const from = Math.max(0, Math.min(199, Math.round(num('dist-from')) || 0));
  const toRaw = $<HTMLInputElement>('dist-to').value;
  if (toRaw !== '') return [from, Math.max(from, Math.min(199, Math.round(Number(toRaw))))];
  const perPage = Math.max(1, ((num('dist-min') || 1) + (num('dist-max') || 6)) / 2);
  const pagesFor = (n: number) => Math.max(1, Math.ceil(n / perPage));
  // d'abord toutes les pages à partir de `from`, puis la plage juste nécessaire
  let to = from + pagesFor(availablePhotos(from, 199).length) - 1;
  to = from + pagesFor(availablePhotos(from, to).length) - 1;
  return [from, Math.min(199, to)];
}

/** Photos à répartir : celles de la bibliothèque, sauf celles des pages hors plage (et des autres montages si demandé). */
function availablePhotos(from: number, to: number) {
  const outside = new Set<string>();
  albumPages(store.doc).forEach((p, i) => {
    if (i < from || i > to) for (const c of Object.values(p.crops)) outside.add(c.photo);
  });
  if (avoidOthers()) for (const name of app.usage.keys()) outside.add(name);
  return [...lib.photos.values()].filter((p) => !outside.has(p.name));
}

function renderDistInfo() {
  const toInput = $<HTMLInputElement>('dist-to');
  const [from, to] = distRange();
  if (toInput.value === '') toInput.placeholder = `auto (${to})`;
  const photos = availablePhotos(from, to);
  const n = to - from + 1;
  const undated = photos.filter((p) => !p.dateExif).length;
  const dates = photos.map((p) => p.date).filter(Boolean);
  $('dist-info').textContent = photos.length
    ? `${photos.length} photo(s) pour ${n} page(s), ${pageLabel(from)} à ${pageLabel(to)}${to >= pageCount(store.doc) ? ` (${to + 1 - pageCount(store.doc)} à ajouter)` : ''}${dates.length ? `, du ${fmtDay(Math.min(...dates))} au ${fmtDay(Math.max(...dates))}` : ''}.`
      + `${undated ? ` ${undated} sans date de prise de vue : rangée(s) selon la date du fichier.` : ''}`
    : 'Aucune photo libre pour ces pages : ajouter des photos, ou élargir la plage.';
  $('sum-album').textContent = `${pageCount(store.doc)} pages`;
}

function distributePhotos() {
  if (!isAlbum(store.doc)) return;
  const [from, to] = distRange();
  const n = to - from + 1;
  const photos = availablePhotos(from, to);
  if (!photos.length) { toast('Aucune photo à répartir : ajouter des photos, ou élargir la plage de pages.'); return; }
  const groups = distribute(photos, n, { min: num('dist-min') || 1, max: num('dist-max') || 6 });
  const params = genParams();
  const seed = Math.floor(Math.random() * 1e9);
  const layouts = groups.map((names, k) => {
    const list = names.map((name) => lib.get(name)!).filter(Boolean);
    return list.length ? layoutPhotos(store.doc.settings, list, { ...params, count: list.length, seed: seed + k * 7919 }) : { root: { id: 'r' }, crops: {} };
  });
  const added = Math.max(0, to + 1 - pageCount(store.doc));
  store.change((d) => setPages(d, from, layouts));
  thumbCache.clear();
  neighborCache.clear();
  const sizes = groups.map((g) => g.length);
  toast(`${photos.length} photo(s) réparties sur ${pageLabel(from)} à ${pageLabel(to)} (${Math.min(...sizes) === Math.max(...sizes) ? Math.min(...sizes) : `${Math.min(...sizes)} à ${Math.max(...sizes)}`} par page)`
    + `${added ? `, ${added} page(s) ajoutée(s)` : ''}. Chaque page se retouche ensuite ; ⌘Z annule tout.`, 9000);
}

let deleteArmed = 0;
function deletePage() {
  const b = $<HTMLButtonElement>('page-del');
  if (!isAlbum(store.doc) || pageCount(store.doc) < 2) return;
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
  const i = pageIndex(store.doc);
  store.change((d) => removePage(d, i));
  thumbCache.clear();
  toast(`${pageLabel(i)} supprimée (⌘Z pour la retrouver).`, 5000);
}

export function initAlbum() {
  $('btn-album-open').onclick = newAlbum;
  $('page-prev').onclick = () => nextPage(-1);
  $('page-next').onclick = () => nextPage(1);
  $('page-add').onclick = () => {
    const at = pageIndex(store.doc) + 1;
    store.change((d) => insertPage(d, at));
    thumbCache.clear();
  };
  $('page-dup').onclick = () => {
    store.change((d) => duplicatePage(d, pageIndex(d)));
    thumbCache.clear();
    toast('Page dupliquée : ses photos sont maintenant aussi signalées sur la copie.', 4000);
  };
  $('page-del').onclick = deletePage;
  $('btn-distribute').onclick = distributePhotos;
  for (const id of ['dist-from', 'dist-to', 'dist-min', 'dist-max', 'gen-exclude']) $(id).addEventListener('input', renderDistInfo);
  $('page-spread').onclick = toggleSpreadView;
  $('page-spread').classList.toggle('active', spreadView);
  editor.neighbor = neighbor;
  store.subscribe(renderPages);
  lib.subscribe(() => { thumbCache.clear(); neighborCache.clear(); renderPages(); });
  renderPagesNow();
  editor.render();
}
