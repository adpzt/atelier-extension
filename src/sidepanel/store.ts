import { WorkerPool } from '../core/pool';
import { probe, rasterizeSvg } from '../core/source';
import { cloneSettings, type Settings } from '../core/types';
import { saveSettings } from '../lib/storage';

export interface ItemResult {
  blob: Blob;
  url: string;
  width: number;
  height: number;
  quality: number | null;
  targetMet: boolean | null;
  version: number;
}

export interface Item {
  id: string;
  index: number;
  name: string;
  file: Blob;
  origSize: number;
  origW: number;
  origH: number;
  isSvg: boolean;
  /** URL de l'original, pour la vignette et le comparateur. */
  thumbUrl: string;
  /** Réglages propres à cette image (sinon : réglages globaux). */
  override: Settings | null;
  /** Incrémenté à chaque changement de réglages qui concerne l'image. */
  version: number;
  inflightVersion: number | null;
  result: ItemResult | null;
  error: string | null;
  svgRaster: { scale: number; blob: Blob } | null;
}

/** settings : l'affichage des réglages doit changer. edit : l'utilisateur a modifié un réglage. */
type Topic = 'items' | 'item' | 'selection' | 'settings' | 'edit';
type Listener = (payload?: unknown) => void;

let idCounter = 0;
let indexCounter = 0;

class Store {
  items: Item[] = [];
  selectedId: string | null = null;
  global!: Settings;
  /** Portée de l'édition des réglages : toutes les images ou l'image sélectionnée. */
  scope: 'all' | 'item' = 'all';

  private listeners = new Map<Topic, Set<Listener>>();
  private pool: WorkerPool | null = null;
  private invalidateTimer: number | undefined;
  private saveTimer: number | undefined;

  init(settings: Settings) {
    this.global = settings;
  }

  on(topic: Topic, fn: Listener) {
    if (!this.listeners.has(topic)) this.listeners.set(topic, new Set());
    this.listeners.get(topic)!.add(fn);
  }

  emit(topic: Topic, payload?: unknown) {
    this.listeners.get(topic)?.forEach((fn) => fn(payload));
  }

  get selected(): Item | null {
    return this.items.find((i) => i.id === this.selectedId) ?? null;
  }

  settingsFor(item: Item): Settings {
    return item.override ?? this.global;
  }

  /** Réglages actuellement affichés / modifiés dans le panneau. */
  get editing(): Settings {
    const sel = this.selected;
    if (this.scope === 'item' && sel?.override) return sel.override;
    return this.global;
  }

  // ---------- Ajout / suppression ----------

  async addFiles(files: { blob: Blob; name: string }[]): Promise<string[]> {
    const errors: string[] = [];
    const added: Item[] = [];
    for (const { blob, name } of files) {
      try {
        const info = await probe(blob, name);
        const item: Item = {
          id: `i${++idCounter}`,
          index: ++indexCounter,
          name,
          file: blob,
          origSize: blob.size,
          origW: info.width,
          origH: info.height,
          isSvg: info.isSvg,
          thumbUrl: URL.createObjectURL(blob.type || !info.isSvg ? blob : new Blob([blob], { type: 'image/svg+xml' })),
          override: null,
          version: 1,
          inflightVersion: null,
          result: null,
          error: null,
          svgRaster: null,
        };
        added.push(item);
      } catch (e) {
        errors.push(`${name} : ${e instanceof Error ? e.message : 'illisible'}`);
      }
    }
    if (added.length) {
      this.items.push(...added);
      if (!this.selectedId) this.selectedId = added[0].id;
      this.emit('items');
      this.emit('selection');
      this.pump();
    }
    return errors;
  }

  remove(id: string) {
    const idx = this.items.findIndex((i) => i.id === id);
    if (idx < 0) return;
    const [item] = this.items.splice(idx, 1);
    URL.revokeObjectURL(item.thumbUrl);
    if (item.result) URL.revokeObjectURL(item.result.url);
    if (this.selectedId === id) {
      this.selectedId = this.items[Math.min(idx, this.items.length - 1)]?.id ?? null;
      if (!this.selected?.override) this.scope = 'all';
      this.emit('selection');
    }
    this.emit('items');
  }

  clear() {
    for (const item of this.items) {
      URL.revokeObjectURL(item.thumbUrl);
      if (item.result) URL.revokeObjectURL(item.result.url);
    }
    this.items = [];
    this.selectedId = null;
    this.scope = 'all';
    this.emit('items');
    this.emit('selection');
    this.emit('settings');
  }

  select(id: string) {
    if (this.selectedId === id) return;
    this.selectedId = id;
    if (this.scope === 'item' && !this.selected?.override) this.scope = 'all';
    if (this.selected?.override) this.scope = 'item';
    this.emit('selection');
    this.emit('settings');
    this.pump();
  }

  // ---------- Réglages ----------

  /**
   * Applique une modification aux réglages en cours d'édition.
   * `debounce` : pour les curseurs, on attend que l'utilisateur se pose.
   */
  updateSettings(patch: (s: Settings) => void, debounce = false) {
    const target = this.editing;
    patch(target);
    this.emit('settings');
    this.emit('edit');
    if (target === this.global) this.persist();
    const affected = target === this.global ? this.items.filter((i) => !i.override) : this.selected ? [this.selected] : [];
    clearTimeout(this.invalidateTimer);
    if (debounce) {
      this.invalidateTimer = window.setTimeout(() => this.invalidate(affected), 220);
    } else {
      this.invalidate(affected);
    }
  }

  replaceSettings(next: Settings) {
    this.updateSettings((s) => {
      Object.assign(s, cloneSettings(next));
    });
  }

  setScope(scope: 'all' | 'item') {
    const sel = this.selected;
    if (!sel) return;
    this.scope = scope;
    if (scope === 'item' && !sel.override) {
      sel.override = cloneSettings(this.global);
      // Mêmes réglages qu'avant : inutile de ré-encoder.
    }
    this.emit('settings');
    this.emit('item', sel.id);
  }

  resetOverride() {
    const sel = this.selected;
    if (!sel?.override) return;
    sel.override = null;
    this.scope = 'all';
    this.emit('settings');
    this.invalidate([sel]);
  }

  private persist() {
    clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => saveSettings(this.global), 400);
  }

  // ---------- Traitement ----------

  private invalidate(items: Item[]) {
    for (const item of items) {
      item.version++;
      item.error = null;
      this.emit('item', item.id);
    }
    this.pump();
  }

  isBusy(item: Item): boolean {
    return !item.error && item.result?.version !== item.version;
  }

  get busyCount(): number {
    return this.items.filter((i) => this.isBusy(i)).length;
  }

  private nextToProcess(): Item | null {
    const needs = (i: Item) => !i.error && i.result?.version !== i.version && i.inflightVersion !== i.version;
    const sel = this.selected;
    if (sel && needs(sel)) return sel;
    return this.items.find(needs) ?? null;
  }

  private getPool(): WorkerPool {
    if (!this.pool) this.pool = new WorkerPool();
    return this.pool;
  }

  private pump() {
    const pool = this.getPool();
    while (pool.hasFreeSlot()) {
      const item = this.nextToProcess();
      if (!item) break;
      this.process(pool, item);
    }
  }

  private async process(pool: WorkerPool, item: Item) {
    const version = item.version;
    const settings = cloneSettings(this.settingsFor(item));
    item.inflightVersion = version;
    this.emit('item', item.id);

    // Pour un SVG, la rastérisation est asynchrone : le slot n'est réservé qu'ensuite.
    let source: Blob = item.file;
    let sourceKey = item.id;
    try {
      if (item.isSvg) {
        if (item.svgRaster?.scale !== settings.svgScale) {
          item.svgRaster = { scale: settings.svgScale, blob: await rasterizeSvg(item.file, settings.svgScale) };
        }
        source = item.svgRaster.blob;
        sourceKey = `${item.id}@${settings.svgScale}`;
      }
      if (!pool.hasFreeSlot()) {
        // Un autre traitement a pris le slot pendant la rastérisation : on repassera.
        item.inflightVersion = null;
        return;
      }
      const res = await pool.run({ sourceKey, source, settings });
      if (!this.items.includes(item)) return;
      if (item.version === version) {
        if (item.result) URL.revokeObjectURL(item.result.url);
        item.result = {
          blob: res.blob,
          url: URL.createObjectURL(res.blob),
          width: res.width,
          height: res.height,
          quality: res.quality,
          targetMet: res.targetMet,
          version,
        };
      }
    } catch (e) {
      if (item.version === version) item.error = e instanceof Error ? e.message : String(e);
    } finally {
      if (item.inflightVersion === version) item.inflightVersion = null;
      this.emit('item', item.id);
      this.pump();
    }
  }
}

export const store = new Store();
