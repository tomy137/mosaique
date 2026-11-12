// État du document + historique (annuler / rétablir) par instantanés JSON.

import type { Doc } from './types';

type Listener = (doc: Doc) => void;

export class Store {
  doc: Doc;
  private past: string[] = [];
  private future: string[] = [];
  private listeners = new Set<Listener>();

  constructor(doc: Doc) {
    this.doc = doc;
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  emit(): void {
    for (const fn of this.listeners) fn(this.doc);
  }

  /** Mémorise l'état courant avant une modification. */
  checkpoint(): void {
    const snap = JSON.stringify(this.doc);
    if (this.past[this.past.length - 1] === snap) return;
    this.past.push(snap);
    if (this.past.length > 200) this.past.shift();
    this.future = [];
  }

  /** Modification ponctuelle, annulable. */
  change(fn: (doc: Doc) => void): void {
    this.checkpoint();
    fn(this.doc);
    this.emit();
  }

  /** Retire le dernier point d'historique s'il est identique à l'état courant (geste sans effet). */
  dropNoopCheckpoint(): void {
    if (this.past[this.past.length - 1] === JSON.stringify(this.doc)) this.past.pop();
  }

  undo(): void {
    const prev = this.past.pop();
    if (!prev) return;
    this.future.push(JSON.stringify(this.doc));
    this.doc = JSON.parse(prev);
    this.emit();
  }

  redo(): void {
    const next = this.future.pop();
    if (!next) return;
    this.past.push(JSON.stringify(this.doc));
    this.doc = JSON.parse(next);
    this.emit();
  }

  replace(doc: Doc, keepHistory = false): void {
    if (keepHistory) this.checkpoint();
    else { this.past = []; this.future = []; }
    this.doc = doc;
    this.emit();
  }

  get canUndo() { return this.past.length > 0; }
  get canRedo() { return this.future.length > 0; }
}
