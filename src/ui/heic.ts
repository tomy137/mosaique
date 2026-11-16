// Photos HEIC (iPhone), que Chrome ne sait pas lire : commande de conversion prête à copier.

import { $ } from './dom';
import { toast } from './toast';

const shellQuote = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;

/** Commande de conversion : un .jpg à côté de chaque .HEIC (sips garderait sinon l'extension .HEIC). */
export function heicCommand(dir: string | null): string {
  const cd = dir ? `cd ${shellQuote(dir)}` : `cd « glisser ici le dossier depuis le Finder »`;
  return `${cd} && for f in *.[hH][eE][iI][cC]; do sips -s format jpeg "$f" --out "\${f%.*}.jpg" >/dev/null; done && echo "Conversion terminée"`;
}

export async function showHeicHelp(folderName: string, heic: string[]) {
  if (!heic.length) { $('heic-box').hidden = true; return; }
  $('heic-count').textContent = `${heic.length} photo(s) HEIC ignorée(s)`;
  $('heic-cmd').textContent = heicCommand(null);
  $('heic-after').textContent = 'Recherche du chemin du dossier…';
  $('heic-box').hidden = false;
  // Le chemin complet n'est connu qu'en version locale (serveur de dev, /api/locate) ; en ligne, commande générique.
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);
  let dir: string | null = null;
  if (local) {
    try {
      const r = await fetch(`/api/locate?name=${encodeURIComponent(folderName)}&file=${encodeURIComponent(heic[0])}`);
      dir = (await r.json()).path ?? null;
    } catch { /* serveur sans l'API : commande générique */ }
  }
  $('heic-cmd').textContent = heicCommand(dir);
  $('heic-after').textContent = (dir
    ? ''
    : `${local ? `Chemin de « ${folderName} » introuvable automatiquement` : 'Version en ligne : chemin du dossier inconnu'} : remplacer la partie entre guillemets en glissant le dossier dans le Terminal. `)
    + 'Une fois la conversion terminée, glisser à nouveau le dossier sur la page.';
}

export function initHeic() {
  $('btn-heic-copy').onclick = async () => {
    try {
      await navigator.clipboard.writeText($('heic-cmd').textContent ?? '');
      toast('Commande copiée : la coller dans le Terminal (⌘V puis Entrée).');
    } catch {
      toast('Copie impossible : sélectionner la commande et faire ⌘C.');
    }
  };
  $('btn-heic-close').onclick = () => ($('heic-box').hidden = true);
}
