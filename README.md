# Atelier — boîte à outils DA (extension Chrome)

Trois modules dans un panneau latéral, 100 % en local, sans IA, sans service payant.

### Convertir & compresser
- **Entrée** : JPG, PNG, WebP, AVIF, GIF, BMP, ICO, SVG, **HEIC/HEIF** (iPhone), **TIFF**, **PSD/PSB**,
  **PDF** (une image par page), **JPEG XL**, QOI, TGA, **RAW** (CR2, CR3, NEF, ARW, DNG, RAF, ORF, RW2…)
- **Sortie** : JPG, WebP, AVIF, PNG, GIF, JPEG XL, TIFF, PDF (+ PDF unique assemblé), BMP,
  ICO (favicon 16 → 256 px), SVG (vectorisation automatique), QOI
- Curseur de compression ou **poids cible** (ex. ≤ 150 Ko), redimensionnement, réduction de couleurs
- Comparateur avant/après, lots, export ZIP, réglages par image, préréglages
- Ajout : glisser-déposer (dossiers), ⌘V, clic droit sur une image du web, ou depuis « Récupérer »

### Couleurs
- Pipette native de Chrome : **partout sur l'écran**, même hors du navigateur (Photoshop, Figma…). Raccourci `P`
- HEX / HEX # / RGB / CMJN / HSL, **copie automatique du HEX sans #** (prêt pour Photoshop)
- Historique (64 couleurs), export **nuancier .ase** (Photoshop, Illustrator, InDesign)

### Récupérer
- Toutes les images de la page : plus haute résolution des `srcset` / `<picture>`, images en lazy-load,
  fonds CSS (y compris `::before`/`::after`), **SVG intégrés** (sprites `<use>` reconstitués),
  affiches vidéo, favicon, image de partage, images `blob:`
- Filtres par type et taille, sélection, téléchargement (ZIP) ou **envoi direct au convertisseur**

## Installer (avec mises à jour automatiques) — recommandé

Sur chaque Mac, une seule fois :

```bash
curl -fsSL https://raw.githubusercontent.com/adpzt/atelier-extension/main/scripts/install-mac.sh | bash
```

Le script installe l'extension dans `~/Library/Application Support/Atelier/extension` et ajoute une tâche
de fond qui récupère la dernière version toutes les 15 min. Il affiche ensuite la dernière étape à faire
dans Chrome (charger le dossier, une seule fois). L'extension se recharge toute seule à chaque nouvelle
version, dès que le panneau est fermé. **Le Mode développeur de Chrome doit rester activé.**

Publier une nouvelle version = pousser sur `main`. GitHub Actions build l'extension et la publie sur la
branche `release` (version `0.2.<numéro de build>`, affichée à côté du logo dans le panneau).

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
public/manifest.json          manifeste MV3 (permissions, side panel, CSP WASM)
src/background.ts             service worker : panneau, clic droit, mise à jour auto, presse-papier
src/offscreen/                document invisible pour copier sans focus (pipette hors de Chrome)
src/core/                     moteur indépendant de l'interface
  decoders.ts                 HEIC, TIFF, PSD, JPEG XL, QOI, TGA, RAW + détection du format
  normalize.ts (+ .worker)    import universel : tout fichier → source lisible (PDF via pdf.js)
  pipeline.ts                 redimensionnement → fond → encodage, poids cible
  encoders.ts                 BMP, ICO, TIFF, PDF, SVG (vectorisation), QOI, JPEG XL
  quantize.ts                 réduction de couleurs + tramage (PNG/GIF)
  worker.ts, pool.ts          encodage en parallèle dans des Web Workers
src/sidepanel/                interface du panneau latéral
  nav.ts                      onglets Convertir / Couleurs / Récupérer
  store.ts, components/       module Convertir
  modules/colors.ts           module Couleurs
  modules/grab*.ts            module Récupérer (grab-collect.ts est injecté dans la page)
src/lib/                      fichiers/ZIP, couleurs/.ase, presse-papier, stockage
scripts/install-mac.sh        installation + mise à jour automatique
```

## Limites connues

- **RAW** : on utilise l'aperçu JPEG intégré par l'appareil (pleine résolution chez Canon et Nikon,
  parfois réduite chez Sony ou Fuji). Pas de développement RAW (balance des blancs, exposition…).
- **PSD** : on lit l'image aplatie ; le fichier doit avoir été enregistré avec « Maximiser la compatibilité ».
- **CMJN** affiché : conversion standard sans profil ICC, proche mais pas identique à Photoshop.
- **GIF animés** : seule la première image est convertie.
- **SVG en sortie** : vectorisation par aplats, idéale pour logos et pictos, pas pour les photos.
- La pipette et la récupération ne fonctionnent pas sur les pages internes de Chrome (chrome://, Web Store).
