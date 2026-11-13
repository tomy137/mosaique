# Mosaïque

Outil local pour composer des montages photo à cases (coupes droites ou obliques, gouttière régulière) et les exporter pour l'impression.

```
npm install
npm run dev      # http://localhost:5173 — Chrome recommandé
```

## Principe
Un **dossier de photos** (ta sélection) contient **plusieurs montages**. Ils sont enregistrés à côté des photos :

```
Mon dossier/
  IMG_0001.jpg …
  mosaique-montages/
    Noël mamie.json          ← un fichier par montage
    .historique/             ← copies datées (30 dernières par montage)
    .corbeille/              ← montages supprimés
```

## Utilisation
1. **Ouvrir un dossier** : glisser le dossier depuis le Finder sur la page (ou `O`). Les dossiers récents se rouvrent d'un clic. Si Chrome le demande, cliquer sur « Autoriser l'enregistrement dans le dossier ».
2. **Montages** : `N` pour un nouveau montage (il prend des photos pas encore utilisées), « Dupliquer », « Supprimer » (vers la corbeille), renommer dans le champ du nom. Enregistrement automatique, et `⌘S` pour enregistrer avec une copie dans l'historique.
3. **Format** : choisir une taille préférée, ou saisir largeur/hauteur/dpi puis « ★ Enregistrer ». Gouttière, marge et fond au même endroit.
4. **Générer** (`G`) une mise en page : une case par photo, au ratio proche de la photo. « Variante » (`⇧G`). La case « Éviter les photos des autres montages » est cochée par défaut.
5. **Retoucher** :
   - Sélection (`V`) : glisser une coupe pour la déplacer, ses poignées pour la faire pivoter (`⌥` sans aimant), `R` pour la redresser, `⌫` pour la supprimer ;
   - Couper (`C`) : un clic coupe la case, un glisser trace une coupe libre ;
   - photos : glisser pour recadrer, molette pour zoomer, double-clic pour recentrer, `⇧` + glisser pour échanger ;
   - pastille rouge : photo sous 150 dpi ; pastille orange : photo aussi utilisée dans un autre montage (le chiffre = nombre de montages).
6. **Plein écran** (`P`, Échap pour revenir) : le montage seul.
7. **Exporter** : JPEG, PDF ou PNG à la taille d'impression, JPEG écran, tracé SVG.
8. **Sauvegarder / transmettre un montage** : « Exporter .json » (montage seul) ou « Exporter .zip » (montage + photos originales). « Importer un montage… » ou glisser le fichier sur la page : il devient un nouveau montage du dossier ouvert, sans rien écraser.

Les photos HEIC ne sont pas lues par Chrome : l'appli affiche la commande de conversion prête à copier.

## Technique
Vite + TypeScript, sans serveur (le serveur de dev ajoute seulement `/api/locate` pour la commande HEIC). La mise en page est un arbre de coupes (`src/geometry/bsp.ts`) ; les montages d'un dossier sont gérés par `src/montages.ts`, l'export/import par `src/archive.ts`. Tests : `npm test`.
