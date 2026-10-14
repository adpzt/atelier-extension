export type OutFormat = 'jpeg' | 'webp' | 'avif' | 'png' | 'gif';

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
  /** Nombre de couleurs pour PNG / GIF. 0 = toutes (PNG sans perte). */
  colors: number;
  dithering: boolean;
  resize: ResizeSettings;
  /** Couleur de fond utilisée quand le format de sortie ne gère pas la transparence. */
  background: string;
  /** Facteur de rastérisation des SVG. */
  svgScale: number;
  /** Modèle de nom : {nom} {w} {h} {format} {qualite} {index} */
  filenamePattern: string;
}

export interface FormatInfo {
  id: OutFormat;
  label: string;
  ext: string;
  mime: string;
  lossy: boolean;
  alpha: boolean;
  supportsLossless: boolean;
  supportsColors: boolean;
}

export const FORMATS: Record<OutFormat, FormatInfo> = {
  jpeg: { id: 'jpeg', label: 'JPG', ext: 'jpg', mime: 'image/jpeg', lossy: true, alpha: false, supportsLossless: false, supportsColors: false },
  webp: { id: 'webp', label: 'WebP', ext: 'webp', mime: 'image/webp', lossy: true, alpha: true, supportsLossless: true, supportsColors: false },
  avif: { id: 'avif', label: 'AVIF', ext: 'avif', mime: 'image/avif', lossy: true, alpha: true, supportsLossless: true, supportsColors: false },
  png: { id: 'png', label: 'PNG', ext: 'png', mime: 'image/png', lossy: false, alpha: true, supportsLossless: false, supportsColors: true },
  gif: { id: 'gif', label: 'GIF', ext: 'gif', mime: 'image/gif', lossy: false, alpha: true, supportsLossless: false, supportsColors: true },
};

export const FORMAT_ORDER: OutFormat[] = ['jpeg', 'webp', 'avif', 'png', 'gif'];

export const DEFAULT_SETTINGS: Settings = {
  format: 'webp',
  compression: 20,
  mode: 'quality',
  targetKB: 150,
  lossless: false,
  colors: 0,
  dithering: true,
  resize: { mode: 'none', value: 1920, noUpscale: true },
  background: '#ffffff',
  svgScale: 2,
  filenamePattern: '{nom}',
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
