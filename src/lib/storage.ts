import { DEFAULT_SETTINGS, cloneSettings, type Settings } from '../core/types';

export interface Preset {
  id: string;
  name: string;
  builtin?: boolean;
  settings: Settings;
}

const preset = (id: string, name: string, patch: Partial<Settings>): Preset => ({
  id,
  name,
  builtin: true,
  settings: { ...cloneSettings(DEFAULT_SETTINGS), ...patch },
});

export const BUILTIN_PRESETS: Preset[] = [
  preset('web-webp', 'Web léger — WebP 80', { format: 'webp', compression: 20, mode: 'quality' }),
  preset('display-150', 'Display ≤ 150 Ko — JPG', { format: 'jpeg', mode: 'target', targetKB: 150 }),
  preset('social-1080', 'Réseaux sociaux — JPG 1080 px', {
    format: 'jpeg',
    compression: 12,
    mode: 'quality',
    resize: { mode: 'width', value: 1080, noUpscale: true },
  }),
  preset('png-hd', 'PNG HD sans perte', { format: 'png', colors: 0 }),
  preset('png-tiny', 'PNG compressé — 256 couleurs', { format: 'png', colors: 256, dithering: true }),
  preset('avif-max', 'AVIF ultra léger', { format: 'avif', compression: 45, mode: 'quality' }),
];

const KEYS = { settings: 'kotak.settings', presets: 'kotak.presets' } as const;

function hasStorage(): boolean {
  return typeof chrome !== 'undefined' && !!chrome.storage?.local;
}

export async function loadSettings(): Promise<Settings> {
  if (!hasStorage()) return cloneSettings(DEFAULT_SETTINGS);
  try {
    const r = await chrome.storage.local.get(KEYS.settings);
    const saved = r[KEYS.settings] as Partial<Settings> | undefined;
    return mergeSettings(saved);
  } catch {
    return cloneSettings(DEFAULT_SETTINGS);
  }
}

export async function saveSettings(s: Settings): Promise<void> {
  if (!hasStorage()) return;
  await chrome.storage.local.set({ [KEYS.settings]: s }).catch(() => undefined);
}

export async function loadUserPresets(): Promise<Preset[]> {
  if (!hasStorage()) return [];
  try {
    const r = await chrome.storage.local.get(KEYS.presets);
    const list = (r[KEYS.presets] as Preset[] | undefined) ?? [];
    return list.map((p) => ({ ...p, builtin: false, settings: mergeSettings(p.settings) }));
  } catch {
    return [];
  }
}

export async function saveUserPresets(list: Preset[]): Promise<void> {
  if (!hasStorage()) return;
  await chrome.storage.local.set({ [KEYS.presets]: list }).catch(() => undefined);
}

/** Complète des réglages sauvegardés avec les valeurs par défaut (champs ajoutés plus tard). */
function mergeSettings(saved: Partial<Settings> | undefined): Settings {
  const base = cloneSettings(DEFAULT_SETTINGS);
  if (!saved) return base;
  return { ...base, ...saved, resize: { ...base.resize, ...(saved.resize ?? {}) } };
}
