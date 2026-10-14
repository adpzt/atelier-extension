// Formats de déclinaison (réseaux sociaux, display IAB) et zones de sécurité.

export interface SafeZone {
  /** Marges masquées par l'interface, en fraction de la hauteur / largeur. */
  top: number;
  bottom: number;
  left: number;
  right: number;
}

export interface VariantPreset {
  id: string;
  group: 'social' | 'display' | 'custom';
  label: string;
  /** Nom court utilisé dans le nom de fichier. */
  slug: string;
  hint?: string;
  w: number;
  h: number;
  /** Plateformes dont l'interface recouvre ce format. */
  safe?: Record<string, SafeZone>;
}

// Valeurs indicatives (recommandations publiées par les plateformes, arrondies).
export const SAFE_ZONES_VERTICAL: Record<string, SafeZone> = {
  'Instagram Story': { top: 0.14, bottom: 0.14, left: 0.05, right: 0.05 },
  'Reels (Instagram / Facebook)': { top: 0.14, bottom: 0.35, left: 0.06, right: 0.06 },
  TikTok: { top: 0.07, bottom: 0.25, left: 0.06, right: 0.13 },
  'YouTube Shorts': { top: 0.12, bottom: 0.24, left: 0.06, right: 0.18 },
};

export const VARIANT_PRESETS: VariantPreset[] = [
  { id: 'vertical', group: 'social', label: 'Vertical 9:16', slug: 'vertical-9x16', hint: 'Story · Reels · TikTok · Shorts', w: 1080, h: 1920, safe: SAFE_ZONES_VERTICAL },
  { id: 'portrait', group: 'social', label: 'Portrait 4:5', slug: 'portrait-4x5', hint: 'Feed Instagram / Facebook', w: 1080, h: 1350 },
  { id: 'square', group: 'social', label: 'Carré 1:1', slug: 'carre-1x1', hint: 'Feed, carrousel', w: 1080, h: 1080 },
  { id: 'landscape', group: 'social', label: 'Paysage 1.91:1', slug: 'paysage-191x1', hint: 'Lien Facebook / LinkedIn', w: 1200, h: 628 },
  { id: 'wide', group: 'social', label: 'Large 16:9', slug: 'large-16x9', hint: 'YouTube, X, miniature', w: 1920, h: 1080 },
  { id: 'pin', group: 'social', label: 'Pinterest 2:3', slug: 'pinterest-2x3', hint: 'Épingle', w: 1000, h: 1500 },
  { id: 'd300x250', group: 'display', label: 'Pavé', slug: '300x250', w: 300, h: 250 },
  { id: 'd336x280', group: 'display', label: 'Grand pavé', slug: '336x280', w: 336, h: 280 },
  { id: 'd728x90', group: 'display', label: 'Leaderboard', slug: '728x90', w: 728, h: 90 },
  { id: 'd970x250', group: 'display', label: 'Billboard', slug: '970x250', w: 970, h: 250 },
  { id: 'd970x90', group: 'display', label: 'Large leaderboard', slug: '970x90', w: 970, h: 90 },
  { id: 'd300x600', group: 'display', label: 'Half page', slug: '300x600', w: 300, h: 600 },
  { id: 'd160x600', group: 'display', label: 'Skyscraper', slug: '160x600', w: 160, h: 600 },
  { id: 'd120x600', group: 'display', label: 'Skyscraper étroit', slug: '120x600', w: 120, h: 600 },
  { id: 'd320x50', group: 'display', label: 'Bannière mobile', slug: '320x50', w: 320, h: 50 },
  { id: 'd320x100', group: 'display', label: 'Grande bannière mobile', slug: '320x100', w: 320, h: 100 },
  { id: 'd300x1050', group: 'display', label: 'Portrait', slug: '300x1050', w: 300, h: 1050 },
  { id: 'd250x250', group: 'display', label: 'Carré', slug: '250x250', w: 250, h: 250 },
];

export const DEFAULT_VARIANTS = ['vertical', 'portrait', 'square', 'landscape', 'd300x250', 'd728x90', 'd300x600', 'd320x50'];

export interface Focal {
  x: number;
  y: number;
}

/** Zone de l'image source retenue pour un format en mode « recadrer ». */
export function coverCrop(srcW: number, srcH: number, w: number, h: number, focal: Focal) {
  const scale = Math.max(w / srcW, h / srcH);
  const cw = Math.min(srcW, w / scale);
  const ch = Math.min(srcH, h / scale);
  const x = Math.min(Math.max(focal.x * srcW - cw / 2, 0), srcW - cw);
  const y = Math.min(Math.max(focal.y * srcH - ch / 2, 0), srcH - ch);
  return { x, y, w: cw, h: ch, scale };
}

/** Mise en page d'un format : recadrage, ou image entière sur fond (flou ou couleur). */
export interface Compose {
  width: number;
  height: number;
  fit: 'cover' | 'contain';
  focal: Focal;
  /** 'blur' ou couleur hexadécimale. */
  background: string;
}
