// Barre d'outils (modes, annuler, informations de la sélection), aide, plein écran et zoom de la vue.

import type { TextBox } from '../types';
import { $ } from './dom';
import { editor, store, usedElsewhere } from './state';

const HELP = {
  cut: 'Clic : coupe droite au point cliqué · Glisser : coupe libre (aimantée H/V, ⇧ force H/V, ⌥ angle libre) · Échap : sélection · ⌘+molette : zoom de la vue · Espace+glisser : se déplacer',
  select: 'Glisser une photo : recadrer · Molette : zoom photo · Double-clic : recentrer · ⇧+glisser : échanger · ⌘+molette ou pincer : zoom de la vue · Espace+glisser : se déplacer · ⇧1 : vue d’ensemble',
};

/** Bouton contextuel. Aucun innerHTML : les noms viennent de fichiers (éventuellement importés), insérés comme texte. */
function contextButton(label: string, key: string, title: string, fn: () => void): HTMLButtonElement {
  const b = document.createElement('button');
  const k = document.createElement('kbd');
  k.textContent = key;
  b.append(`${label} `, k);
  b.title = title;
  b.onclick = fn;
  return b;
}

function bold(text: string, low: boolean): HTMLElement {
  const b = document.createElement('b');
  if (low) b.className = 'low';
  b.textContent = text;
  return b;
}

/** Bouton à bascule (gras, alignement, bandeau). */
function toggle(label: string, title: string, on: boolean, fn: () => void): HTMLButtonElement {
  const b = document.createElement('button');
  b.textContent = label;
  b.title = title;
  b.classList.toggle('on', on);
  b.onclick = fn;
  return b;
}

/** Réglages du texte sélectionné : taille, gras, alignement, couleur, bandeau. */
function textItems(t: TextBox): HTMLElement[] {
  const size = document.createElement('input');
  size.type = 'number';
  size.min = '4';
  size.max = '400';
  size.value = String(t.sizePt);
  size.className = 'ctx-num';
  size.title = 'Taille du texte (points)';
  size.onchange = () => { const v = Number(size.value); if (v >= 4 && v <= 400) editor.updateText({ sizePt: v }); };
  const color = document.createElement('input');
  color.type = 'color';
  color.className = 'ctx-color';
  color.value = /^#[0-9a-f]{6}$/i.test(t.color) ? t.color : '#ffffff';
  color.title = 'Couleur du texte';
  color.onchange = () => editor.updateText({ color: color.value });
  return [
    size,
    toggle('G', 'Gras', !!t.bold, () => editor.updateText({ bold: !t.bold })),
    toggle('⇤', 'Aligner à gauche', t.align === 'left', () => editor.updateText({ align: 'left' })),
    toggle('≡', 'Centrer', t.align === 'center', () => editor.updateText({ align: 'center' })),
    toggle('⇥', 'Aligner à droite', t.align === 'right', () => editor.updateText({ align: 'right' })),
    color,
    toggle('▬ Bandeau', 'Fond sombre semi-transparent derrière le texte', !!t.bg, () => editor.updateText({ bg: t.bg ? undefined : 'rgba(0, 0, 0, 0.45)' })),
    contextButton('Modifier', '↵', 'Modifier le texte (double-clic ou Entrée)', () => editor.editText(t.id)),
    contextButton('Supprimer', '⌫', 'Supprimer ce texte (Suppr)', () => editor.deleteSelection()),
  ];
}

/** Infos et actions de la case, de la coupe ou du texte sélectionné. */
function contextItems(): HTMLElement[] {
  const text = editor.textInfo();
  if (text) return textItems(text);
  const info = editor.cellInfo();
  if (info) {
    const span = document.createElement('span');
    span.className = 'ctx-info';
    if (!info.photo) span.textContent = 'Case vide : glisser une photo dessus';
    else if (info.missing) span.textContent = `${info.photo} · introuvable`;
    else {
      const others = usedElsewhere(info.photo);
      span.append(`${info.photo} · `, bold(`${info.dpi} dpi`, info.dpi! < 150));
      if ((info.uses ?? 1) > 1) span.append(' · ', bold(`${info.uses}× ${store.doc.album ? 'sur cette page' : 'dans ce montage'}`, true));
      if (others.length) span.append(' · ', bold(`aussi dans ${others.map((n) => `« ${n} »`).join(', ')}`, true));
      span.title = 'Résolution effective à l’impression (au moins 150 dpi conseillé)';
    }
    return info.photo
      ? [span,
        contextButton('Recentrer', '0', 'Recadrage par défaut (0 ou double-clic)', () => editor.resetCrop()),
        contextButton('Retirer', '⌫', 'Retirer la photo de la case (Suppr)', () => editor.deleteSelection())]
      : [span];
  }
  if (editor.sel?.kind === 'cut') {
    return [
      contextButton('Redresser', 'R', 'Rendre la coupe horizontale ou verticale (R)', () => editor.straightenSelected()),
      contextButton('Supprimer la coupe', '⌫', 'Fusionner les cases de part et d’autre (Suppr)', () => editor.deleteSelection()),
    ];
  }
  return [];
}

export function renderToolbar() {
  $('mode-select').classList.toggle('active', editor.mode === 'select');
  $('mode-cut').classList.toggle('active', editor.mode === 'cut');
  $<HTMLButtonElement>('btn-undo').disabled = !store.canUndo;
  $<HTMLButtonElement>('btn-redo').disabled = !store.canRedo;
  $('context').replaceChildren(...contextItems());
  $('context').classList.toggle('text-ctx', !!editor.textInfo());
  $('help').textContent = HELP[editor.mode];
}

/** Plein écran : le montage seul, sans volets ni barre d'outils. */
export function setPresentation(on: boolean) {
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

export const inPresentation = () => document.body.classList.contains('presentation');

export function initToolbar() {
  editor.onUi = renderToolbar;
  $('mode-select').onclick = () => editor.setMode('select');
  $('mode-cut').onclick = () => editor.setMode('cut');
  $('btn-text').onclick = () => editor.addText();
  $('btn-undo').onclick = () => store.undo();
  $('btn-redo').onclick = () => store.redo();
  $('btn-present').onclick = () => setPresentation(true);
  $('exit-presentation').onclick = () => setPresentation(false);
  document.addEventListener('fullscreenchange', () => {
    // Échap du navigateur : on quitte aussi le mode montage seul
    if (!document.fullscreenElement && inPresentation()) setPresentation(false);
  });
  // zoom de la vue
  editor.onView = (z) => { $('zoom-level').textContent = `${Math.round(z * 100)} %`; };
  $('zoom-in').onclick = () => editor.zoomBy(1.25);
  $('zoom-out').onclick = () => editor.zoomBy(0.8);
  $('zoom-level').onclick = () => editor.fitView();
  editor.onView(editor.viewZoom);
}
