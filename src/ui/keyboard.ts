// Raccourcis clavier. Inactifs pendant la saisie dans un champ (sauf curseurs et cases à cocher).

import { nextPage, toggleSpreadView } from './album';
import { $ } from './dom';
import type { Panels } from './panels';
import { saveNow } from './persistence';
import { toggleRulers } from './rulers';
import { editor, store } from './state';
import { inPresentation, setPresentation } from './toolbar';
import { toast } from './toast';

/** Touches simples (sans ⌘) → action. */
function letterActions(panels: Panels): Record<string, (e: KeyboardEvent) => void> {
  const click = (id: string) => () => $(id).click();
  return {
    v: () => editor.setMode('select'),
    c: () => editor.setMode('cut'),
    escape: () => { toast(''); editor.sel = null; editor.setMode('select'); },
    delete: (e) => { e.preventDefault(); editor.deleteSelection(); },
    backspace: (e) => { e.preventDefault(); editor.deleteSelection(); },
    r: (e) => (e.shiftKey ? toggleRulers() : editor.straightenSelected()),
    0: () => editor.resetCrop(),
    g: (e) => $(e.shiftKey ? 'btn-variant' : 'btn-gen').click(),
    f: click('btn-fill'),
    a: click('file-input'),
    o: click('btn-open'),
    e: click('btn-jpg'),
    n: click('btn-m-new'),
    p: () => setPresentation(true),
    m: () => panels.toggleLeft(),
    b: () => panels.toggleRight(),
    tab: (e) => { e.preventDefault(); panels.toggleAll(); },
    d: () => toggleSpreadView(),
    '[': () => nextPage(-1),
    ']': () => nextPage(1),
    pageup: (e) => { e.preventDefault(); nextPage(-1); },
    pagedown: (e) => { e.preventDefault(); nextPage(1); },
  };
}

export function initKeyboard(panels: Panels) {
  const actions = letterActions(panels);
  window.addEventListener('keydown', (e) => {
    const k = e.key.toLowerCase();
    const mod = e.metaKey || e.ctrlKey;
    if (mod && k === 's') { e.preventDefault(); saveNow(); return; }
    if ((e.target as HTMLElement).matches('input:not([type=range]):not([type=checkbox]), select, textarea')) return;
    if (mod && k === 'z') { e.preventDefault(); e.shiftKey ? store.redo() : store.undo(); return; }
    if (mod && k === 'y') { e.preventDefault(); store.redo(); return; }
    if (mod) return;
    // vue : Espace maintenue pour se déplacer, + / − pour zoomer, ⇧1 pour la vue d'ensemble
    if (e.code === 'Space') {
      e.preventDefault(); // sinon Espace « clique » le dernier bouton utilisé
      if (document.activeElement instanceof HTMLButtonElement) document.activeElement.blur();
      if (!e.repeat) editor.setSpaceHeld(true);
      return;
    }
    if (e.code === 'Digit1' && e.shiftKey) { e.preventDefault(); editor.fitView(); return; }
    if (k === '+' || k === '=') { editor.zoomBy(1.25); return; }
    if (k === '-' || k === '_') { editor.zoomBy(0.8); return; }
    if (inPresentation() && (k === 'escape' || k === 'p')) { setPresentation(false); return; }
    actions[k]?.(e);
  });
  window.addEventListener('keyup', (e) => { if (e.code === 'Space') editor.setSpaceHeld(false); });
  window.addEventListener('blur', () => editor.setSpaceHeld(false));
}
