// Messages en bandeau, au-dessus du montage.

import { $ } from './dom';

let timer = 0;

/** Affiche un message ; `ms` = 0 le laisse affiché (progression d'une opération). Un message vide le ferme. */
export function toast(msg: string, ms = 4000) {
  $('toast-msg').textContent = msg;
  $('toast').hidden = !msg;
  clearTimeout(timer);
  if (ms && msg) timer = window.setTimeout(() => toast(''), ms);
}

export function initToast() {
  $('toast-close').onclick = () => toast('');
}
