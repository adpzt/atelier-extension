/// <reference lib="webworker" />
import { decodeToImageData, runPipeline } from './pipeline';
import type { ProcessRequest, WorkerResponse } from './types';

declare const self: DedicatedWorkerGlobalScope;

// Petit cache des images décodées : quand on bouge un curseur,
// la même source est ré-encodée sans être re-décodée.
const CACHE_SIZE = 2;
const cache = new Map<string, ImageData>();

async function getDecoded(key: string, source: Blob): Promise<ImageData> {
  const hit = cache.get(key);
  if (hit) {
    cache.delete(key);
    cache.set(key, hit);
    return hit;
  }
  const img = await decodeToImageData(source);
  cache.set(key, img);
  while (cache.size > CACHE_SIZE) cache.delete(cache.keys().next().value!);
  return img;
}

self.onmessage = async (e: MessageEvent<ProcessRequest>) => {
  const req = e.data;
  if (req.type !== 'process') return;
  let res: WorkerResponse;
  try {
    const decoded = await getDecoded(req.sourceKey, req.source);
    const out = await runPipeline(decoded, req.settings);
    res = { type: 'done', jobId: req.jobId, ...out };
  } catch (err) {
    res = { type: 'error', jobId: req.jobId, message: err instanceof Error ? err.message : String(err) };
  }
  self.postMessage(res);
};
