export type OutFormat = 'jpeg' | 'webp' | 'avif' | 'png' | 'gif' | 'jxl' | 'tiff' | 'pdf' | 'bmp' | 'ico' | 'svg' | 'qoi';

export type ResizeMode = 'none' | 'width' | 'height' | 'longest' | 'percent';

export interface ResizeSettings {
  mode: ResizeMode;
  /** Pixels pour width/height/longest, pourcentage pour percent. */
  value: number;
  /** Ne jamais agrandir une image plus petite que la cible. */
  noUpscale: boolean;
}

export interface Settings {
  format: OutFormat;
  /** 0 = qualité max, 100 = compression max. Qualité encodeur = 100 - compression. */
  compression: number;
  /** quality : on applique le % de compression. target : on vise un poids max. */
  mode: 'quality' | 'target';
  targetKB: number;
  /** Sans perte (WebP / AVIF). */
  lossless: boolean;
  /** Nombre de couleurs pour PNG / GIF / SVG. 0 = toutes (PNG sans perte). */
  colors: number;
  /** Nombre de couleurs de la vectorisation SVG. */
  svgColors: number;
  dithering: boolean;
  resize: ResizeSettings;
  /** Couleur de fond utilisée quand le format de sortie ne gère pas la transparence. */
  background: string;
  /** Facteur de rastérisation des SVG. */
  svgScale: number;
  /** Modèle de nom : {nom} {w} {h} {format} {qualite} {index} */
  filenamePattern: string;
  /** Résolution de rendu des pages PDF importées (appliquée à l'import). */
  pdfDpi: number;
}

export interface FormatInfo {
  id: OutFormat;
  label: string;
  ext: string;
  mime: string;
  /** Qualité réglable (curseur de compression / poids cible). */
  lossy: boolean;
  alpha: boolean;
  supportsLossless: boolean;
  /** Nombre de couleurs réglable (PNG, GIF, SVG vectorisé). */
  supportsColors: boolean;
  /** Chrome sait afficher le fichier tel quel (sinon on fournit un aperçu PNG). */
  displayable: boolean;
  group: 'web' | 'print' | 'special';
  hint: string;
}

const fmt = (f: FormatInfo) => f;

export const FORMATS: Record<OutFormat, FormatInfo> = {
  jpeg: fmt({ id: 'jpeg', label: 'JPG', ext: 'jpg', mime: 'image/jpeg', lossy: true, alpha: false, supportsLossless: false, supportsColors: false, displayable: true, group: 'web', hint: 'Photos, universel' }),
  webp: fmt({ id: 'webp', label: 'WebP', ext: 'webp', mime: 'image/webp', lossy: true, alpha: true, supportsLossless: true, supportsColors: false, displayable: true, group: 'web', hint: 'Web, léger, transparence' }),
  avif: fmt({ id: 'avif', label: 'AVIF', ext: 'avif', mime: 'image/avif', lossy: true, alpha: true, supportsLossless: true, supportsColors: false, displayable: true, group: 'web', hint: 'Le plus léger pour le web' }),
  png: fmt({ id: 'png', label: 'PNG', ext: 'png', mime: 'image/png', lossy: false, alpha: true, supportsLossless: false, supportsColors: true, displayable: true, group: 'web', hint: 'Sans perte, transparence' }),
  gif: fmt({ id: 'gif', label: 'GIF', ext: 'gif', mime: 'image/gif', lossy: false, alpha: true, supportsLossless: false, supportsColors: true, displayable: true, group: 'web', hint: '256 couleurs max' }),
  jxl: fmt({ id: 'jxl', label: 'JPEG XL', ext: 'jxl', mime: 'image/jxl', lossy: true, alpha: true, supportsLossless: true, supportsColors: false, displayable: false, group: 'web', hint: 'Nouvelle génération (Safari, Photoshop)' }),
  tiff: fmt({ id: 'tiff', label: 'TIFF', ext: 'tif', mime: 'image/tiff', lossy: false, alpha: true, supportsLossless: false, supportsColors: false, displayable: false, group: 'print', hint: 'Impression, sans perte' }),
  pdf: fmt({ id: 'pdf', label: 'PDF', ext: 'pdf', mime: 'application/pdf', lossy: true, alpha: false, supportsLossless: true, supportsColors: false, displayable: false, group: 'print', hint: 'Une page par image, ou assemblé' }),
  bmp: fmt({ id: 'bmp', label: 'BMP', ext: 'bmp', mime: 'image/bmp', lossy: false, alpha: true, supportsLossless: false, supportsColors: false, displayable: true, group: 'print', hint: 'Bitmap brut' }),
  ico: fmt({ id: 'ico', label: 'ICO', ext: 'ico', mime: 'image/x-icon', lossy: false, alpha: true, supportsLossless: false, supportsColors: false, displayable: true, group: 'special', hint: 'Favicon multi-tailles (16 → 256 px)' }),
  svg: fmt({ id: 'svg', label: 'SVG', ext: 'svg', mime: 'image/svg+xml', lossy: false, alpha: true, supportsLossless: false, supportsColors: true, displayable: true, group: 'special', hint: 'Vectorisation automatique (logos, aplats)' }),
  qoi: fmt({ id: 'qoi', label: 'QOI', ext: 'qoi', mime: 'image/qoi', lossy: false, alpha: true, supportsLossless: false, supportsColors: false, displayable: false, group: 'special', hint: 'Sans perte, ultra rapide' }),
};

export const FORMAT_ORDER: OutFormat[] = ['jpeg', 'webp', 'avif', 'png', 'gif', 'jxl', 'tiff', 'pdf', 'bmp', 'ico', 'svg', 'qoi'];

export const DEFAULT_SETTINGS: Settings = {
  format: 'webp',
  compression: 20,
  mode: 'quality',
  targetKB: 150,
  lossless: false,
  colors: 0,
  svgColors: 16,
  dithering: true,
  resize: { mode: 'none', value: 1920, noUpscale: true },
  background: '#ffffff',
  svgScale: 2,
  filenamePattern: '{nom}',
  pdfDpi: 150,
};

/** Le mode poids cible n'a de sens que pour les formats avec perte. */
export function usesTargetSize(s: Settings): boolean {
  const f = FORMATS[s.format];
  return s.mode === 'target' && f.lossy && !(s.lossless && f.supportsLossless);
}

export function qualityOf(s: Settings): number {
  return clamp(Math.round(100 - s.compression), 1, 100);
}

export function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

export function cloneSettings(s: Settings): Settings {
  return { ...s, resize: { ...s.resize } };
}

/** Messages échangés avec les workers d'encodage. */
export interface ProcessRequest {
  type: 'process';
  jobId: number;
  /** Clé de cache du décodage (même source => même clé). */
  sourceKey: string;
  source: Blob;
  settings: Settings;
}

export interface ProcessResult {
  type: 'done';
  jobId: number;
  blob: Blob;
  /** Aperçu affichable quand Chrome ne sait pas afficher le format (TIFF, JXL, PDF…). */
  preview: Blob | null;
  width: number;
  height: number;
  /** Qualité réellement utilisée (utile en mode poids cible). */
  quality: number | null;
  /** En mode poids cible : l'objectif est-il atteint ? */
  targetMet: boolean | null;
}

export interface ProcessError {
  type: 'error';
  jobId: number;
  message: string;
}

export type WorkerResponse = ProcessResult | ProcessError;
