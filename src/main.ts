// Point d'entrée : branche les modules d'interface puis restaure le montage de cet onglet.
// Chaque module expose une fonction init…() sans effet au chargement : l'ordre ci-dessous est l'ordre réel.

import './style.css';
import { uniqueFile } from './storage/montages';
import { $, clone } from './ui/dom';
import { renderRecent, initFolder } from './ui/folder';
import { initFormat, syncInputs } from './ui/format';
import { initHeic } from './ui/heic';
import { initExportImage } from './ui/exportImage';
import { initAlbum } from './ui/album';
import { initKeyboard } from './ui/keyboard';
import { genInfo, generateLayout, initLayout } from './ui/layout';
import { initLibrary, renderLibrary } from './ui/library';
import { initMontages, renderMontages } from './ui/montages';
import { setupPanels } from './ui/panels';
import { initPersistence } from './ui/persistence';
import { initRulers } from './ui/rulers';
import { app, editor, saved, store } from './ui/state';
import { initToast, toast } from './ui/toast';
import { initToolbar, renderToolbar } from './ui/toolbar';

const panels = setupPanels();
initToast();
editor.onToast = (m) => toast(m);
initPersistence(); // enregistrement automatique : abonné au document juste après l'éditeur
initHeic();
initFolder();
initMontages();
initAlbum();
initFormat();
initLayout();
initLibrary();
initExportImage();
initToolbar();
initRulers();
initKeyboard(panels);
store.subscribe(() => { syncInputs(); renderLibrary(); renderToolbar(); });

// ------------------------------------------------------------------ démarrage

syncInputs();
renderToolbar();
genInfo();
if (!saved) {
  // toute première ouverture : une mise en page d'exemple pour voir tout de suite le principe
  store.doc.name = 'Montage 1';
  generateLayout(true);
  store.replace(store.doc);
}
// Sans dossier ouvert, le montage affiché est le seul de la liste (gardé dans le navigateur).
if (!store.doc.name) store.doc.name = 'Montage 1';
if (!app.currentFile) app.currentFile = uniqueFile(store.doc.name, []);
app.montages = [{ file: app.currentFile, doc: clone(store.doc) }];
renderMontages();
renderLibrary();
renderRecent();
if (app.project) {
  // onglet rechargé : le montage est là, mais Chrome demande un clic pour relire les photos du dossier
  $('project-status').textContent = `${app.project} · cliquer sur le dossier ci-dessous pour recharger ses photos`;
}
