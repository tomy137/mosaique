import { describe, expect, it } from 'vitest';
import { wrapText } from '../src/render/text';

// une lettre = 1 unité
const measure = (s: string) => s.length;

describe('wrapText', () => {
  it('garde une ligne courte telle quelle', () => {
    expect(wrapText('Noël 2025', 20, measure)).toEqual(['Noël 2025']);
  });

  it('coupe entre les mots', () => {
    expect(wrapText('Les vacances en Bretagne', 12, measure)).toEqual(['Les vacances', 'en Bretagne']);
  });

  it('respecte les retours à la ligne voulus, lignes vides comprises', () => {
    expect(wrapText('Été\n\nJuillet', 20, measure)).toEqual(['Été', '', 'Juillet']);
  });

  it('coupe un mot plus long que la ligne', () => {
    expect(wrapText('anticonstitutionnellement', 10, measure)).toEqual(['anticonsti', 'tutionnell', 'ement']);
  });
});
