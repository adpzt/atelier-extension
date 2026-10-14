import { zipSync } from 'fflate';
import { FORMATS, qualityOf, type Settings } from '../core/types';

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} o`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0).replace('.', ',')} Ko`;
  return `${(bytes / 1024 / 1024).toFixed(2).replace('.', ',')} Mo`;
}

export function savingPercent(before: number, after: number): number {
  if (!before) return 0;
  return Math.round((1 - after / before) * 100);
}

export function baseName(name: string): string {
  return name.replace(/\.[^./\\]+$/, '') || 'image';
}

function sanitize(name: string): string {
  return name.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '-').replace(/\s+/g, ' ').trim() || 'image';
}

export interface NameContext {
  originalName: string;
  width: number;
  height: number;
  index: number;
  quality: number | null;
  settings: Settings;
}

export function outputName(ctx: NameContext): string {
  const f = FORMATS[ctx.settings.format];
  const q = ctx.quality ?? (f.lossy ? qualityOf(ctx.settings) : 100);
  const pattern = ctx.settings.filenamePattern.trim() || '{nom}';
  const stem = pattern
    .replace(/\{nom\}/g, baseName(ctx.originalName))
    .replace(/\{w\}/g, String(ctx.width))
    .replace(/\{h\}/g, String(ctx.height))
    .replace(/\{format\}/g, f.ext)
    .replace(/\{qualite\}/g, String(q))
    .replace(/\{index\}/g, String(ctx.index).padStart(2, '0'));
  return `${sanitize(stem)}.${f.ext}`;
}

/** Rend les noms uniques : photo.webp, photo-2.webp, ... */
export function dedupeNames(names: string[]): string[] {
  const seen = new Map<string, number>();
  return names.map((n) => {
    const key = n.toLowerCase();
    const count = (seen.get(key) ?? 0) + 1;
    seen.set(key, count);
    if (count === 1) return n;
    const dot = n.lastIndexOf('.');
    return `${n.slice(0, dot)}-${count}${n.slice(dot)}`;
  });
}

export async function buildZip(entries: { name: string; blob: Blob }[]): Promise<Blob> {
  const files: Record<string, [Uint8Array, { level: 0 }]> = {};
  for (const e of entries) {
    // Images déjà compressées : on stocke sans recompresser (bien plus rapide).
    files[e.name] = [new Uint8Array(await e.blob.arrayBuffer()), { level: 0 }];
  }
  const zipped = zipSync(files);
  return new Blob([zipped as BlobPart], { type: 'application/zip' });
}

export function timestamp(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
}

/** Téléchargement via l'API downloads (repli sur un lien <a download>). */
export async function downloadBlob(blob: Blob, filename: string): Promise<void> {
  const url = URL.createObjectURL(blob);
  try {
    if (chrome?.downloads?.download) {
      await chrome.downloads.download({ url, filename, conflictAction: 'uniquify' });
    } else {
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.click();
    }
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }
}
