// Format de la page : tailles préférées, dimensions, orientation, gouttière, marge, fond.

import { forEachLine, scaleTree } from '../geometry/bsp';
import { pxForPrint } from '../render/export';
import { loadPresets, savePresets } from '../storage/presets';
import type { BspNode, FormatPreset } from '../types';
import { $, num } from './dom';
import { editor, store } from './state';
import { toast } from './toast';

let presets: FormatPreset[] = loadPresets();

/** Met à jour un champ, sauf celui qu'on est en train de modifier (on n'écrase pas la saisie). */
function setField(id: string, value: string) {
  const el = $<HTMLInputElement>(id);
  if (el !== document.activeElement && el.value !== value) el.value = value;
}

/** Recopie le format du document dans les champs, résumés et infos d'export. */
export function syncInputs() {
  const s = store.doc.settings;
  setField('w', String(+(s.widthMm / 10).toFixed(2)));
  setField('h', String(+(s.heightMm / 10).toFixed(2)));
  setField('dpi', String(s.dpi));
  setField('gutter', String(s.gutterMm));
  setField('margin', String(s.marginMm));
  setField('bg', s.bg);
  renderPresets();
  const px = pxForPrint(store.doc);
  const pxH = Math.round((s.heightMm / s.widthMm) * px);
  $('export-info').textContent = `Impression : ${px} × ${pxH} px (${s.widthMm / 10} × ${s.heightMm / 10} cm à ${s.dpi} dpi)`;
  $('sum-format').textContent = `${s.widthMm / 10} × ${s.heightMm / 10} cm · ${s.dpi} dpi`;
  $('sum-export').textContent = `${px} × ${pxH} px`;
}

export function renderPresets() {
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

/** Nouveau format : la mise en page est mise à l'échelle (les photos gardent leur cadrage relatif). */
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
  // la symétrie inverse les côtés : on échange p et q pour garder chaque photo dans sa case
  forEachLine(n, ({ p, q }, set) => set({ p: { x: q.y, y: q.x }, q: { x: p.y, y: p.x } }));
}

function applyPreset() {
  const p = presets[Number($<HTMLSelectElement>('preset').value)];
  if (!p) return;
  const s = store.doc.settings;
  const long = Math.max(p.widthMm, p.heightMm), short = Math.min(p.widthMm, p.heightMm);
  const portrait = s.heightMm > s.widthMm; // on garde l'orientation actuelle
  resize(portrait ? short : long, portrait ? long : short, p.dpi);
}

function savePreset() {
  const s = store.doc.settings;
  const input = $<HTMLInputElement>('preset-name');
  const name = input.value.trim() || `${s.widthMm / 10} × ${s.heightMm / 10}`;
  presets = presets.filter((p) => p.name !== name);
  presets.push({ name, widthMm: s.widthMm, heightMm: s.heightMm, dpi: s.dpi });
  savePresets(presets);
  input.value = '';
  renderPresets();
  toast(`Taille préférée « ${name} » enregistrée.`);
}

function deletePreset() {
  const i = Number($<HTMLSelectElement>('preset').value);
  if (i < 0) return;
  const [p] = presets.splice(i, 1);
  savePresets(presets);
  renderPresets();
  toast(`« ${p.name} » retirée des tailles préférées.`);
}

/**
 * Gouttière et marge s'appliquent en direct (frappe, flèches, molette), pas seulement en quittant le champ.
 * Un seul point d'annulation par modification ; une valeur incomplète en cours de frappe est ignorée.
 */
function liveSetting(id: string, key: 'gutterMm' | 'marginMm') {
  const el = $<HTMLInputElement>(id);
  let editing = false;
  el.addEventListener('input', () => {
    const v = parseFloat(el.value.replace(',', '.'));
    if (!Number.isFinite(v) || v < 0 || v > 200) return;
    if (!editing) { store.checkpoint(); editing = true; }
    store.doc.settings[key] = v;
    store.emit();
  });
  el.addEventListener('change', () => {
    editing = false;
    store.dropNoopCheckpoint();
    el.value = String(store.doc.settings[key]); // valeur réellement appliquée
  });
}

export function initFormat() {
  $('preset').onchange = applyPreset;
  $('btn-preset-save').onclick = savePreset;
  $('btn-preset-del').onclick = deletePreset;
  $('btn-rotate').onclick = () => store.change((d) => {
    transpose(d.root);
    [d.settings.widthMm, d.settings.heightMm] = [d.settings.heightMm, d.settings.widthMm];
  });
  // largeur, hauteur et dpi : appliqués à la validation, pour ne pas déformer le montage à chaque chiffre
  for (const id of ['w', 'h', 'dpi']) {
    $(id).onchange = () => resize(num('w') * 10, num('h') * 10, Math.max(72, num('dpi') || 300));
  }
  liveSetting('gutter', 'gutterMm');
  liveSetting('margin', 'marginMm');
  $('bg').oninput = () => { store.doc.settings.bg = $<HTMLInputElement>('bg').value; editor.render(); };
  $('bg').onchange = () => store.change((d) => { d.settings.bg = $<HTMLInputElement>('bg').value; });
}
