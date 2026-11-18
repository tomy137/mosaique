// Tailles préférées (formats d'impression récurrents), mémorisées dans le navigateur.

import type { FormatPreset } from '../types';

const LS_PRESETS = 'mosaique.presets';

export const DEFAULT_PRESETS: FormatPreset[] = [
  { name: 'Poster 60 × 40', widthMm: 600, heightMm: 400, dpi: 300 },
  { name: 'Tirage 45 × 30', widthMm: 450, heightMm: 300, dpi: 300 },
  { name: 'Tirage 30 × 20', widthMm: 300, heightMm: 200, dpi: 300 },
  // albums (page coupée ; dimensions exactes et fond perdu à vérifier sur le site du service choisi)
  { name: 'Album A4 paysage', widthMm: 297, heightMm: 210, dpi: 300 },
  { name: 'Album carré 30 × 30', widthMm: 300, heightMm: 300, dpi: 300 },
  { name: 'Album carré 20 × 20', widthMm: 200, heightMm: 200, dpi: 300 },
];

const LS_SEEN = 'mosaique.presets.seen';

export function loadPresets(): FormatPreset[] {
  try {
    const arr = JSON.parse(localStorage.getItem(LS_PRESETS) ?? 'null');
    if (Array.isArray(arr)) {
      // nouveaux formats par défaut : proposés une fois (une taille retirée ne revient pas)
      const seen = new Set<string>(JSON.parse(localStorage.getItem(LS_SEEN) ?? 'null') ?? arr.map((p: FormatPreset) => p.name).concat(DEFAULT_PRESETS.slice(0, 3).map((p) => p.name)));
      const fresh = DEFAULT_PRESETS.filter((p) => !seen.has(p.name) && !arr.some((q: FormatPreset) => q.name === p.name));
      localStorage.setItem(LS_SEEN, JSON.stringify([...seen, ...fresh.map((p) => p.name)]));
      if (fresh.length) { const out = [...arr, ...fresh]; savePresets(out); return out; }
      return arr;
    }
  } catch { /* ignore */ }
  return DEFAULT_PRESETS.slice();
}

export function savePresets(list: FormatPreset[]): void {
  try { localStorage.setItem(LS_PRESETS, JSON.stringify(list)); } catch { /* ignore */ }
}
