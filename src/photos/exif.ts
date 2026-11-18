// Date de prise de vue d'un JPEG (EXIF DateTimeOriginal, sinon DateTime), sans dépendance.
// On ne lit que le début du fichier : le bloc EXIF est en tête.

const HEAD = 256 * 1024;

/** Date EXIF en ms (heure locale de l'appareil), ou null. */
export function exifDate(buf: ArrayBuffer): number | null {
  const v = new DataView(buf);
  if (v.byteLength < 4 || v.getUint16(0) !== 0xffd8) return null; // pas un JPEG
  let off = 2;
  while (off + 4 <= v.byteLength) {
    const marker = v.getUint16(off);
    if ((marker & 0xff00) !== 0xff00) return null;
    const size = v.getUint16(off + 2);
    if (marker === 0xffe1 && off + 10 <= v.byteLength && v.getUint32(off + 4) === 0x45786966) { // « Exif »
      return tiffDate(v, off + 10, Math.min(v.byteLength, off + 2 + size));
    }
    if (marker === 0xffda) return null; // début de l'image : plus d'en-têtes
    off += 2 + size;
  }
  return null;
}

function tiffDate(v: DataView, t: number, end: number): number | null {
  if (t + 8 > end) return null;
  const le = v.getUint16(t) === 0x4949;
  const u16 = (o: number) => v.getUint16(o, le);
  const u32 = (o: number) => v.getUint32(o, le);
  if (u16(t + 2) !== 42) return null;
  const tags = (ifd: number): Map<number, number> => {
    const out = new Map<number, number>();
    if (ifd + 2 > end) return out;
    const n = u16(ifd);
    for (let i = 0; i < n; i++) {
      const e = ifd + 2 + i * 12;
      if (e + 12 > end) break;
      out.set(u16(e), e);
    }
    return out;
  };
  const ascii = (entry: number): string | null => {
    const count = u32(entry + 4);
    const at = count > 4 ? t + u32(entry + 8) : entry + 8;
    if (at + count > end) return null;
    let s = '';
    for (let i = 0; i < count; i++) { const c = v.getUint8(at + i); if (!c) break; s += String.fromCharCode(c); }
    return s;
  };
  const ifd0 = tags(t + u32(t + 4));
  const exifPtr = ifd0.get(0x8769);
  const exif = exifPtr ? tags(t + u32(exifPtr + 8)) : new Map<number, number>();
  for (const entry of [exif.get(0x9003), exif.get(0x9004), ifd0.get(0x0132)]) {
    const d = entry ? parseExifDate(ascii(entry)) : null;
    if (d) return d;
  }
  return null;
}

/** « 2025:07:14 18:32:05 » → ms (heure locale). */
export function parseExifDate(s: string | null): number | null {
  const m = s?.match(/^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/);
  if (!m || m[1] === '0000') return null;
  const d = new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]).getTime();
  return Number.isFinite(d) ? d : null;
}

/** Date de prise de vue d'un fichier : EXIF si présente, sinon date de modification du fichier. */
export async function photoDate(file: File): Promise<{ date: number; exif: boolean }> {
  if (/\.jpe?g$/i.test(file.name) || file.type === 'image/jpeg') {
    try {
      const d = exifDate(await file.slice(0, HEAD).arrayBuffer());
      if (d) return { date: d, exif: true };
    } catch { /* fichier illisible : date du fichier */ }
  }
  return { date: file.lastModified || 0, exif: false };
}
