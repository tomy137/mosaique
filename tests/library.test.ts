import { describe, expect, it } from 'vitest';
import { byDate, byName } from '../src/photos/library';

describe('ordre de la galerie', () => {
  const photos = [
    { name: 'IMG_10.jpg', date: 3000 },
    { name: 'IMG_2.jpg', date: 1000 },
    { name: 'IMG_1.jpg', date: 3000 },
    { name: 'sans-date.jpg', date: 0 },
  ];

  it('par date, puis par nom à date égale (sans date en premier)', () => {
    expect([...photos].sort(byDate).map((p) => p.name)).toEqual(['sans-date.jpg', 'IMG_2.jpg', 'IMG_1.jpg', 'IMG_10.jpg']);
  });

  it('par nom, numéros dans l’ordre naturel', () => {
    expect([...photos].sort(byName).map((p) => p.name)).toEqual(['IMG_1.jpg', 'IMG_2.jpg', 'IMG_10.jpg', 'sans-date.jpg']);
  });
});
