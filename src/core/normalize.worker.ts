/// <reference lib="webworker" />
// Worker de « normalisation » : décode un format exotique et le convertit en PNG
// (sans perte), lisible ensuite partout (vignette, comparateur, pipeline d'encodage).
import { decodeExotic, type SourceKind } from './decoders';
import { pngPreview } from './encoders';

declare const self: DedicatedWorkerGlobalScope;

export interface NormalizeRequest {
  id: number;
  kind: SourceKind;
  blob: Blob;
}

export type NormalizeResponse =
  | { id: number; ok: true; png: Blob; width: number; height: number }
  | { id: number; ok: false; message: string };

self.onmessage = async (e: MessageEvent<NormalizeRequest>) => {
  const { id, kind, blob } = e.data;
  try {
    const img = await decodeExotic(kind, await blob.arrayBuffer());
    const png = await pngPreview(img);
    self.postMessage({ id, ok: true, png, width: img.width, height: img.height } satisfies NormalizeResponse);
  } catch (err) {
    self.postMessage({ id, ok: false, message: err instanceof Error ? err.message : String(err) } satisfies NormalizeResponse);
  }
};
