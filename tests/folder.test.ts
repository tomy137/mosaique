import { describe, expect, it } from 'vitest';
import { pendingHeic } from '../src/storage/folder';

describe('HEIC à convertir', () => {
  it('ignore les HEIC qui ont déjà leur JPEG du même nom', () => {
    const heic = ['IMG_1.HEIC', 'IMG_2.heic', 'IMG 3 noël.HEIC'];
    const images = [{ name: 'IMG_1.jpg' }, { name: 'img 3 noël.JPEG' }, { name: 'autre.jpg' }];
    expect(pendingHeic(heic, images)).toEqual(['IMG_2.heic']);
  });

  it('tout est converti → plus rien à signaler', () => {
    expect(pendingHeic(['A.HEIC'], [{ name: 'A.jpg' }])).toEqual([]);
  });
});
