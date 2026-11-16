// Barre d'outils (modes, annuler, informations de la sélection), aide, plein écran et zoom de la vue.

import { $ } from './dom';
import { app, editor, store } from './state';

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

/** Infos et actions de la case ou de la coupe sélectionnée. */
function contextItems(): HTMLElement[] {
  const info = editor.cellInfo();
  if (info) {
    const span = document.createElement('span');
    span.className = 'ctx-info';
    if (!info.photo) span.textContent = 'Case vide : glisser une photo dessus';
    else if (info.missing) span.textContent = `${info.photo} · introuvable`;
    else {
      const others = app.usage.get(info.photo) ?? [];
      span.append(`${info.photo} · `, bold(`${info.dpi} dpi`, info.dpi! < 150));
      if ((info.uses ?? 1) > 1) span.append(' · ', bold(`${info.uses}× dans ce montage`, true));
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
