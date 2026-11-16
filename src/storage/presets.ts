// Tailles préférées (formats d'impression récurrents), mémorisées dans le navigateur.

import type { FormatPreset } from '../types';

const LS_PRESETS = 'mosaique.presets';

export const DEFAULT_PRESETS: FormatPreset[] = [
  { name: 'Poster 60 × 40', widthMm: 600, heightMm: 400, dpi: 300 },
  { name: 'Tirage 45 × 30', widthMm: 450, heightMm: 300, dpi: 300 },
  { name: 'Tirage 30 × 20', widthMm: 300, heightMm: 200, dpi: 300 },
];

export function loadPresets(): FormatPreset[] {
  try {
    const arr = JSON.parse(localStorage.getItem(LS_PRESETS) ?? 'null');
    if (Array.isArray(arr)) return arr;
  } catch { /* ignore */ }
  return DEFAULT_PRESETS.slice();
}

export function savePresets(list: FormatPreset[]): void {
  try { localStorage.setItem(LS_PRESETS, JSON.stringify(list)); } catch { /* ignore */ }
}
