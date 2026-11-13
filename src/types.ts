import type { Pt } from './geometry/polygon';

/** Une coupe : droite (infinie) passant par p et q, en mm absolus. Enfant 0 = côté side(p,q,·) > 0. */
export interface Cut { p: Pt; q: Pt }

export interface BspNode {
  id: string;
  cut?: Cut;
  children?: [BspNode, BspNode];
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
}

export interface Doc {
  version: 1;
  settings: Settings;
  root: BspNode;
  crops: Record<string, Crop>;
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
