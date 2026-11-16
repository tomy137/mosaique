// Petits utilitaires d'interface.

export const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

/** Valeur numérique d'un champ. */
export const num = (id: string) => Number($<HTMLInputElement>(id).value);

export const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));

export const hhmm = () => new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });

/** « aujourd'hui », « hier », « il y a 3 j », ou une date. */
export function ago(t: number): string {
  if (!t) return '';
  const d = Math.round((Date.now() - t) / 86400000);
  if (d <= 0) return 'aujourd’hui';
  if (d === 1) return 'hier';
  if (d < 30) return `il y a ${d} j`;
  return new Date(t).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });
}

/** Nom de fichier téléchargeable (sans caractères interdits). */
export const fileSafe = (s: string) => s.replace(/[\\/:*?"<>|]/g, '-');

/** Nombre de photos différentes placées dans un montage. */
export const photoCount = (crops: Record<string, { photo: string }>) => new Set(Object.values(crops).map((c) => c.photo)).size;
