// Blocs de texte : mise en lignes (commune à l'écran et à l'export), rendu SVG et rendu canvas.
// Positions en mm ; taille en points (1 pt = 0,3528 mm). Polices : celles du système, identiques à
// l'écran et à l'export puisque l'export se fait dans le même navigateur.

import type { TextBox } from '../types';

export const PT_MM = 25.4 / 72;
export const LINE = 1.25; // interligne, en multiple de la taille

export const FONT_FAMILY = `'Avenir Next', Avenir, 'Helvetica Neue', Helvetica, Arial, sans-serif`;

/** Police CSS pour une taille donnée dans l'unité courante (px du canvas, ou mm du SVG). */
export const fontCss = (t: Pick<TextBox, 'bold'>, size: number) => `${t.bold ? 600 : 400} ${size}px ${FONT_FAMILY}`;

export const textSizeMm = (t: TextBox) => t.sizePt * PT_MM;

/**
 * Découpe le texte en lignes tenant dans `maxW` (mêmes unités que `measure`) : retours à la ligne voulus,
 * puis coupure entre les mots ; un mot trop long est coupé où il faut.
 */
export function wrapText(text: string, maxW: number, measure: (s: string) => number): string[] {
  const out: string[] = [];
  for (const para of text.split('\n')) {
    const words = para.split(/ +/);
    let line = '';
    for (const w of words) {
      const next = line ? `${line} ${w}` : w;
      if (measure(next) <= maxW || !line) {
        line = next;
      } else {
        out.push(line);
        line = w;
      }
      // mot plus long que la ligne entière : coupé lettre à lettre
      while (measure(line) > maxW && line.length > 1) {
        let k = line.length - 1;
        while (k > 1 && measure(line.slice(0, k)) > maxW) k--;
        out.push(line.slice(0, k));
        line = line.slice(k);
      }
    }
    out.push(line);
  }
  return out;
}

let ctx: OffscreenCanvasRenderingContext2D | null = null;
/** Mesure (en mm) d'une chaîne pour ce bloc de texte. */
function measurer(t: TextBox): (s: string) => number {
  ctx ??= new OffscreenCanvas(1, 1).getContext('2d')!;
  ctx.font = fontCss(t, 100);
  const k = textSizeMm(t) / 100;
  return (s) => ctx!.measureText(s).width * k;
}

export interface TextLayout { lines: string[]; size: number; lineH: number; h: number; pad: number }

/** Lignes et hauteur d'un bloc (mm). Le bandeau ajoute une petite marge intérieure. */
export function layoutText(t: TextBox): TextLayout {
  const size = textSizeMm(t);
  const pad = t.bg ? size * 0.35 : 0;
  const lines = wrapText(t.text, Math.max(size, t.w - 2 * pad), measurer(t));
  const lineH = size * LINE;
  return { lines, size, lineH, h: lines.length * lineH + 2 * pad, pad };
}

const anchorX = (t: TextBox, pad: number) => (t.align === 'center' ? t.x + t.w / 2 : t.align === 'right' ? t.x + t.w - pad : t.x + pad);

/** Rendu SVG d'un bloc (éditeur, vignettes). Texte inséré comme texte, jamais comme HTML. */
export function textSvg(t: TextBox, attrs: Record<string, string> = {}): SVGGElement {
  const NS = 'http://www.w3.org/2000/svg';
  const L = layoutText(t);
  const g = document.createElementNS(NS, 'g');
  for (const [k, v] of Object.entries(attrs)) g.setAttribute(k, v);
  if (t.bg) {
    const r = document.createElementNS(NS, 'rect');
    for (const [k, v] of Object.entries({ x: t.x, y: t.y, width: t.w, height: L.h, fill: t.bg, rx: L.size * 0.15 })) r.setAttribute(k, String(v));
    g.appendChild(r);
  }
  const text = document.createElementNS(NS, 'text');
  text.setAttribute('fill', t.color);
  text.setAttribute('font-family', FONT_FAMILY);
  text.setAttribute('font-size', String(L.size));
  text.setAttribute('font-weight', t.bold ? '600' : '400');
  text.setAttribute('text-anchor', t.align === 'center' ? 'middle' : t.align === 'right' ? 'end' : 'start');
  text.style.whiteSpace = 'pre';
  L.lines.forEach((line, i) => {
    const span = document.createElementNS(NS, 'tspan');
    span.setAttribute('x', String(anchorX(t, L.pad)));
    // ligne de base : 80 % de la taille sous le haut de la ligne
    span.setAttribute('y', String(t.y + L.pad + i * L.lineH + (L.lineH - L.size) / 2 + L.size * 0.8));
    span.textContent = line || ' ';
    text.appendChild(span);
  });
  g.appendChild(text);
  return g;
}

/** Rendu sur le canvas d'export (k = pixels par mm, origine = coin de la page coupée). */
export function drawText(c: OffscreenCanvasRenderingContext2D, t: TextBox, k: number) {
  const L = layoutText(t);
  if (t.bg) {
    c.fillStyle = t.bg;
    c.beginPath();
    c.roundRect(t.x * k, t.y * k, t.w * k, L.h * k, L.size * 0.15 * k);
    c.fill();
  }
  c.fillStyle = t.color;
  c.font = fontCss(t, L.size * k);
  c.textAlign = t.align;
  c.textBaseline = 'alphabetic';
  L.lines.forEach((line, i) => {
    c.fillText(line, anchorX(t, L.pad) * k, (t.y + L.pad + i * L.lineH + (L.lineH - L.size) / 2 + L.size * 0.8) * k);
  });
}
