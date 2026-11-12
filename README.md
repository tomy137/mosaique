# Mosaïque

Outil local pour composer des montages photo à cases (coupes droites ou obliques, gouttière régulière) et les exporter pour l'impression.

```
npm install
npm run dev      # http://localhost:5173 — Chrome recommandé
```

## Utilisation
1. **Ouvrir un dossier** (`O`) contenant les photos. Le montage y est enregistré automatiquement dans `montage.json`. Au prochain lancement, « Rouvrir » reprend le même dossier.
2. **Format** : choisir une taille préférée, ou saisir largeur/hauteur/dpi puis « ★ Enregistrer » pour l'ajouter aux tailles préférées. Gouttière, marge et couleur de fond se règlent au même endroit.
3. **Générer** (`G`) une mise en page : une case par photo, au ratio proche de la photo, avec une part de coupes obliques. « Variante » (`⇧G`) donne une autre proposition.
4. **Retoucher** :
   - en mode Sélection (`V`) : glisser une coupe pour la déplacer, glisser ses poignées pour la faire pivoter (aimantée H/V, `⌥` pour l'angle libre), `R` pour la redresser, `⌫` pour la supprimer ;
   - en mode Couper (`C`) : un clic coupe la case à cet endroit, un glisser trace une coupe libre ;
   - pour les photos : glisser pour recadrer, molette pour zoomer, double-clic pour recentrer, `⇧` + glisser pour échanger deux photos, glisser depuis la bibliothèque pour placer une photo ;
   - une pastille rouge signale une photo sous 150 dpi à l'impression.
5. **Exporter** : JPEG, PDF ou PNG à la taille d'impression, JPEG écran (largeur en px), ou tracé SVG des cases pour Illustrator.

Les photos HEIC ne sont pas lues par Chrome. Pour les convertir : `sips -s format jpeg *.HEIC --out .`

## Technique
Vite + TypeScript, sans serveur. La mise en page est un arbre de coupes (`src/geometry/bsp.ts`). Les cases sont les feuilles de l'arbre ; elles se recalculent à chaque déplacement, et les photos gardent leur cadrage relatif (`src/photos/crop.ts`). Tests : `npm test`.
