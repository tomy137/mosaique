// État partagé de l'interface : document ouvert, bibliothèque, éditeur, et dossier / montages en cours.

import { Library } from '../photos/library';
import { Editor } from '../render/editor';
import { newDoc } from '../storage/doc';
import type { DirHandle } from '../storage/folder';
import { currentMontageFile, currentProject, loadLocal, montageKey } from '../storage/local';
import type { Montage } from '../storage/montages';
import { Store } from '../store';
import { $ } from './dom';

export const app = {
  /** Dossier ouvert (son nom) et fichier du montage ouvert : un couple par onglet. */
  project: currentProject(),
  currentFile: currentMontageFile(),
  /** Montages du dossier (le montage ouvert y est recopié à chaque enregistrement). */
  montages: [] as Montage[],
  /** Photo → autres montages du dossier qui l'utilisent. */
  usage: new Map<string, string[]>(),
  /** Dossier accessible en écriture. */
  folder: null as DirHandle | null,
  /** Dossier lisible dont l'écriture attend un clic sur « Autoriser l'enregistrement ». */
  pendingWrite: null as DirHandle | null,
};

/** Copie de secours retrouvée au démarrage (null à la toute première ouverture). */
export const saved = loadLocal(montageKey(app.project, app.currentFile)) ?? loadLocal(app.project) ?? loadLocal();
export const store = new Store(saved ?? newDoc());
export const lib = new Library();
export const editor = new Editor($('stage'), store, lib);

export const currentMontage = () => app.montages.find((m) => m.file === app.currentFile);
export const currentName = () => store.doc.name?.trim() || currentMontage()?.doc.name || 'Montage';
