// Éditeur interactif en SVG (unités : mm).

import { computeCells, findNode, isValid, type Cells, type CutInfo } from '../geometry/bsp';
import {
  add, bbox, closestOnBoundary, dist, dot, len, lineThroughPolygon, mul, pointInPolygon, polyToPoints, sub,
  type Poly, type Pt,
} from '../geometry/polygon';
import { mergeAt, quickCut, snapAngle, straightenCut, trySplit } from '../layout/edit';
import { defaultCrop, effectiveDpi, panCrop, placement, zoomCrop } from '../photos/crop';
import type { Library } from '../photos/library';
import type { Store } from '../store';
import type { Cut } from '../types';

const NS = 'http://www.w3.org/2000/svg';
export const PHOTO_MIME = 'application/x-mosaique-photo';
export const LOW_DPI = 150;

export type Mode = 'select' | 'cut';
export type Selection = { kind: 'cell' | 'cut'; id: string } | null;

type Drag =
  | { t: 'pan'; id: string; last: Pt }
  | { t: 'swap'; from: string; over: string | null }
  | { t: 'cut-move'; id: string; start: Pt; p0: Pt; q0: Pt; n: Pt }
  | { t: 'cut-end'; id: string; end: 0 | 1; fixed: Pt; parent: Poly }
  | { t: 'draw'; start: Pt; cur: Pt; sx: number; sy: number };

interface CellEls { g: SVGGElement; clip: SVGPolygonElement; base: SVGPolygonElement; img: SVGImageElement; warn: SVGGElement; dup: SVGGElement }

function el<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number> = {}, parent?: Element): SVGElementTagNameMap[K] {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  parent?.appendChild(e);
  return e;
}

export class Editor {
  readonly svg: SVGSVGElement;
  private defs: SVGDefsElement;
  private page: SVGRectElement;
  private gCells: SVGGElement;
  private gOverlay: SVGGElement;
  cells!: Cells;
  mode: Mode = 'select';
  sel: Selection = null;
  private hoverCut: string | null = null;
  private dropTarget: string | null = null;
  private drag: Drag | null = null;
  private els = new Map<string, CellEls>();
  private lastWheel = 0;
  private emitTimer = 0;

  /** Appelé quand la sélection ou le mode change (pour la barre d'outils). */
  onUi?: () => void;
  /** Message bref dans la barre d'état. */
  onToast?: (msg: string) => void;
  /** Fichiers déposés depuis le Finder (avec la case visée, si une seule photo). */
  onDropFiles?: (files: File[], cellId: string | null) => void;
  /** Autres montages du dossier qui utilisent cette photo (pastille orange sur la case). */
  usedElsewhere?: (photo: string) => string[];
  /** Une photo vient d'être placée dans une case (pour avertir si elle sert déjà ailleurs). */
  onPhotoPlaced?: (photo: string) => void;

  constructor(host: HTMLElement, private store: Store, private lib: Library) {
    this.svg = el('svg', { class: 'editor', preserveAspectRatio: 'xMidYMid meet' });
    this.defs = el('defs', {}, this.svg);
    const shadow = el('filter', { id: 'page-shadow', x: '-5%', y: '-5%', width: '110%', height: '110%' }, this.defs);
    el('feDropShadow', { dx: 0, dy: 0, stdDeviation: 3, 'flood-opacity': 0.35 }, shadow);
    this.page = el('rect', { x: 0, y: 0, filter: 'url(#page-shadow)', class: 'page' }, this.svg);
    this.gCells = el('g', { class: 'cells' }, this.svg);
    this.gOverlay = el('g', { class: 'overlay' }, this.svg);
    host.appendChild(this.svg);

    this.svg.addEventListener('pointerdown', (e) => this.down(e));
    this.svg.addEventListener('pointermove', (e) => this.move(e));
    this.svg.addEventListener('pointerup', (e) => this.up(e));
    this.svg.addEventListener('pointercancel', () => { this.drag = null; this.store.dropNoopCheckpoint(); this.render(); });
    this.svg.addEventListener('wheel', (e) => this.wheel(e), { passive: false });
    this.svg.addEventListener('dblclick', (e) => this.dblclick(e));
    this.svg.addEventListener('dragover', (e) => this.dragover(e));
    this.svg.addEventListener('dragleave', () => { this.dropTarget = null; this.renderOverlay(); });
    this.svg.addEventListener('drop', (e) => this.drop(e));
    new ResizeObserver(() => this.renderOverlay()).observe(this.svg);

    store.subscribe(() => this.render());
    lib.subscribe(() => this.render());
    this.render();
  }

  // ---------------------------------------------------------------- rendu

  render(): void {
    const doc = this.store.doc, s = doc.settings;
    this.cells = computeCells(doc.root, s);
    const pad = Math.max(s.widthMm, s.heightMm) * 0.03;
    this.svg.setAttribute('viewBox', `${-pad} ${-pad} ${s.widthMm + 2 * pad} ${s.heightMm + 2 * pad}`);
    this.page.setAttribute('width', String(s.widthMm));
    this.page.setAttribute('height', String(s.heightMm));
    this.page.setAttribute('fill', s.bg);

    if (this.sel?.kind === 'cell' && !this.cells.leaves.has(this.sel.id)) this.sel = null;
    if (this.sel?.kind === 'cut' && !this.cells.cuts.some((c) => c.id === this.sel!.id)) this.sel = null;

    const seen = new Set<string>();
    const badge = Math.max(s.widthMm, s.heightMm) * 0.009;
    for (const [id, poly] of this.cells.insets) {
      if (poly.length < 3) continue;
      seen.add(id);
      const e = this.els.get(id) ?? this.createCell(id);
      const pts = polyToPoints(poly);
      e.clip.setAttribute('points', pts);
      e.base.setAttribute('points', pts);
      const crop = doc.crops[id];
      const photo = crop ? this.lib.get(crop.photo) : undefined;
      e.base.classList.toggle('missing', !!crop && !photo);
      e.base.querySelector('title')!.textContent = crop && !photo ? `Photo manquante : ${crop.photo}` : '';
      const bb = bbox(poly);
      if (crop && photo) {
        const p = placement(bb, photo.w, photo.h, crop);
        if (e.img.getAttribute('href') !== photo.url) e.img.setAttribute('href', photo.url);
        e.img.setAttribute('x', String(p.x));
        e.img.setAttribute('y', String(p.y));
        e.img.setAttribute('width', String(p.w));
        e.img.setAttribute('height', String(p.h));
        e.img.style.display = '';
        const dpi = effectiveDpi(bb, photo.w, photo.h, crop);
        const low = dpi < LOW_DPI;
        e.warn.style.display = low ? '' : 'none';
        if (low) {
          e.warn.setAttribute('transform', badgeAt(poly, -1, badge));
          const c = e.warn.querySelector('circle')!;
          c.setAttribute('r', String(badge));
          const t = e.warn.querySelector('text')!;
          t.setAttribute('font-size', String(badge * 1.4));
          e.warn.querySelector('title')!.textContent = `Résolution faible à l'impression : ${Math.round(dpi)} dpi`;
        }
        const others = this.usedElsewhere?.(crop.photo) ?? [];
        e.dup.style.display = others.length ? '' : 'none';
        if (others.length) {
          e.dup.setAttribute('transform', badgeAt(poly, 1, badge));
          e.dup.querySelector('circle')!.setAttribute('r', String(badge));
          const t = e.dup.querySelector('text')!;
          t.setAttribute('font-size', String(badge * 1.25));
          t.textContent = String(others.length + 1);
          e.dup.querySelector('title')!.textContent = `Photo aussi utilisée dans : ${others.map((n) => `« ${n} »`).join(', ')}`;
        }
      } else {
        e.img.style.display = 'none';
        e.warn.style.display = 'none';
        e.dup.style.display = 'none';
      }
    }
    for (const [id, e] of this.els) {
      if (!seen.has(id)) { e.g.remove(); this.defs.querySelector(`#${clipId(id)}`)?.remove(); this.els.delete(id); }
    }
    this.renderOverlay();
  }

  private createCell(id: string): CellEls {
    const cp = el('clipPath', { id: clipId(id) }, this.defs);
    const clip = el('polygon', {}, cp);
    const g = el('g', { 'data-cell': id }, this.gCells);
    const base = el('polygon', { class: 'cell-base', 'data-kind': 'cell', 'data-id': id }, g);
    el('title', {}, base);
    const img = el('image', { 'clip-path': `url(#${clipId(id)})`, preserveAspectRatio: 'none', class: 'cell-img' }, g);
    const warn = el('g', { class: 'warn' }, g);
    el('circle', { cx: 0, cy: 0 }, warn);
    const t = el('text', { x: 0, y: 0, 'text-anchor': 'middle', 'dominant-baseline': 'central' }, warn);
    t.textContent = '!';
    el('title', {}, warn);
    const dup = el('g', { class: 'dup' }, g);
    el('circle', { cx: 0, cy: 0 }, dup);
    el('text', { x: 0, y: 0, 'text-anchor': 'middle', 'dominant-baseline': 'central' }, dup);
    el('title', {}, dup);
    const e = { g, clip, base, img, warn, dup };
    this.els.set(id, e);
    return e;
  }

  private mmPerPx(): number {
    const m = this.svg.getScreenCTM();
    return m && m.a ? 1 / m.a : 1;
  }

  renderOverlay(): void {
    const o = this.gOverlay;
    o.replaceChildren();
    this.svg.classList.toggle('mode-cut', this.mode === 'cut');
    const px = this.mmPerPx();

    const outline = (id: string | null, cls: string) => {
      if (!id) return;
      const p = this.cells.insets.get(id);
      if (p && p.length >= 3) el('polygon', { points: polyToPoints(p), class: cls }, o);
    };
    if (this.sel?.kind === 'cell') outline(this.sel.id, 'sel-cell');
    if (this.drag?.t === 'swap') { outline(this.drag.from, 'sel-cell'); outline(this.drag.over, 'drop-target'); }
    outline(this.dropTarget, 'drop-target');

    for (const c of this.cells.cuts) {
      const [a, b] = c.seg;
      const selected = this.sel?.kind === 'cut' && this.sel.id === c.id;
      const cls = `cut-vis${selected ? ' selected' : ''}${this.hoverCut === c.id ? ' hover' : ''}`;
      el('line', { x1: a.x, y1: a.y, x2: b.x, y2: b.y, class: cls }, o);
      el('line', { x1: a.x, y1: a.y, x2: b.x, y2: b.y, class: 'cut-hit', 'data-kind': 'cut', 'data-id': c.id }, o);
    }
    const selCut = this.selectedCut();
    if (selCut) {
      selCut.seg.forEach((p, i) => el('circle', { cx: p.x, cy: p.y, r: 6 * px, class: 'handle', 'data-kind': 'handle', 'data-end': i }, o));
    }

    if (this.drag?.t === 'draw') {
      const prev = this.previewCut(this.drag);
      if (prev) {
        const [a, b] = prev.seg;
        el('line', { x1: a.x, y1: a.y, x2: b.x, y2: b.y, class: `cut-preview${prev.ok ? '' : ' bad'}` }, o);
      }
      el('circle', { cx: this.drag.start.x, cy: this.drag.start.y, r: 3 * px, class: 'draw-dot' }, o);
    }
  }

  // ---------------------------------------------------------------- utilitaires

  toMm(e: { clientX: number; clientY: number }): Pt {
    const m = this.svg.getScreenCTM();
    if (!m) return { x: 0, y: 0 };
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(m.inverse());
    return { x: p.x, y: p.y };
  }

  leafAt(pt: Pt): string | null {
    for (const [id, poly] of this.cells.leaves) if (poly.length >= 3 && pointInPolygon(poly, pt)) return id;
    return null;
  }

  selectedCut(): CutInfo | null {
    if (this.sel?.kind !== 'cut') return null;
    return this.cells.cuts.find((c) => c.id === this.sel!.id) ?? null;
  }

  private bbOf(id: string) {
    const p = this.cells.insets.get(id);
    return p && p.length >= 3 ? bbox(p) : null;
  }

  /** Remplace une coupe si la mise en page reste valide. */
  private setCut(id: string, cut: Cut): boolean {
    const node = findNode(this.store.doc.root, id);
    if (!node?.cut) return false;
    const old = node.cut;
    node.cut = cut;
    if (!isValid(computeCells(this.store.doc.root, this.store.doc.settings), this.store.doc.settings)) {
      node.cut = old;
      return false;
    }
    this.render();
    return true;
  }

  private previewCut(d: Extract<Drag, { t: 'draw' }>): { leaf: string; cut: Cut; seg: [Pt, Pt]; ok: boolean } | null {
    if (dist(d.start, d.cur) < 2 * this.mmPerPx()) return null;
    const mid = mul(add(d.start, d.cur), 0.5);
    const leaf = this.leafAt(mid);
    if (!leaf) return null;
    const cut = { p: d.start, q: d.cur };
    const seg = lineThroughPolygon(this.cells.leaves.get(leaf)!, cut.p, cut.q);
    if (!seg) return null;
    return { leaf, cut, seg, ok: true };
  }

  private scheduleEmit() {
    clearTimeout(this.emitTimer);
    this.emitTimer = window.setTimeout(() => this.store.emit(), 350);
  }

  // ---------------------------------------------------------------- souris

  private down(e: PointerEvent) {
    if (e.button !== 0) return;
    const pt = this.toMm(e);
    const target = e.target as Element;
    const kind = target.getAttribute('data-kind');
    const doc = this.store.doc;

    if (this.mode === 'cut') {
      this.drag = { t: 'draw', start: pt, cur: pt, sx: e.clientX, sy: e.clientY };
    } else if (kind === 'handle' && this.selectedCut()) {
      const c = this.selectedCut()!;
      const end = Number(target.getAttribute('data-end')) as 0 | 1;
      this.store.checkpoint();
      this.drag = { t: 'cut-end', id: c.id, end, fixed: c.seg[1 - end], parent: c.parent };
    } else if (kind === 'cut') {
      const id = target.getAttribute('data-id')!;
      const node = findNode(doc.root, id)!;
      this.sel = { kind: 'cut', id };
      const d = sub(node.cut!.q, node.cut!.p);
      const l = len(d) || 1;
      this.store.checkpoint();
      this.drag = { t: 'cut-move', id, start: pt, p0: node.cut!.p, q0: node.cut!.q, n: { x: -d.y / l, y: d.x / l } };
    } else {
      const id = this.leafAt(pt);
      this.sel = id ? { kind: 'cell', id } : null;
      if (id && doc.crops[id]) {
        this.store.checkpoint();
        this.drag = e.shiftKey || e.altKey ? { t: 'swap', from: id, over: null } : { t: 'pan', id, last: pt };
      }
    }
    this.svg.setPointerCapture(e.pointerId);
    this.renderOverlay();
    this.onUi?.();
  }

  private move(e: PointerEvent) {
    const pt = this.toMm(e);
    const d = this.drag;
    if (!d) {
      const k = (e.target as Element).getAttribute?.('data-kind');
      const h = k === 'cut' ? (e.target as Element).getAttribute('data-id') : null;
      if (h !== this.hoverCut) { this.hoverCut = h; this.renderOverlay(); }
      return;
    }
    const doc = this.store.doc;
    switch (d.t) {
      case 'pan': {
        const crop = doc.crops[d.id];
        const photo = crop && this.lib.get(crop.photo);
        const bb = this.bbOf(d.id);
        if (crop && photo && bb) {
          doc.crops[d.id] = panCrop(bb, photo.w, photo.h, crop, pt.x - d.last.x, pt.y - d.last.y);
          this.render();
        }
        d.last = pt;
        break;
      }
      case 'swap':
        d.over = this.leafAt(pt);
        this.renderOverlay();
        break;
      case 'cut-move': {
        const k = dot(sub(pt, d.start), d.n);
        this.setCut(d.id, { p: add(d.p0, mul(d.n, k)), q: add(d.q0, mul(d.n, k)) });
        break;
      }
      case 'cut-end': {
        let np = closestOnBoundary(d.parent, pt);
        if (!e.altKey) np = this.snapEnd(d.fixed, np, d.parent);
        if (dist(np, d.fixed) < 1) break;
        this.setCut(d.id, d.end === 0 ? { p: np, q: d.fixed } : { p: d.fixed, q: np });
        break;
      }
      case 'draw': {
        let cur = pt;
        if (e.shiftKey) cur = snapAngle(d.start, pt, 45);
        else if (!e.altKey) cur = snapAngle(d.start, pt, 4);
        d.cur = cur;
        this.renderOverlay();
        break;
      }
    }
  }

  private snapEnd(fixed: Pt, np: Pt, parent: Poly): Pt {
    const s = snapAngle(fixed, np, 3);
    if (s === np) return np;
    const seg = lineThroughPolygon(parent, fixed, s);
    if (!seg) return np;
    return dist(seg[0], fixed) > dist(seg[1], fixed) ? seg[0] : seg[1];
  }

  private up(e: PointerEvent) {
    const d = this.drag;
    this.drag = null;
    if (this.svg.hasPointerCapture(e.pointerId)) this.svg.releasePointerCapture(e.pointerId);
    if (!d) return;
    const doc = this.store.doc;
    if (d.t === 'swap') {
      if (d.over && d.over !== d.from) {
        const a = doc.crops[d.from], b = doc.crops[d.over];
        if (b) doc.crops[d.from] = b; else delete doc.crops[d.from];
        doc.crops[d.over] = a;
        this.sel = { kind: 'cell', id: d.over };
      }
    } else if (d.t === 'draw') {
      const small = Math.hypot(e.clientX - d.sx, e.clientY - d.sy) < 4;
      let leaf: string | null = null;
      let cut: Cut | null = null;
      if (small) {
        leaf = this.leafAt(d.start);
        cut = leaf ? quickCut(this.cells, leaf, d.start) : null;
      } else {
        const prev = this.previewCut(d);
        if (prev) { leaf = prev.leaf; cut = prev.cut; }
      }
      if (leaf && cut) {
        this.store.checkpoint();
        if (!trySplit(doc, leaf, cut)) this.onToast?.('Coupe impossible : une des cases serait trop petite.');
      }
    }
    this.store.dropNoopCheckpoint();
    this.store.emit();
    this.onUi?.();
  }

  private wheel(e: WheelEvent) {
    if (this.mode !== 'select') return;
    const pt = this.toMm(e);
    const id = this.leafAt(pt);
    const doc = this.store.doc;
    const crop = id ? doc.crops[id] : undefined;
    const photo = crop && this.lib.get(crop.photo);
    const bb = id ? this.bbOf(id) : null;
    if (!id || !crop || !photo || !bb) return;
    e.preventDefault();
    const now = performance.now();
    if (now - this.lastWheel > 700) this.store.checkpoint();
    this.lastWheel = now;
    const factor = Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.002));
    doc.crops[id] = zoomCrop(bb, photo.w, photo.h, crop, factor, pt);
    this.render();
    this.scheduleEmit();
  }

  private dblclick(e: MouseEvent) {
    if (this.mode !== 'select') return;
    const id = this.leafAt(this.toMm(e));
    const crop = id ? this.store.doc.crops[id] : undefined;
    if (id && crop) this.store.change((d) => { d.crops[id] = { ...crop, fx: 0.5, fy: 0.5, zoom: 1 }; });
  }

  // ---------------------------------------------------------------- glisser-déposer

  private dragover(e: DragEvent) {
    const types = e.dataTransfer?.types ?? [];
    if (!types.includes(PHOTO_MIME) && !types.includes('Files')) return;
    e.preventDefault();
    const id = this.leafAt(this.toMm(e));
    if (id !== this.dropTarget) { this.dropTarget = id; this.renderOverlay(); }
  }

  private drop(e: DragEvent) {
    e.preventDefault();
    const id = this.leafAt(this.toMm(e));
    this.dropTarget = null;
    const name = e.dataTransfer?.getData(PHOTO_MIME);
    if (name && id) {
      this.store.change((d) => { d.crops[id] = defaultCrop(name); });
      this.onPhotoPlaced?.(name);
      this.sel = { kind: 'cell', id };
      this.onUi?.();
    } else if (e.dataTransfer?.files.length) {
      this.onDropFiles?.([...e.dataTransfer.files], id);
    }
    this.renderOverlay();
  }

  // ---------------------------------------------------------------- actions (barre d'outils, clavier)

  setMode(m: Mode) {
    this.mode = m;
    if (m === 'cut') this.sel = null;
    this.renderOverlay();
    this.onUi?.();
  }

  deleteSelection() {
    const s = this.sel;
    if (!s) return;
    if (s.kind === 'cut') {
      this.store.change((d) => mergeAt(d, s.id, this.cells));
      this.sel = this.cells.leaves.has(s.id) ? { kind: 'cell', id: s.id } : null;
    } else if (this.store.doc.crops[s.id]) {
      this.store.change((d) => { delete d.crops[s.id]; });
    }
    this.onUi?.();
  }

  straightenSelected() {
    const c = this.selectedCut();
    if (!c) return;
    this.store.checkpoint();
    if (!this.setCut(c.id, straightenCut(c.seg, c.cut))) this.onToast?.('Impossible de redresser : une case serait écrasée.');
    this.store.dropNoopCheckpoint();
    this.store.emit();
  }

  resetCrop() {
    if (this.sel?.kind !== 'cell') return;
    const id = this.sel.id;
    const crop = this.store.doc.crops[id];
    if (crop) this.store.change((d) => { d.crops[id] = { ...crop, fx: 0.5, fy: 0.5, zoom: 1 }; });
  }

  /** Informations sur la case sélectionnée, pour la barre d'outils. */
  cellInfo(): { id: string; photo?: string; dpi?: number; missing?: boolean } | null {
    if (this.sel?.kind !== 'cell') return null;
    const id = this.sel.id;
    const crop = this.store.doc.crops[id];
    if (!crop) return { id };
    const photo = this.lib.get(crop.photo);
    const bb = this.bbOf(id);
    if (!photo || !bb) return { id, photo: crop.photo, missing: true };
    return { id, photo: crop.photo, dpi: Math.round(effectiveDpi(bb, photo.w, photo.h, crop)) };
  }
}

const clipId = (id: string) => `clip-${id.replace(/\./g, '_')}`;

/**
 * Position d'une pastille dans le coin haut-gauche (side = -1) ou haut-droit (side = 1) de la case,
 * ramenée vers l'intérieur : elle reste dans la case même quand ses bords sont obliques.
 */
function badgeAt(poly: Poly, side: -1 | 1, r: number): string {
  const corner = poly.reduce((best, p) => (side * p.x - p.y > side * best.x - best.y ? p : best), poly[0]);
  const c = poly.reduce((acc, p) => add(acc, mul(p, 1 / poly.length)), { x: 0, y: 0 });
  const d = sub(c, corner);
  const l = len(d) || 1;
  const at = add(corner, mul(d, Math.min(r * 2.6, l * 0.5) / l));
  return `translate(${at.x} ${at.y})`;
}
