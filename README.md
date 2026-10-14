# Atelier — boîte à outils DA (extension Chrome)

Module 1 : **Convertir & compresser** des images, 100 % en local, sans limite.

- Entrée : JPG, PNG, WebP, AVIF, GIF, BMP, ICO, SVG
- Sortie : JPG (MozJPEG), WebP, AVIF, PNG (oxipng, réduction de couleurs optionnelle), GIF
- Curseur de compression, ou **poids cible** (ex. ≤ 150 Ko pour une bannière display)
- Redimensionnement (largeur, hauteur, plus grand côté, %), fond pour la transparence, échelle des SVG
- Comparateur avant/après, taille réelle 100 %, gain en % en direct
- Traitement par lot en parallèle, export ZIP, modèle de nom (`{nom}_{w}x{h}`…)
- Réglages par image, préréglages enregistrables
- Ajout d'images : glisser-déposer (dossiers compris), ⌘V, bouton parcourir, **clic droit sur une image du web**

## Installer (avec mises à jour automatiques) — recommandé

Sur chaque Mac, une seule fois :

```bash
git clone https://github.com/adpzt/atelier-extension.git /tmp/atelier && bash /tmp/atelier/scripts/install-mac.sh
```

Le script installe l'extension dans `~/Library/Application Support/Atelier/extension` et ajoute une tâche
de fond qui récupère la dernière version toutes les 15 min. Il affiche ensuite la dernière étape à faire
dans Chrome (charger le dossier, une seule fois). L'extension se recharge toute seule à chaque nouvelle
version, dès que le panneau est fermé. **Le Mode développeur de Chrome doit rester activé.**

Publier une nouvelle version = pousser sur `main`. GitHub Actions build l'extension et la publie sur la
branche `release` (version `0.1.<numéro de build>`, visible en survolant le logo dans le panneau).

## Installer à la main (développement)

```bash
npm install
npm run build
```

Puis, dans Chrome :
1. Ouvre `chrome://extensions`
2. Active le **Mode développeur** (en haut à droite)
3. Clique **Charger l'extension non empaquetée** et choisis le dossier `dist/`
4. Épingle l'icône Atelier dans la barre d'outils : un clic ouvre le panneau latéral

Après une modification du code : `npm run build`, puis le bouton ↻ de l'extension dans `chrome://extensions`.
`npm run dev` reconstruit automatiquement à chaque sauvegarde (il faut quand même cliquer sur ↻).

## Structure

```
public/manifest.json        manifeste MV3 (permissions, side panel, CSP WASM)
src/background.ts           service worker : ouverture du panneau, menu clic droit
src/core/                   moteur indépendant de l'interface (réutilisable par les futurs modules)
  pipeline.ts               décodage → redimensionnement → fond → encodage, poids cible
  quantize.ts               réduction de couleurs + tramage (PNG/GIF)
  worker.ts, pool.ts        encodage en parallèle dans des Web Workers
  source.ts                 préparation des sources (rastérisation SVG)
  types.ts                  réglages, formats
src/sidepanel/              interface du panneau latéral
  store.ts                  état + ordonnanceur (l'image sélectionnée passe en priorité)
  components/               dropzone, compare, settings, queue, presets, footer
src/lib/                    fichiers/ZIP/noms, stockage, boîte de réception clic droit
scripts/make-icons.mjs      régénère les icônes (node scripts/make-icons.mjs)
```

## Limites connues (V1)

- HEIC, TIFF, PSD, PDF : non pris en charge (prévu en V2)
- GIF animés : seule la première image est convertie
- Images protégées par certaines pages (URL `blob:`) : impossible à récupérer via le clic droit, il faut les enregistrer d'abord
