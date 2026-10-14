import type { ProcessRequest, ProcessResult, Settings, WorkerResponse } from './types';

export interface PoolTask {
  sourceKey: string;
  source: Blob;
  settings: Settings;
}

interface Slot {
  worker: Worker;
  busy: boolean;
  /** Dernière clé de source traitée : on y renvoie la même source pour profiter du cache. */
  lastKey: string | null;
}

type Pending = { resolve: (r: ProcessResult) => void; reject: (e: Error) => void; slot: Slot };

/**
 * Pool de workers d'encodage. Le pool ne gère pas de file : l'appelant demande
 * un slot libre (`hasFreeSlot`) et décide lui-même quoi lancer en priorité.
 */
export class WorkerPool {
  private slots: Slot[] = [];
  private pending = new Map<number, Pending>();
  private nextJobId = 1;

  constructor(size = defaultPoolSize()) {
    if (size < 1) size = 1;
    for (let i = 0; i < size; i++) {
      const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
      const slot: Slot = { worker, busy: false, lastKey: null };
      worker.onmessage = (e: MessageEvent<WorkerResponse>) => this.onMessage(e.data);
      worker.onerror = (e) => {
        // Erreur fatale (ex. module WASM introuvable) : on rejette les tâches de ce worker.
        for (const [id, p] of this.pending) {
          if (p.slot === slot) {
            this.pending.delete(id);
            slot.busy = false;
            p.reject(new Error(e.message || 'Erreur du worker'));
          }
        }
      };
      this.slots.push(slot);
    }
  }

  get size(): number {
    return this.slots.length;
  }

  hasFreeSlot(): boolean {
    return this.slots.some((s) => !s.busy);
  }

  run(task: PoolTask): Promise<ProcessResult> {
    const free = this.slots.filter((s) => !s.busy);
    if (!free.length) return Promise.reject(new Error('Aucun worker libre'));
    const slot = free.find((s) => s.lastKey === task.sourceKey) ?? free[0];
    slot.busy = true;
    slot.lastKey = task.sourceKey;
    const jobId = this.nextJobId++;
    const req: ProcessRequest = { type: 'process', jobId, ...task };
    return new Promise((resolve, reject) => {
      this.pending.set(jobId, { resolve, reject, slot });
      slot.worker.postMessage(req);
    });
  }

  private onMessage(res: WorkerResponse) {
    const p = this.pending.get(res.jobId);
    if (!p) return;
    this.pending.delete(res.jobId);
    p.slot.busy = false;
    if (res.type === 'done') p.resolve(res);
    else p.reject(new Error(res.message));
  }
}

function defaultPoolSize(): number {
  const cores = navigator.hardwareConcurrency || 4;
  return Math.max(1, Math.min(4, cores - 1));
}
