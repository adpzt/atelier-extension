// Module Couleurs : pipette (partout sur l'écran), valeurs HEX / RGB / CMJN / HSL,
// copie automatique, historique et export de nuancier.
import { h, icon } from '../dom';
import { toast } from '../components/toast';
import { buildAse, cmykOf, hexOf, hslOf, isLight, parseHex, type RGB } from '../../lib/color';
import { copyText } from '../../lib/clipboard';
import { downloadBlob, timestamp } from '../../lib/files';
import { currentModule } from '../nav';

interface Picked {
  hex: string;
  ts: number;
}

const KEY = 'atelier.colors.history';
const MAX = 64;

interface EyeDropperCtor {
  new (): { open(opts?: { signal?: AbortSignal }): Promise<{ sRGBHex: string }> };
}

async function loadHistory(): Promise<Picked[]> {
  try {
    const r = await chrome.storage.local.get(KEY);
    return (r[KEY] as Picked[] | undefined) ?? [];
  } catch {
    return [];
  }
}

function saveHistory(list: Picked[]) {
  chrome.storage.local.set({ [KEY]: list }).catch(() => undefined);
}

export async function mountColors(root: HTMLElement) {
  let history = await loadHistory();
  let current: RGB | null = history[0] ? parseHex(history[0].hex) : null;
  const EyeDropper = (window as unknown as { EyeDropper?: EyeDropperCtor }).EyeDropper;

  // ---------- Pipette ----------
  const pickBtn = h(
    'button',
    { type: 'button', class: 'pick-btn' },
    h('span', { class: 'pick-btn__icon' }, icon('pipette', 22)),
    h('span', { class: 'pick-btn__text' }, h('strong', {}, 'Prélever une couleur'), h('span', {}, "Partout sur l'écran, même hors de Chrome")),
    h('kbd', { class: 'pick-btn__kbd' }, 'P'),
  );
  pickBtn.disabled = !EyeDropper;

  async function pick() {
    if (!EyeDropper) return;
    try {
      const { sRGBHex } = await new EyeDropper().open();
      const rgb = parseHex(sRGBHex);
      if (!rgb) return;
      setCurrent(rgb, true);
    } catch {
      // Échap : prélèvement annulé.
    }
  }
  pickBtn.addEventListener('click', pick);
  document.addEventListener('keydown', (e) => {
    if (currentModule() !== 'colors' || e.metaKey || e.ctrlKey || e.altKey) return;
    const t = e.target as HTMLElement;
    if (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA') return;
    if (e.key === 'p' || e.key === 'P') {
      e.preventDefault();
      pick();
    }
  });

  // ---------- Couleur courante ----------
  const swatch = h('div', { class: 'swatch' });
  const swatchHex = h('span', { class: 'swatch__hex' });
  swatch.append(swatchHex);
  const hexInput = h('input', { type: 'text', class: 'input mono hex-input', maxlength: 7, spellcheck: false, 'aria-label': 'Code HEX' });
  hexInput.addEventListener('change', () => {
    const rgb = parseHex(hexInput.value);
    if (rgb) setCurrent(rgb, true);
    else if (current) hexInput.value = hexOf(current);
  });

  const valueRows = new Map<string, HTMLElement>();
  const row = (key: string, label: string) => {
    const value = h('span', { class: 'cval__value mono' });
    valueRows.set(key, value);
    const btn = h('button', { type: 'button', class: 'cval', title: `Copier ${label}` }, h('span', { class: 'cval__label' }, label), value, icon('copy', 14));
    btn.addEventListener('click', async () => {
      const text = value.dataset.copy ?? value.textContent ?? '';
      if (await copyText(text)) flash(btn, `${label} copié`);
    });
    return btn;
  };
  const values = h('div', { class: 'cvals' }, row('hex', 'HEX'), row('hexcss', 'HEX #'), row('rgb', 'RGB'), row('cmyk', 'CMJN'), row('hsl', 'HSL'));
  const card = h(
    'section',
    { class: 'card color-card' },
    h('div', { class: 'color-card__top' }, swatch, h('div', { class: 'stack color-card__edit' }, h('span', { class: 'field__label' }, 'Code HEX'), hexInput, h('span', { class: 'field__hint' }, 'Copié automatiquement sans #, prêt pour Photoshop'))),
    values,
    h('p', { class: 'note' }, icon('alert', 12), ' CMJN approximatif : Photoshop applique le profil d\'impression du document.'),
  );

  // ---------- Historique ----------
  const grid = h('div', { class: 'history' });
  const empty = h('p', { class: 'muted history__empty' }, 'Les couleurs prélevées apparaîtront ici.');
  const aseBtn = h('button', { type: 'button', class: 'btn btn--ghost btn--sm', title: 'Nuancier pour Photoshop / Illustrator' }, icon('download', 14), 'Nuancier .ase');
  const copyAllBtn = h('button', { type: 'button', class: 'btn btn--ghost btn--sm' }, icon('copy', 14), 'Copier tout');
  const clearBtn = h('button', { type: 'button', class: 'icon-btn icon-btn--sm', title: "Vider l'historique" }, icon('trash', 14));
  const historyCard = h(
    'section',
    { class: 'card' },
    h('div', { class: 'section__head' }, h('h2', { class: 'section__title' }, 'Historique'), h('span', { class: 'section__count' })),
    grid,
    empty,
    h('div', { class: 'history__actions' }, aseBtn, copyAllBtn, h('span', { class: 'spacer' }), clearBtn),
  );

  aseBtn.addEventListener('click', () => {
    const colors = history.map((p) => ({ name: p.hex, rgb: parseHex(p.hex)! }));
    downloadBlob(buildAse(colors), `atelier-couleurs-${timestamp()}.ase`);
  });
  copyAllBtn.addEventListener('click', async () => {
    if (await copyText(history.map((p) => p.hex).join('\n'))) toast(`${history.length} codes copiés`, 'success', 2000);
  });
  clearBtn.addEventListener('click', () => {
    history = [];
    saveHistory(history);
    renderHistory();
  });

  root.append(pickBtn);
  if (!EyeDropper) root.append(h('p', { class: 'preview__warn' }, 'Pipette indisponible dans cette version de Chrome.'));
  root.append(card, historyCard);

  // ---------- Logique ----------
  function flash(el: HTMLElement, msg: string) {
    el.classList.add('is-copied');
    setTimeout(() => el.classList.remove('is-copied'), 900);
    toast(msg, 'success', 1600);
  }

  async function setCurrent(rgb: RGB, record: boolean) {
    current = rgb;
    const hex = hexOf(rgb);
    if (record) {
      history = [{ hex, ts: Date.now() }, ...history.filter((p) => p.hex !== hex)].slice(0, MAX);
      saveHistory(history);
      const ok = await copyText(hex);
      toast(ok ? `${hex} copié` : `${hex} — copie impossible, clique sur HEX`, ok ? 'success' : 'error', 2000);
    }
    renderCurrent();
    renderHistory();
  }

  function renderCurrent() {
    card.hidden = !current;
    if (!current) return;
    const hex = hexOf(current);
    swatch.style.background = `#${hex}`;
    swatch.classList.toggle('is-light', isLight(current));
    swatchHex.textContent = `#${hex}`;
    if (document.activeElement !== hexInput) hexInput.value = hex;
    const [c, m, y, k] = cmykOf(current);
    const [hh, s, l] = hslOf(current);
    const set = (key: string, text: string, copy?: string) => {
      const el = valueRows.get(key)!;
      el.textContent = text;
      el.dataset.copy = copy ?? text;
    };
    set('hex', hex);
    set('hexcss', `#${hex}`);
    set('rgb', `${current.r}, ${current.g}, ${current.b}`);
    set('cmyk', `${c} · ${m} · ${y} · ${k}`, `C${c} M${m} J${y} N${k}`);
    set('hsl', `${hh}° · ${s} % · ${l} %`, `hsl(${hh}, ${s}%, ${l}%)`);
  }

  function renderHistory() {
    grid.replaceChildren(
      ...history.map((p) => {
        const rgb = parseHex(p.hex)!;
        const del = h('button', { type: 'button', class: 'chip-del', title: 'Retirer' }, icon('x', 10));
        const el = h('button', { type: 'button', class: `hswatch${isLight(rgb) ? ' is-light' : ''}`, title: `${p.hex} — clic : copier` }, h('span', {}, p.hex), del);
        el.style.background = `#${p.hex}`;
        el.classList.toggle('is-current', !!current && hexOf(current) === p.hex);
        el.addEventListener('click', async (e) => {
          if ((e.target as HTMLElement).closest('.chip-del')) {
            history = history.filter((x) => x.hex !== p.hex);
            saveHistory(history);
            renderHistory();
            return;
          }
          current = rgb;
          renderCurrent();
          renderHistory();
          if (await copyText(p.hex)) toast(`${p.hex} copié`, 'success', 1600);
        });
        return el;
      }),
    );
    empty.hidden = history.length > 0;
    grid.hidden = history.length === 0;
    (historyCard.querySelector('.section__count') as HTMLElement).textContent = String(history.length);
    aseBtn.disabled = copyAllBtn.disabled = history.length === 0;
  }

  renderCurrent();
  renderHistory();
}
