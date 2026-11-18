import { describe, expect, it } from 'vitest';
import { distribute, feasibleBounds } from '../src/layout/album';
import { exifDate, parseExifDate } from '../src/photos/exif';

const H = 3600_000, D = 24 * H;
const day = (d: number, h: number, i: number) => ({ name: `d${d}-${String(i).padStart(2, '0')}.jpg`, date: d * D + h * H + i * 60_000 });

describe('distribute', () => {
  it('garde l’ordre chronologique, quel que soit l’ordre des noms', () => {
    const photos = [{ name: 'b.jpg', date: 3 }, { name: 'a.jpg', date: 2 }, { name: 'c.jpg', date: 1 }];
    expect(distribute(photos, 3, { min: 1, max: 3 })).toEqual([['c.jpg'], ['a.jpg'], ['b.jpg']]);
  });

  it('coupe aux changements de journée', () => {
    const photos = [
      ...Array.from({ length: 5 }, (_, i) => day(1, 10, i)),
      ...Array.from({ length: 3 }, (_, i) => day(2, 15, i)),
      ...Array.from({ length: 4 }, (_, i) => day(5, 9, i)),
    ];
    const pages = distribute(photos, 3, { min: 2, max: 6 });
    expect(pages.map((p) => p.length)).toEqual([5, 3, 4]);
    expect(pages[1].every((n) => n.startsWith('d2'))).toBe(true);
  });

  it('respecte le minimum et le maximum par page', () => {
    const photos = Array.from({ length: 40 }, (_, i) => ({ name: `p${i}.jpg`, date: i * (i % 7 === 0 ? D : 60_000) }));
    const pages = distribute(photos, 8, { min: 3, max: 7 });
    expect(pages).toHaveLength(8);
    expect(pages.flat()).toHaveLength(40);
    for (const p of pages) { expect(p.length).toBeGreaterThanOrEqual(3); expect(p.length).toBeLessThanOrEqual(7); }
  });

  it('ajuste des bornes impossibles à tenir', () => {
    expect(feasibleBounds(10, 4, 4, 6)).toEqual([2, 6]);
    expect(feasibleBounds(50, 4, 1, 6)).toEqual([1, 13]);
    const pages = distribute(Array.from({ length: 50 }, (_, i) => ({ name: `p${i}`, date: i })), 4, { min: 1, max: 6 });
    expect(pages.flat()).toHaveLength(50);
  });

  it('moins de photos que de pages : une par page, puis des pages vides', () => {
    expect(distribute([{ name: 'a', date: 1 }, { name: 'b', date: 2 }], 3, { min: 1, max: 4 })).toEqual([['a'], ['b'], []]);
  });
});

/** JPEG minimal (SOI + APP1 EXIF) avec DateTimeOriginal dans le sous-répertoire EXIF. */
function jpegWithDate(date: string, littleEndian: boolean): ArrayBuffer {
  const tiff: number[] = [];
  const u16 = (n: number) => (littleEndian ? [n & 255, n >> 8] : [n >> 8, n & 255]);
  const u32 = (n: number) => (littleEndian ? [n & 255, (n >> 8) & 255, (n >> 16) & 255, n >>> 24] : [n >>> 24, (n >> 16) & 255, (n >> 8) & 255, n & 255]);
  const str = [...date].map((c) => c.charCodeAt(0)).concat(0); // 20 octets
  // en-tête TIFF (8) ; IFD0 à 8 : 1 entrée (pointeur EXIF) ; IFD EXIF à 26 : 1 entrée ; texte à 44
  tiff.push(...(littleEndian ? [0x49, 0x49] : [0x4d, 0x4d]), ...u16(42), ...u32(8));
  tiff.push(...u16(1), ...u16(0x8769), ...u16(4), ...u32(1), ...u32(26), ...u32(0));
  tiff.push(...u16(1), ...u16(0x9003), ...u16(2), ...u32(str.length), ...u32(44), ...u32(0));
  tiff.push(...str);
  const app1 = [0x45, 0x78, 0x69, 0x66, 0, 0, ...tiff];
  const bytes = [0xff, 0xd8, 0xff, 0xe1, (app1.length + 2) >> 8, (app1.length + 2) & 255, ...app1, 0xff, 0xda, 0, 2];
  return new Uint8Array(bytes).buffer;
}

describe('exif', () => {
  it('lit DateTimeOriginal (Intel et Motorola)', () => {
    const want = new Date(2025, 6, 14, 18, 32, 5).getTime();
    expect(exifDate(jpegWithDate('2025:07:14 18:32:05', true))).toBe(want);
    expect(exifDate(jpegWithDate('2025:07:14 18:32:05', false))).toBe(want);
  });

  it('ignore ce qui n’est pas une date EXIF', () => {
    expect(exifDate(new Uint8Array([0x89, 0x50, 0x4e, 0x47]).buffer)).toBeNull();
    expect(parseExifDate('0000:00:00 00:00:00')).toBeNull();
    expect(parseExifDate(null)).toBeNull();
  });
});
