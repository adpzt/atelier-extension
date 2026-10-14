// Côté page : transforme n'importe quel fichier importé en une ou plusieurs sources
// lisibles par le navigateur (PNG sans perte pour les formats exotiques).
import { sniff, KIND_LABEL, type SourceKind } from './decoders';
import type { NormalizeRequest, NormalizeResponse } from './normalize.worker';

export interface NormalizedSource {
  /** Nom affiché (les pages PDF reçoivent un suffixe -p01…). */
  name: string;
  /** Source décodable par createImageBitmap (ou SVG). */
  source: Blob;
  width: number;
  height: number;
  kind: SourceKind;
}

let worker: Worker | null = null;
let nextId = 1;
const pending = new Map<number, (r: NormalizeResponse) => void>();

function normalizeInWorker(req: Omit<NormalizeRequest, "id">): Promise<{ png: Blob; width: number; height: number }> {
  if (!worker) {
    worker = new Worker(new URL('./normalize.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (e: MessageEvent<NormalizeResponse>) => {
      pending.get(e.data.id)?.(e.data);
      pending.delete(e.data.id);
    };
  }
  const id = nextId++;
  return new Promise((resolve, reject) => {
    pending.set(id, (r) => (r.ok ? resolve(r) : reject(new Error(r.message))));
    worker!.postMessage({ ...req, id });
  });
}

async function bitmapSize(blob: Blob): Promise<{ width: number; height: number }> {
  let bmp: ImageBitmap;
  try {
    bmp = await createImageBitmap(blob);
  } catch {
    throw new Error('Format non pris en charge');
  }
  const size = { width: bmp.width, height: bmp.height };
  bmp.close();
  return size;
}

/** Point d'entrée : un fichier importé -> une ou plusieurs sources prêtes. */
export async function normalize(blob: Blob, name: string, opts: { pdfDpi: number; onProgress?: (msg: string) => void }): Promise<NormalizedSource[]> {
  const head = new Uint8Array(await blob.slice(0, 64).arrayBuffer());
  const kind = sniff(head, name, blob.type);

  if (kind === 'svg') {
    // Les SVG sont rastérisés plus tard, à l'échelle choisie (voir source.ts).
    return [{ name, source: blob.type === 'image/svg+xml' ? blob : new Blob([blob], { type: 'image/svg+xml' }), width: 0, height: 0, kind }];
  }
  if (kind === 'native') {
    const size = await bitmapSize(blob);
    return [{ name, source: blob, ...size, kind }];
  }
  if (kind === 'pdf') return renderPdf(blob, name, opts.pdfDpi, opts.onProgress);
  const r = await normalizeInWorker({ kind, blob });
  return [{ name, source: r.png, width: r.width, height: r.height, kind }];
}

export function kindLabel(kind: SourceKind): string {
  return KIND_LABEL[kind];
}

// ---------- PDF : une image par page ----------
async function renderPdf(blob: Blob, name: string, dpi: number, onProgress?: (msg: string) => void): Promise<NormalizedSource[]> {
  const pdfjs = await import('pdfjs-dist');
  pdfjs.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL('pdfjs/pdf.worker.min.mjs');
  const base = chrome.runtime.getURL('pdfjs/');
  const task = pdfjs.getDocument({
    data: new Uint8Array(await blob.arrayBuffer()),
    cMapUrl: `${base}cmaps/`,
    cMapPacked: true,
    standardFontDataUrl: `${base}standard_fonts/`,
    wasmUrl: `${base}wasm/`,
  });
  const doc = await task.promise;
  const stem = name.replace(/\.pdf$/i, '');
  const pad = String(doc.numPages).length < 2 ? 2 : String(doc.numPages).length;
  const out: NormalizedSource[] = [];
  try {
    for (let i = 1; i <= doc.numPages; i++) {
      onProgress?.(`${name} : page ${i}/${doc.numPages}`);
      const page = await doc.getPage(i);
      const viewport = page.getViewport({ scale: dpi / 72 });
      const canvas = document.createElement('canvas');
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      await page.render({ canvas, viewport }).promise;
      const png = await new Promise<Blob>((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error('Rendu PDF impossible'))), 'image/png'));
      out.push({
        name: doc.numPages > 1 ? `${stem}-p${String(i).padStart(pad, '0')}.pdf` : name,
        source: png,
        width: canvas.width,
        height: canvas.height,
        kind: 'pdf',
      });
      page.cleanup();
    }
  } finally {
    await task.destroy();
  }
  return out;
}
