import { h, icon, type IconName } from './dom';

export type ModuleId = 'convert' | 'colors' | 'grab' | 'media';

const MODULES: { id: ModuleId; label: string; icon: IconName }[] = [
  { id: 'convert', label: 'Convertir', icon: 'convert' },
  { id: 'colors', label: 'Couleurs', icon: 'pipette' },
  { id: 'grab', label: 'Scrap', icon: 'grab' },
  { id: 'media', label: 'Lien', icon: 'link' },
];

const KEY = 'kotak.module';
const listeners = new Set<(m: ModuleId) => void>();
let current: ModuleId = 'convert';

export function currentModule(): ModuleId {
  return current;
}

export function onModuleChange(fn: (m: ModuleId) => void) {
  listeners.add(fn);
}

export function showModule(id: ModuleId) {
  current = id;
  document.querySelectorAll<HTMLElement>('.module').forEach((el) => (el.hidden = el.dataset.module !== id));
  document.querySelectorAll<HTMLButtonElement>('.tab').forEach((b) => {
    const on = b.dataset.module === id;
    b.classList.toggle('is-on', on);
    b.setAttribute('aria-selected', String(on));
  });
  document.body.dataset.module = id;
  try {
    localStorage.setItem(KEY, id);
  } catch {
    /* stockage indisponible : sans conséquence */
  }
  listeners.forEach((fn) => fn(id));
  window.scrollTo(0, 0);
}

export function mountNav(root: HTMLElement) {
  root.append(
    ...MODULES.map((m) =>
      h('button', { type: 'button', class: 'tab', role: 'tab', 'data-module': m.id, onclick: () => showModule(m.id) }, icon(m.icon, 15), h('span', {}, m.label)),
    ),
  );
  let saved: string | null = null;
  try {
    saved = localStorage.getItem(KEY);
  } catch {
    /* idem */
  }
  showModule(MODULES.some((m) => m.id === saved) ? (saved as ModuleId) : 'convert');
}
