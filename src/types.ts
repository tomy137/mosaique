import type { Pt } from './geometry/polygon';

/** Une coupe : droite (infinie) passant par p et q, en mm absolus. Enfant 0 = côté side(p,q,·) > 0. */
export interface Cut { p: Pt; q: Pt }

export interface BspNode {
  id: string;
  /** Coupe simple : deux enfants. */
  cut?: Cut;
  /** Moulinet : quatre droites, cinq enfants (quatre ailes puis le centre). */
  pin?: Cut[];
  children?: BspNode[];
}

/** Cadrage d'une photo dans une case : le point (fx, fy) de l'image (0–1) est placé au centre de la case. */
export interface Crop {
  photo: string;
  fx: number;
  fy: number;
  zoom: number; // 1 = « cover » exact
}

export interface Settings {
  widthMm: number;
  heightMm: number;
  dpi: number;
  gutterMm: number;
  marginMm: number;
  bg: string;
  /** Fond perdu (mm) autour de la ligne de coupe : la feuille fait largeur + 2 × fond perdu. Albums surtout. */
  bleedMm?: number;
  /** Marge de sécurité (mm) à l'intérieur de la ligne de coupe : signalée à l'écran, rien n'y est forcé. */
  safeMm?: number;
}

/** Bloc de texte posé par-dessus le montage (positions en mm, dans la page coupée). */
export interface TextBox {
  id: string;
  x: number;
  y: number;
  w: number;
  text: string;
  sizePt: number;
  align: 'left' | 'center' | 'right';
  color: string;
  bold?: boolean;
  /** Fond derrière le texte (bandeau), ou aucun. */
  bg?: string;
}

/** Une page d'album : sa mise en page, ses photos, ses textes. */
export interface Page {
  root: BspNode;
  crops: Record<string, Crop>;
  texts?: TextBox[];
}

/**
 * Album : suite de pages au même format. La page ouverte est celle du document (root, crops, texts) ;
 * `pages[index]` n'est recopiée qu'à l'enregistrement (voir syncAlbum).
 */
export interface AlbumData {
  index: number;
  pages: Page[];
}

export interface Doc {
  version: 1;
  settings: Settings;
  root: BspNode;
  crops: Record<string, Crop>;
  texts?: TextBox[];
  /** Présent pour un album (plusieurs pages). */
  album?: AlbumData;
  /** Nom du montage (plusieurs montages par dossier). */
  name?: string;
  createdAt?: number;
  updatedAt?: number;
}

export interface FormatPreset {
  name: string;
  widthMm: number;
  heightMm: number;
  dpi: number;
}
