// Règles en centimètres le long du montage (en haut et à gauche), synchronisées avec le zoom et le déplacement.
// L'origine est le coin haut-gauche de la page ; un repère suit la position de la souris.

import type { Pt } from '../geometry/polygon';
import { pref } from '../storage/local';
import { $ } from './dom';
import { editor, store } from './state';

const PREF = 'mosaique.rulers';
const SIZE = 20; // épaisseur d'une règle, en px

let visible = true;
let pointer: Pt | null = null;

/** Pas des graduations (en mm) : chiffres assez espacés pour rester lisibles, traits fins si on zoome. */
function steps(pxPerMm: number) {
  const pick = (candidates: number[], minPx: number) => candidates.find((s) => s * pxPerMm >= minPx) ?? candidates[candidates.length - 1];
  const label = pick([10, 20, 50, 100, 200, 500, 1000], 42);
  const tick = pick([1, 2, 5, 10, 20, 50, 100], 5);
  return { label, tick, mid: label / 2 >= tick ? label / 2 : 0 };
}

function colors() {
  const css = getComputedStyle(document.body);
  return {
    bg: css.getPropertyValue('--panel').trim() || '#262320',
    page: css.getPropertyValue('--panel-2').trim() || '#302c28',
    tick: css.getPropertyValue('--muted').trim() || '#9b9389',
    text: css.getPropertyValue('--text').trim() || '#ece6dd',
    mark: css.getPropertyValue('--accent-2').trim() || '#e8a33d',
  };
}

/** Prépare un canvas net sur écran Retina, aux dimensions données (px CSS). */
function setup(canvas: HTMLCanvasElement, w: number, h: number): CanvasRenderingContext2D {
  const dpr = window.devicePixelRatio || 1;
  canvas.style.width = `${w}px`;
  canvas.style.height = `${h}px`;
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  const ctx = canvas.getContext('2d')!;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return ctx;
}

/**
 * Dessine une règle. `toPx(mm)` donne la position en px dans la règle ; `length` sa longueur ;
 * `pageMm` la dimension de la page ; `vertical` pour la règle de gauche (chiffres tournés).
 */
function drawRuler(canvas: HTMLCanvasElement, length: number, pxPerMm: number, toPx: (mm: number) => number,
  pageMm: number, vertical: boolean, mark: number | null) {
  const ctx = setup(canvas, vertical ? SIZE : length, vertical ? length : SIZE);
  const c = colors();
  ctx.fillStyle = c.bg;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  // étendue de la page, plus claire
  const p0 = Math.max(0, toPx(0)), p1 = Math.min(length, toPx(pageMm));
  ctx.fillStyle = c.page;
  if (p1 > p0) vertical ? ctx.fillRect(0, p0, SIZE, p1 - p0) : ctx.fillRect(p0, 0, p1 - p0, SIZE);
  const { label, tick, mid } = steps(pxPerMm);
  // mm visibles
  const from = Math.floor((-toPx(0)) / pxPerMm / tick) * tick;
  const to = from + Math.ceil(length / pxPerMm / tick + 2) * tick;
  ctx.strokeStyle = c.tick;
  ctx.fillStyle = c.text;
  ctx.lineWidth = 1;
  ctx.font = '10px -apple-system, BlinkMacSystemFont, system-ui, sans-serif';
  ctx.textBaseline = 'top';
  for (let mm = from; mm <= to; mm += tick) {
    const v = Math.round(toPx(mm)) + 0.5;
    if (v < 0 || v > length) continue;
    const isLabel = Math.abs(mm % label) < 1e-6;
    const h = isLabel ? SIZE * 0.65 : mid && Math.abs(mm % mid) < 1e-6 ? SIZE * 0.4 : SIZE * 0.22;
    ctx.beginPath();
    if (vertical) { ctx.moveTo(SIZE, v); ctx.lineTo(SIZE - h, v); } else { ctx.moveTo(v, SIZE); ctx.lineTo(v, SIZE - h); }
    ctx.stroke();
    if (isLabel) {
      const txt = String(Math.round(mm / 10));
      if (vertical) {
        ctx.save();
        ctx.translate(3, v + 2);
        ctx.rotate(Math.PI / 2);
        ctx.fillText(txt, 0, -10);
        ctx.restore();
      } else {
        ctx.fillText(txt, v + 3, 2);
      }
    }
  }
  // position de la souris
  if (mark !== null) {
    const v = Math.round(toPx(mark)) + 0.5;
    ctx.strokeStyle = c.mark;
    ctx.beginPath();
    if (vertical) { ctx.moveTo(0, v); ctx.lineTo(SIZE, v); } else { ctx.moveTo(v, 0); ctx.lineTo(v, SIZE); }
    ctx.stroke();
  }
}

/** Redessine les deux règles, alignées sur la zone du montage. */
export function drawRulers() {
  const stage = $('stage');
  stage.classList.toggle('rulers', visible);
  $('toggle-rulers').classList.toggle('active', visible);
  if (!visible) return;
  const m = editor.screenTransform();
  if (!m) return;
  const top = $<HTMLCanvasElement>('ruler-top');
  const left = $<HTMLCanvasElement>('ruler-left');
  const corner = $('ruler-corner');
  const st = stage.getBoundingClientRect();
  const sv = editor.svg.getBoundingClientRect();
  // les règles bordent la zone du montage, côté haut et côté gauche
  const x0 = sv.left - st.left, y0 = sv.top - st.top;
  Object.assign(top.style, { left: `${x0}px`, top: `${y0 - SIZE}px` });
  Object.assign(left.style, { left: `${x0 - SIZE}px`, top: `${y0}px` });
  Object.assign(corner.style, { left: `${x0 - SIZE}px`, top: `${y0 - SIZE}px`, width: `${SIZE}px`, height: `${SIZE}px` });
  const s = store.doc.settings;
  drawRuler(top, sv.width, m.a, (mm) => m.a * mm + m.e - sv.left, s.widthMm, false, pointer?.x ?? null);
  drawRuler(left, sv.height, m.d, (mm) => m.d * mm + m.f - sv.top, s.heightMm, true, pointer?.y ?? null);
}

export function toggleRulers() {
  visible = !visible;
  pref.set(PREF, visible ? '1' : '0');
  drawRulers();
  // la zone du montage change de taille : l'éditeur se recadre, puis les règles se recalent
  requestAnimationFrame(drawRulers);
}

export function initRulers() {
  visible = pref.get(PREF) !== '0';
  $('toggle-rulers').onclick = toggleRulers;
  editor.onViewChange(drawRulers);
  new ResizeObserver(() => drawRulers()).observe(editor.svg);
  editor.svg.addEventListener('pointermove', (e) => {
    pointer = editor.toMm(e);
    if (visible) drawRulers();
  });
  editor.svg.addEventListener('pointerleave', () => { pointer = null; if (visible) drawRulers(); });
  drawRulers();
}
