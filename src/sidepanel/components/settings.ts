import { h, icon } from '../dom';
import { store } from '../store';
import { FORMATS, FORMAT_ORDER, clamp, qualityOf, type OutFormat, type ResizeMode, type Settings } from '../../core/types';
import { outputName } from '../../lib/files';

type Option<T> = { value: T; label: string; title?: string };

/** Contrôle segmenté générique. */
function segmented<T extends string | number>(name: string, options: Option<T>[], onPick: (v: T) => void) {
  const buttons = options.map((o) =>
    h('button', { type: 'button', class: 'seg__btn', title: o.title, 'data-value': String(o.value), onclick: () => onPick(o.value) }, o.label),
  );
  const el = h('div', { class: 'seg', role: 'radiogroup', 'aria-label': name }, buttons);
  return {
    el,
    set(v: T) {
      buttons.forEach((b, i) => {
        const on = options[i].value === v;
        b.classList.toggle('is-on', on);
        b.setAttribute('aria-checked', String(on));
      });
    },
  };
}

function field(label: string, control: Node, extra?: Node): HTMLDivElement {
  return h('div', { class: 'field' }, h('div', { class: 'field__label' }, h('span', {}, label), extra ?? null), control);
}

function chips<T extends number>(values: T[], fmt: (v: T) => string, onPick: (v: T) => void) {
  return h(
    'div',
    { class: 'chips' },
    values.map((v) => h('button', { type: 'button', class: 'chip', onclick: () => onPick(v) }, fmt(v))),
  );
}

function check(label: string, onChange: (v: boolean) => void) {
  const input = h('input', { type: 'checkbox' });
  input.addEventListener('change', () => onChange(input.checked));
  const el = h('label', { class: 'check' }, input, h('span', { class: 'check__box' }, icon('check', 12)), h('span', {}, label));
  return { el, input };
}

const PNG_COLORS: Option<number>[] = [
  { value: 0, label: 'Toutes (sans perte)' },
  { value: 256, label: '256 couleurs' },
  { value: 128, label: '128 couleurs' },
  { value: 64, label: '64 couleurs' },
  { value: 32, label: '32 couleurs' },
  { value: 16, label: '16 couleurs' },
  { value: 8, label: '8 couleurs' },
];

export function mountSettings(root: HTMLElement) {
  const update = (fn: (s: Settings) => void, debounce = false) => store.updateSettings(fn, debounce);

  // ----- Portée -----
  const scope = segmented<'all' | 'item'>('Portée', [
    { value: 'all', label: 'Toutes les images' },
    { value: 'item', label: 'Cette image' },
  ], (v) => store.setScope(v));
  const resetBtn = h('button', { type: 'button', class: 'link-btn', title: 'Revenir aux réglages communs', onclick: () => store.resetOverride() }, icon('reset', 13), 'Réinitialiser');
  const scopeRow = h('div', { class: 'scope' }, scope.el, resetBtn);

  // ----- Format -----
  const format = segmented<OutFormat>(
    'Format de sortie',
    FORMAT_ORDER.map((f) => ({ value: f, label: FORMATS[f].label })),
    (v) => update((s) => {
      s.format = v;
    }),
  );

  // ----- Compression -----
  const mode = segmented<'quality' | 'target'>('Mode', [
    { value: 'quality', label: 'Compression %' },
    { value: 'target', label: 'Poids cible' },
  ], (v) => update((s) => {
    s.mode = v;
  }));

  const slider = h('input', { type: 'range', min: 0, max: 99, step: 1, class: 'range', 'aria-label': 'Compression' });
  slider.addEventListener('input', () => update((s) => {
    s.compression = Number(slider.value);
  }, true));
  const sliderValue = h('span', { class: 'range__value' });
  const sliderHint = h('span', { class: 'field__hint' });
  const qualityBlock = field('Compression', h('div', { class: 'range-wrap' }, slider, sliderValue), sliderHint);

  const targetInput = h('input', { type: 'number', min: 1, step: 1, class: 'input input--num', 'aria-label': 'Poids cible en Ko' });
  targetInput.addEventListener('input', () => {
    const v = Number(targetInput.value);
    if (v > 0) update((s) => {
      s.targetKB = Math.round(v);
    }, true);
  });
  const targetBlock = field(
    'Poids maximum',
    h('div', { class: 'stack' },
      h('div', { class: 'input-unit' }, targetInput, h('span', {}, 'Ko')),
      chips([50, 100, 150, 200, 300, 500, 1000], (v) => (v >= 1000 ? `${v / 1000} Mo` : `${v} Ko`), (v) => update((s) => {
        s.targetKB = v;
      })),
    ),
    h('span', { class: 'field__hint' }, 'meilleure qualité possible sous ce poids'),
  );

  const lossless = check('Sans perte', (v) => update((s) => {
    s.lossless = v;
  }));

  // ----- Couleurs (PNG / GIF) -----
  const colorsSelect = h('select', { class: 'input select', 'aria-label': 'Nombre de couleurs' });
  colorsSelect.addEventListener('change', () => update((s) => {
    s.colors = Number(colorsSelect.value);
  }));
  const dither = check('Tramage (dégradés plus doux)', (v) => update((s) => {
    s.dithering = v;
  }));
  const colorsBlock = field('Couleurs', h('div', { class: 'stack' }, colorsSelect, dither.el));

  // ----- Redimensionnement -----
  const resizeMode = h('select', { class: 'input select', 'aria-label': 'Redimensionnement' },
    ([
      ['none', "Taille d'origine"],
      ['width', 'Largeur'],
      ['height', 'Hauteur'],
      ['longest', 'Plus grand côté'],
      ['percent', 'Pourcentage'],
    ] as [ResizeMode, string][]).map(([v, l]) => h('option', { value: v }, l)),
  );
  resizeMode.addEventListener('change', () => update((s) => {
    const m = resizeMode.value as ResizeMode;
    if (m === 'percent' && s.resize.mode !== 'percent') s.resize.value = 50;
    if (m !== 'percent' && m !== 'none' && (s.resize.mode === 'percent' || s.resize.mode === 'none')) s.resize.value = 1920;
    s.resize.mode = m;
  }));
  const resizeValue = h('input', { type: 'number', min: 1, step: 1, class: 'input input--num', 'aria-label': 'Valeur' });
  resizeValue.addEventListener('input', () => {
    const v = Number(resizeValue.value);
    if (v > 0) update((s) => {
      s.resize.value = Math.round(v);
    }, true);
  });
  const resizeUnit = h('span', {});
  const noUpscale = check('Ne jamais agrandir', (v) => update((s) => {
    s.resize.noUpscale = v;
  }));
  const pxChips = chips([1080, 1200, 1920, 2560, 3840], (v) => `${v}`, (v) => update((s) => {
    s.resize.value = v;
  }));
  const pctChips = chips([25, 50, 75, 200], (v) => `${v} %`, (v) => update((s) => {
    s.resize.value = v;
  }));
  const resizeDetail = h('div', { class: 'stack' }, h('div', { class: 'input-unit' }, resizeValue, resizeUnit), pxChips, pctChips, noUpscale.el);
  const resizeBlock = field('Dimensions', h('div', { class: 'stack' }, resizeMode, resizeDetail));

  // ----- Fond -----
  const bgInput = h('input', { type: 'color', class: 'color', 'aria-label': 'Couleur de fond' });
  bgInput.addEventListener('input', () => update((s) => {
    s.background = bgInput.value;
  }, true));
  const bgHex = h('span', { class: 'mono muted' });
  const bgBlock = field('Fond des zones transparentes', h('div', { class: 'row' }, bgInput, bgHex));

  // ----- SVG -----
  const svgScale = segmented<number>('Échelle SVG', [1, 2, 4, 8].map((v) => ({ value: v, label: `${v}×` })), (v) => update((s) => {
    s.svgScale = v;
  }));
  const svgBlock = field('Rendu des SVG', svgScale.el, h('span', { class: 'field__hint' }, 'résolution de rastérisation'));

  // ----- Nom de fichier -----
  const nameInput = h('input', { type: 'text', class: 'input mono', spellcheck: false, 'aria-label': 'Modèle de nom' });
  nameInput.addEventListener('input', () => update((s) => {
    s.filenamePattern = nameInput.value;
  }));
  const tokens = h('div', { class: 'chips' },
    ['{nom}', '{w}', '{h}', '{qualite}', '{format}', '{index}'].map((t) =>
      h('button', {
        type: 'button',
        class: 'chip mono',
        onclick: () => {
          const pos = nameInput.selectionStart ?? nameInput.value.length;
          nameInput.setRangeText(t, pos, nameInput.selectionEnd ?? pos, 'end');
          nameInput.dispatchEvent(new Event('input'));
          nameInput.focus();
        },
      }, t),
    ),
  );
  const namePreview = h('div', { class: 'field__hint mono' });
  const nameBlock = field('Nom des fichiers', h('div', { class: 'stack' }, nameInput, tokens, namePreview));

  const advanced = h('details', { class: 'advanced' },
    h('summary', {}, 'Nom des fichiers & options avancées'),
    nameBlock,
    h('p', { class: 'note' }, icon('check', 12), ' Métadonnées (EXIF, GPS…) toujours supprimées. Tout est traité sur ton ordinateur, rien n\'est envoyé en ligne.'),
  );

  const scopeHost = h('div', {});
  root.append(scopeHost, field('Format', format.el), lossless.el, mode.el, qualityBlock, targetBlock, colorsBlock, resizeBlock, bgBlock, svgBlock, advanced);
  scopeHost.append(scopeRow);

  // ----- Synchronisation UI <- état -----
  function sync() {
    const s = store.editing;
    const f = FORMATS[s.format];
    const sel = store.selected;

    scopeRow.hidden = !sel || store.items.length < 2;
    scope.set(store.scope);
    resetBtn.hidden = !(store.scope === 'item' && sel?.override);
    root.classList.toggle('is-item-scope', store.scope === 'item');

    format.set(s.format);

    const isLossless = f.supportsLossless && s.lossless;
    lossless.el.hidden = !f.supportsLossless;
    lossless.input.checked = s.lossless;

    mode.el.hidden = !f.lossy || isLossless;
    mode.set(s.mode);
    const showQuality = f.lossy && !isLossless && s.mode === 'quality';
    const showTarget = f.lossy && !isLossless && s.mode === 'target';
    qualityBlock.hidden = !showQuality;
    targetBlock.hidden = !showTarget;
    if (document.activeElement !== slider) slider.value = String(s.compression);
    slider.style.setProperty('--fill', `${(s.compression / 99) * 100}%`);
    sliderValue.textContent = `${s.compression} %`;
    sliderHint.textContent = `qualité ${qualityOf(s)}`;
    if (document.activeElement !== targetInput) targetInput.value = String(s.targetKB);

    colorsBlock.hidden = !f.supportsColors;
    const colorOpts = s.format === 'gif' ? PNG_COLORS.slice(1) : PNG_COLORS;
    colorsSelect.replaceChildren(...colorOpts.map((o) => h('option', { value: o.value }, o.label)));
    colorsSelect.value = String(s.format === 'gif' && !s.colors ? 256 : s.colors);
    dither.input.checked = s.dithering;
    dither.el.hidden = s.format === 'png' && !s.colors;

    resizeMode.value = s.resize.mode;
    resizeDetail.hidden = s.resize.mode === 'none';
    if (document.activeElement !== resizeValue) resizeValue.value = String(s.resize.value);
    resizeUnit.textContent = s.resize.mode === 'percent' ? '%' : 'px';
    pxChips.hidden = s.resize.mode === 'percent';
    pctChips.hidden = s.resize.mode !== 'percent';
    noUpscale.input.checked = s.resize.noUpscale;

    bgBlock.hidden = f.alpha;
    bgInput.value = s.background;
    bgHex.textContent = s.background.toUpperCase();

    svgBlock.hidden = !store.items.some((i) => i.isSvg);
    svgScale.set(s.svgScale);

    if (document.activeElement !== nameInput) nameInput.value = s.filenamePattern;
    const sample = sel ?? null;
    namePreview.textContent = `→ ${outputName({
      originalName: sample?.name ?? 'visuel-campagne.png',
      width: sample?.result?.width ?? 1920,
      height: sample?.result?.height ?? 1080,
      index: sample ? store.items.indexOf(sample) + 1 : 1,
      quality: sample?.result?.quality ?? null,
      settings: { ...s, compression: clamp(s.compression, 0, 99) },
    })}`;
  }

  store.on('settings', sync);
  store.on('selection', sync);
  store.on('items', sync);
  sync();
}
