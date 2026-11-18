// Bibliothèque de photos : les fichiers restent sur le disque, on garde en mémoire
// un aperçu réduit (affichage) et le File d'origine (export pleine résolution).

import { photoDate } from './exif';

export interface Photo {
  name: string;
  file: File;
  w: number; // dimensions réelles, orientation EXIF appliquée
  h: number;
  url: string; // aperçu réduit (blob:)
  /** Prise de vue (EXIF), sinon date du fichier (ms). */
  date: number;
  dateExif: boolean;
}

const IMAGE_RE = /\.(jpe?g|png|webp|avif|gif|bmp|tiff?)$/i;
const HEIC_RE = /\.(heic|heif)$/i;
const PREVIEW_MAX = 1600;

/** Ordre chronologique (date de prise de vue, sinon du fichier), puis par nom à date égale. */
export const byDate = (a: Pick<Photo, 'name' | 'date'>, b: Pick<Photo, 'name' | 'date'>) =>
  (a.date || 0) - (b.date || 0) || a.name.localeCompare(b.name, 'fr', { numeric: true });

export const byName = (a: Pick<Photo, 'name'>, b: Pick<Photo, 'name'>) => a.name.localeCompare(b.name, 'fr', { numeric: true });

export const isImageName = (n: string) => IMAGE_RE.test(n);
export const isHeicName = (n: string) => HEIC_RE.test(n);

type Listener = () => void;

export class Library {
  photos = new Map<string, Photo>();
  private listeners = new Set<Listener>();

  subscribe(fn: Listener) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  private emit() { for (const fn of this.listeners) fn(); }

  get(name: string) { return this.photos.get(name); }

  clear() {
    for (const p of this.photos.values()) URL.revokeObjectURL(p.url);
    this.photos.clear();
    this.emit();
  }

  /**
   * Ajoute des fichiers. Renvoie les noms ajoutés (ou déjà présents) et les fichiers ignorés.
   * Un fichier de même nom et même taille qu'une photo déjà chargée n'est pas rechargé.
   */
  async addFiles(files: File[], onProgress?: (done: number, total: number) => void): Promise<{ names: string[]; skipped: string[] }> {
    const names: string[] = [];
    const skipped: string[] = [];
    const todo: { file: File; name: string }[] = [];
    for (const f of files) {
      if (!isImageName(f.name)) { skipped.push(f.name); continue; }
      const existing = this.photos.get(f.name);
      if (existing && existing.file.size === f.size) { names.push(f.name); continue; }
      let name = f.name;
      for (let i = 2; this.photos.has(name); i++) name = f.name.replace(/(\.[^.]+)$/, ` (${i})$1`);
      todo.push({ file: f, name });
    }
    let done = 0;
    const worker = async () => {
      for (let item = todo.shift(); item; item = todo.shift()) {
        try {
          const p = await loadPhoto(item.file, item.name);
          this.photos.set(p.name, p);
          names.push(p.name);
        } catch {
          skipped.push(item.file.name);
        }
        onProgress?.(++done, done + todo.length);
        this.emit();
      }
    };
    await Promise.all([worker(), worker(), worker(), worker()]);
    names.sort((a, b) => a.localeCompare(b, 'fr', { numeric: true }));
    return { names, skipped };
  }

  remove(name: string) {
    const p = this.photos.get(name);
    if (!p) return;
    URL.revokeObjectURL(p.url);
    this.photos.delete(name);
    this.emit();
  }
}

async function loadPhoto(file: File, name: string): Promise<Photo> {
  const [full, when] = await Promise.all([createImageBitmap(file), photoDate(file)]);
  const w = full.width, h = full.height;
  full.close();
  const k = Math.min(1, PREVIEW_MAX / Math.max(w, h));
  const pw = Math.max(1, Math.round(w * k)), ph = Math.max(1, Math.round(h * k));
  const small = await createImageBitmap(file, { resizeWidth: pw, resizeHeight: ph, resizeQuality: 'high' });
  const canvas = new OffscreenCanvas(pw, ph);
  canvas.getContext('2d')!.drawImage(small, 0, 0);
  small.close();
  const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.85 });
  return { name, file, w, h, url: URL.createObjectURL(blob), date: when.date, dateExif: when.exif };
}
