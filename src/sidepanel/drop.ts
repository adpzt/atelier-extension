// Aiguillage des fichiers glissés / collés vers le module affiché.
import { currentModule, type ModuleId } from './nav';

type Handler = (files: { blob: Blob; name: string }[]) => void;
const handlers = new Map<ModuleId, Handler>();

export function registerDropHandler(module: ModuleId, fn: Handler) {
  handlers.set(module, fn);
}

/** Gestionnaire du module courant, s'il en a un dédié (sinon : convertisseur). */
export function activeDropHandler(): Handler | null {
  return handlers.get(currentModule()) ?? null;
}
