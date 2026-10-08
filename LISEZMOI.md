# Ma collection Pokémon : mise à jour v2 (prix automatiques du scellé)

## Ce qui change
- **Scellé** : tu cherches ton produit dans le catalogue Cardmarket (en français ou en anglais : « display 151 », « ETB évolutions prismatiques »). Son prix se met ensuite à jour tout seul chaque jour.
- **Cartes gradées** : tu indiques une seule fois ce que vaut ta gradée. L'appli en déduit un coefficient par rapport au prix de la carte, puis la valeur suit le marché chaque jour.
- **Cartes** : rien ne change, le prix reste automatique.

Le prix du scellé vient des fichiers publics et gratuits de Cardmarket. Un petit robot GitHub, gratuit lui aussi, les télécharge chaque matin vers 7 h et les range dans ton dépôt.

## Mettre à jour ton dépôt (une seule fois)
1. Décompresse le zip sur ton ordinateur.
2. Ouvre https://github.com/warcat0/ma-collection, puis **Add file → Upload files**.
3. Glisse **tout le contenu** du dossier décompressé dans la page, dossiers `.github` et `scripts` compris, puis clique sur **Commit changes**. Les anciens fichiers sont remplacés.
4. Vérifie que ces deux fichiers apparaissent bien dans le dépôt :
   - `.github/workflows/prix.yml`
   - `scripts/maj-prix.mjs`

   S'il en manque un, utilise **Add file → Create new file**. Tape le chemin exact comme nom (par exemple `.github/workflows/prix.yml`), colle le contenu du fichier, puis clique sur **Commit**.

## Lancer le premier relevé de prix
1. Ouvre https://github.com/warcat0/ma-collection/actions
2. À gauche, clique sur **Prix du jour**, puis à droite sur **Run workflow**, puis sur le bouton vert **Run workflow**.
3. Attends environ une minute que la coche verte apparaisse. Un dossier `data` est alors créé dans ton dépôt.

Ensuite, tout se fait automatiquement chaque jour. Tu n'as plus rien à faire.

## Dans l'appli
- Ferme l'appli complètement, puis rouvre-la pour charger la nouvelle version.
- Pour un scellé déjà saisi à la main : ouvre-le, touche **Modifier**, puis **Chercher le produit dans le catalogue**.
- Pour une gradée déjà saisie : touche **Modifier**, choisis **Automatique : prix de la carte × coefficient** et indique sa valeur actuelle.

## Bon à savoir
- Les noms du catalogue Cardmarket sont en anglais. Les noms français les plus courants (displays, ETB, noms des extensions) sont traduits automatiquement pendant la recherche.
- Le prix Cardmarket est une moyenne toutes langues confondues. Si ton scellé français vaut plus ou moins cher, choisis **Automatique × coefficient** (par exemple ×1,15).
- **Sauvegarde** : va dans Réglages, puis Exporter, de temps en temps.
