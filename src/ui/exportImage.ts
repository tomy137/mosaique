// Export image : JPEG, PNG, PDF à la taille d'impression, JPEG écran, tracé SVG.

import { albumJpegZip, albumPdf, download, layoutSvg, pxForPrint, renderCanvas, toImageBlob, toPdfBlob } from '../render/export';
import { allPhotos, isAlbum, pageCount, pageLabel } from '../storage/album';
import { $, fileSafe, num } from './dom';
import { renderPresets } from './format';
import { renderMontages } from './montages';
import { currentName, lib, store } from './state';
import { toast } from './toast';

type Kind = 'jpg' | 'png' | 'pdf' | 'screen';

async function runExport(kind: Kind) {
  const doc = store.doc;
  const width = kind === 'screen' ? Math.max(400, num('screen-w') || 2400) : pxForPrint(doc);
  const missing = Object.values(doc.crops).filter((c) => !lib.get(c.photo)).length;
  if (missing) toast(`${missing} photo(s) manquante(s) : leurs cases seront grises.`);
  const buttons = document.querySelectorAll<HTMLButtonElement>('#sidebar button');
  buttons.forEach((b) => (b.disabled = true));
  try {
    const canvas = await renderCanvas(doc, lib, width, (d, t) => toast(`Export : case ${d}/${t}…`, 0));
    toast('Encodage…', 0);
    const base = fileSafe(currentName());
    const size = `${doc.settings.widthMm / 10}x${doc.settings.heightMm / 10}cm`;
    const out: Record<Kind, () => Promise<[Blob, string]>> = {
      pdf: async () => [await toPdfBlob(canvas, doc), `${base}-${size}.pdf`],
      png: async () => [await toImageBlob(canvas, 'image/png'), `${base}-${size}.png`],
      screen: async () => [await toImageBlob(canvas, 'image/jpeg', 0.88), `${base}-ecran-${width}px.jpg`],
      jpg: async () => [await toImageBlob(canvas, 'image/jpeg', 0.93), `${base}-${size}-${doc.settings.dpi}dpi.jpg`],
    };
    const [blob, name] = await out[kind]();
    download(blob, name);
    toast(`${name} · ${(blob.size / 1e6).toFixed(1)} Mo · ${canvas.width} × ${canvas.height} px`, 8000);
  } catch (e) {
    toast(`Échec de l'export : ${(e as Error).message}`, 10000);
  } finally {
    buttons.forEach((b) => (b.disabled = false));
    // certains boutons sont désactivés selon l'état : on le rétablit
    renderPresets();
    renderMontages();
  }
}

/** Album entier : un PDF (une page par page) ou un .zip de JPEG, à la résolution d'impression. */
async function runAlbumExport(kind: 'pdf' | 'zip') {
  const doc = store.doc;
  if (!isAlbum(doc)) return;
  const missing = [...allPhotos(doc)].filter((p) => !lib.get(p)).length;
  if (missing) toast(`${missing} photo(s) manquante(s) : leurs cases seront grises.`);
  const buttons = document.querySelectorAll<HTMLButtonElement>('#sidebar button');
  buttons.forEach((b) => (b.disabled = true));
  try {
    const progress = (i: number, n: number) => toast(`Export de l'album : ${pageLabel(i)} (${i + 1}/${n})…`, 0);
    const blob = kind === 'pdf' ? await albumPdf(doc, lib, progress) : await albumJpegZip(doc, lib, progress);
    const s = doc.settings;
    const name = `${fileSafe(currentName())}-${s.widthMm / 10}x${s.heightMm / 10}cm-${pageCount(doc)}p.${kind}`;
    download(blob, name);
    toast(`${name} · ${(blob.size / 1e6).toFixed(1)} Mo · ${pageCount(doc)} pages${s.bleedMm ? `, fond perdu ${s.bleedMm} mm compris` : ''}.`, 10000);
  } catch (e) {
    toast(`Échec de l'export de l'album : ${(e as Error).message}`, 10000);
  } finally {
    buttons.forEach((b) => (b.disabled = false));
    renderPresets();
    renderMontages();
  }
}

export function initExportImage() {
  $('btn-album-pdf').onclick = () => runAlbumExport('pdf');
  $('btn-album-zip').onclick = () => runAlbumExport('zip');
  store.subscribe(() => { $('album-export').hidden = !isAlbum(store.doc); });
  $('album-export').hidden = !isAlbum(store.doc);
  $<HTMLInputElement>('screen-w').value = '2400';
  $('btn-jpg').onclick = () => runExport('jpg');
  $('btn-png').onclick = () => runExport('png');
  $('btn-pdf').onclick = () => runExport('pdf');
  $('btn-screen').onclick = () => runExport('screen');
  $('btn-svg').onclick = () => download(new Blob([layoutSvg(store.doc)], { type: 'image/svg+xml' }), `${fileSafe(currentName())}-trace.svg`);
}
