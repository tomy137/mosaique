// Mise en page : disposition (moulinet, classique, au hasard), réglages de génération, générer / variante,
// remplir les cases vides, page vide.

import { applyGenerate, fillEmpty } from '../layout/edit';
import { DEFAULT_MIN_AREA_FRAC, type LayoutMode } from '../layout/generate';
import { pref } from '../storage/local';
import { $, num } from './dom';
import { app, lib, store } from './state';
import { toast } from './toast';

const MODE_KEY = 'mosaique.layoutMode';
const MODE_LABEL: Record<LayoutMode, string> = { pinwheel: 'Moulinet', classic: 'Classique', random: 'Disposition au hasard' };

let seed = Math.floor(Math.random() * 1e9);
/** Le nombre de cases suit le nombre de photos tant qu'on ne l'a pas modifié à la main. */
let countTouched = false;

const layoutMode = () => $<HTMLSelectElement>('gen-mode').value as LayoutMode;

/** Nombre de cases proposé : celui des photos chargées, sauf si on l'a choisi soi-même. */
export function suggestCount(n: number, force = false) {
  if (force) countTouched = false;
  if (!countTouched) $<HTMLInputElement>('gen-count').value = String(n || 30);
}

export function genInfo() {
  const mode = MODE_LABEL[layoutMode()];
  $('gen-info').textContent = `${mode} · obliquité ${num('gen-angle')}° sur ${num('gen-share')} % des coupes · plus petite case ≥ ${num('gen-min')} % de la moyenne · variante n° ${seed % 1000}`;
  $('sum-layout').textContent = `${mode} · ${num('gen-count')} cases`;
}

/** Photos à écarter : celles déjà placées dans un autre montage du dossier (si la case est cochée). */
const excluded = () => ($<HTMLInputElement>('gen-exclude').checked ? new Set(app.usage.keys()) : new Set<string>());

export function generateLayout(newSeed = true) {
  if (newSeed) seed = Math.floor(Math.random() * 1e9);
  const count = Math.max(1, Math.min(120, num('gen-count') || lib.photos.size || 30));
  store.change((d) => applyGenerate(d, lib, {
    count, seed, obliquityDeg: num('gen-angle'), obliqueShare: num('gen-share') / 100, minAreaFrac: num('gen-min') / 100,
    mode: layoutMode(),
  }, excluded()));
  genInfo();
}

function fillEmptyCells() {
  let n = 0;
  store.change((d) => { n = fillEmpty(d, lib, excluded()); });
  store.dropNoopCheckpoint();
  toast(n ? `${n} photo(s) placée(s).` : 'Aucune case vide, ou plus aucune photo libre (non utilisée dans les autres montages).');
}

export function initLayout() {
  $<HTMLInputElement>('gen-angle').value = '6';
  $<HTMLInputElement>('gen-share').value = '35';
  $<HTMLInputElement>('gen-min').value = String(DEFAULT_MIN_AREA_FRAC * 100);
  $<HTMLInputElement>('gen-count').value = '30';
  const mode = $<HTMLSelectElement>('gen-mode');
  mode.value = pref.get(MODE_KEY) ?? 'pinwheel';
  if (!mode.value) mode.value = 'pinwheel';
  mode.onchange = () => { pref.set(MODE_KEY, mode.value); genInfo(); };
  $('gen-count').oninput = () => { countTouched = true; genInfo(); };
  for (const id of ['gen-angle', 'gen-share', 'gen-min']) $(id).oninput = genInfo;
  $('btn-gen').onclick = () => generateLayout(true);
  $('btn-variant').onclick = () => { seed++; generateLayout(false); };
  $('btn-fill').onclick = fillEmptyCells;
  $('btn-blank').onclick = () => store.change((d) => { d.root = { id: 'r' }; d.crops = {}; });
}
