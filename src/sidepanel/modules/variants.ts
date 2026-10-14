// Module Déclinaisons : un visuel -> tous les formats réseaux sociaux et display,
// recadrage par point focal (ajustable par format), zones de sécurité, export ZIP.
import { h, icon } from '../dom';
import { toast } from '../components/toast';
import { registerDropHandler } from '../drop';
import { currentModule, onModuleChange } from '../nav';
import { normalize } from '../../core/normalize';
import { probe, rasterizeSvg } from '../../core/source';
import { WorkerPool } from '../../core/pool';
import { DEFAULT_SETTINGS, FORMATS, cloneSettings, type OutFormat, type Settings } from '../../core/types';
import { DEFAULT_VARIANTS, VARIANT_PRESETS, coverCrop, type Focal, type SafeZone, type VariantPreset } from '../../core/variants';
import { baseName, buildZip, downloadBlob, formatBytes, timestamp } from '../../lib/files';

interface Source {
  id: string;
  name: string;
  blob: Blob;
  bitmap: ImageBitmap;
  url: string;
  w: number;
  h: number;
  focal: Focal;
  /** Ajustements de cadrage propres à un format. */
  overrides: Map<string, Focal>;
}

type Fit = 'cover' | 'blur' | 'color';

interface Options {
  selected: string[];
  customs: VariantPreset[];
  fit: Fit;
  color: string;
  format: Extract<OutFormat, 'jpeg' | 'png' | 'webp'>;
  socialQuality: number;
  displayKB: number;
  safe: boolean;
  platform: string;
}

const KEY = 'kotak.variants';
const DEFAULT_OPTIONS: Options = {
  selected: DEFAULT_VARIANTS,
  customs: [],
  fit: 'cover',
  color: '#ffffff',
  format: 'jpeg',
  socialQuality: 88,
  displayKB: 150,
  safe: true,
  platform: 'all',
};

async function loadOptions(): Promise<Options> {
  try {
    const r = await chrome.storage.local.get(KEY);
    return { ...DEFAULT_OPTIONS, ...((r[KEY] as Partial<Options>) ?? {}) };
  } catch {
    return { ...DEFAULT_OPTIONS };
  }
}

/** Union (le plus prudent) ou zone d'une plateforme. */
function safeFor(v: VariantPreset, platform: string): SafeZone | null {
  if (!v.safe) return null;
  if (platform !== 'all') return v.safe[platform] ?? null;
  const zones = Object.values(v.safe);
  return {
    top: Math.max(...zones.map((z) => z.top)),
    bottom: Math.max(...zones.map((z) => z.bottom)),
    left: Math.max(...zones.map((z) => z.left)),
    right: Math.max(...zones.map((z) => z.right)),
  };
}

let idCounter = 0;

export async function mountVariants(root: HTMLElement, footer: HTMLElement) {
  const opts = await loadOptions();
  const save = () => chrome.storage.local.set({ [KEY]: opts }).catch(() => undefined);
  const sources: Source[] = [];
  let current: Source | null = null;
  let pool: WorkerPool | null = null;
  let exporting = false;

  const allVariants = () => [...VARIANT_PRESETS, ...opts.customs];
  const selectedVariants = () => allVariants().filter((v) => opts.selected.includes(v.id));

  // ================= Sources =================
  const input = h('input', { type: 'file', multiple: true, accept: 'image/*,application/pdf,.psd,.heic,.tif,.tiff,.svg', hidden: true });
  input.addEventListener('change', () => {
    addSources(Array.from(input.files ?? []).map((f) => ({ blob: f, name: f.name })));
    input.value = '';
  });
  const hero = h(
    'button',
    { type: 'button', class: 'drop-hero', onclick: () => input.click() },
    h('span', { class: 'drop-hero__icon' }, icon('layers', 26)),
    h('span', { class: 'drop-hero__title' }, 'Dépose ton visuel'),
    h('span', { class: 'drop-hero__sub' }, 'Il sera décliné dans tous les formats réseaux sociaux et display'),
    h('span', { class: 'drop-hero__formats' }, 'Glisser · ⌘V · parcourir — tous formats (PSD, HEIC, PDF…)'),
  );
  const strip = h('div', { class: 'src-strip' });
  const addBtn = h('button', { type: 'button', class: 'src-add', title: 'Ajouter un visuel', onclick: () => input.click() }, icon('plus', 18));
  const sourcesBar = h('div', { class: 'src-bar' }, strip, addBtn);

  // ================= Point focal =================
  const focalImg = h('img', { class: 'focal__img', alt: '', draggable: false });
  const focalDot = h('span', { class: 'focal__dot' });
  const focalStage = h('div', { class: 'focal__stage' }, h('div', { class: 'focal__frame' }, focalImg, focalDot));
  const resetAll = h('button', { type: 'button', class: 'link-btn', onclick: () => {
    if (!current) return;
    current.overrides.clear();
    renderPreviews();
    renderFocal();
  } }, icon('reset', 13), 'Annuler les ajustements par format');
  const focalCard = h(
    'section',
    { class: 'card' },
    h('div', { class: 'section__head' }, h('h2', { class: 'section__title' }, 'Point focal'), h('span', { class: 'field__hint' }, "clique sur l'élément à garder")),
    focalStage,
    resetAll,
  );
  focalStage.addEventListener('pointerdown', (e) => {
    if (!current) return;
    const set = (ev: PointerEvent) => {
      const r = focalImg.getBoundingClientRect();
      current!.focal = { x: Math.min(1, Math.max(0, (ev.clientX - r.left) / r.width)), y: Math.min(1, Math.max(0, (ev.clientY - r.top) / r.height)) };
      renderFocal();
      renderPreviews();
    };
    set(e);
    focalStage.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => set(ev);
    const up = () => {
      focalStage.removeEventListener('pointermove', move);
      focalStage.removeEventListener('pointerup', up);
    };
    focalStage.addEventListener('pointermove', move);
    focalStage.addEventListener('pointerup', up);
  });

  // ================= Formats =================
  const formatsBody = h('div', { class: 'stack' });
  const customW = h('input', { type: 'number', class: 'input input--num', placeholder: 'Largeur', min: 16, max: 8000 });
  const customH = h('input', { type: 'number', class: 'input input--num', placeholder: 'Hauteur', min: 16, max: 8000 });
  const customForm = h(
    'form',
    { class: 'custom-size' },
    customW,
    h('span', { class: 'muted' }, '×'),
    customH,
    h('button', { type: 'submit', class: 'btn btn--ghost btn--sm' }, icon('plus', 13), 'Ajouter'),
  );
  customForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const w = Math.round(Number(customW.value));
    const hh = Math.round(Number(customH.value));
    if (!(w >= 16 && hh >= 16 && w <= 8000 && hh <= 8000)) return toast('Taille entre 16 et 8000 px', 'error');
    const id = `c${w}x${hh}`;
    if (!opts.customs.some((c) => c.id === id)) opts.customs.push({ id, group: 'custom', label: `${w} × ${hh}`, slug: `${w}x${hh}`, w, h: hh });
    if (!opts.selected.includes(id)) opts.selected.push(id);
    customW.value = customH.value = '';
    save();
    renderFormats();
    renderPreviews();
  });
  const formatsCard = h('section', { class: 'card' }, h('div', { class: 'section__head' }, h('h2', { class: 'section__title' }, 'Formats'), h('span', { class: 'section__count' })), formatsBody, customForm);

  // ================= Rendu =================
  const seg = <T extends string>(items: [T, string][], get: () => T, set: (v: T) => void) => {
    const buttons = items.map(([v, l]) => h('button', { type: 'button', class: 'seg__btn', onclick: () => {
      set(v);
      save();
      renderOptions();
      renderPreviews();
    } }, l));
    return { el: h('div', { class: 'seg' }, buttons), sync: () => buttons.forEach((b, i) => b.classList.toggle('is-on', items[i][0] === get())) };
  };
  const fitSeg = seg<Fit>([['cover', 'Recadrer'], ['blur', 'Fond flou'], ['color', 'Fond uni']], () => opts.fit, (v) => (opts.fit = v));
  const colorInput = h('input', { type: 'color', class: 'color', 'aria-label': 'Couleur de fond' });
  colorInput.addEventListener('input', () => {
    opts.color = colorInput.value;
    save();
    renderPreviews();
  });
  const colorRow = h('div', { class: 'row' }, colorInput, h('span', { class: 'field__hint' }, 'couleur du fond (et des zones transparentes)'));
  const fmtSeg = seg<Options['format']>([['jpeg', 'JPG'], ['png', 'PNG'], ['webp', 'WebP']], () => opts.format, (v) => (opts.format = v));
  const qSlider = h('input', { type: 'range', class: 'range', min: 50, max: 100, step: 1, 'aria-label': 'Qualité réseaux sociaux' });
  const qValue = h('span', { class: 'range__value' });
  qSlider.addEventListener('input', () => {
    opts.socialQuality = Number(qSlider.value);
    renderOptions();
    save();
  });
  const kbInput = h('input', { type: 'number', class: 'input input--num', min: 10, step: 10, 'aria-label': 'Poids max display' });
  kbInput.addEventListener('input', () => {
    const v = Number(kbInput.value);
    if (v >= 10) {
      opts.displayKB = Math.round(v);
      save();
    }
  });
  const pngNote = h('p', { class: 'field__hint' }, 'PNG : sans perte, le poids max ne s\'applique pas.');
  const renderCard = h(
    'section',
    { class: 'card settings' },
    h('div', { class: 'section__head' }, h('h2', { class: 'section__title' }, 'Rendu')),
    h('div', { class: 'field' }, h('div', { class: 'field__label' }, h('span', {}, 'Remplissage')), fitSeg.el, colorRow),
    h('div', { class: 'field' }, h('div', { class: 'field__label' }, h('span', {}, 'Format des fichiers')), fmtSeg.el, pngNote),
    h('div', { class: 'field' }, h('div', { class: 'field__label' }, h('span', {}, 'Qualité réseaux sociaux')), h('div', { class: 'range-wrap' }, qSlider, qValue)),
    h('div', { class: 'field' }, h('div', { class: 'field__label' }, h('span', {}, 'Poids max display'), h('span', { class: 'field__hint' }, 'standard IAB : 150 Ko')), h('div', { class: 'input-unit' }, kbInput, h('span', {}, 'Ko'))),
  );

  // ================= Aperçu =================
  const safeToggle = h('input', { type: 'checkbox' });
  safeToggle.addEventListener('change', () => {
    opts.safe = safeToggle.checked;
    save();
    renderOptions();
    renderPreviews();
  });
  const platformSelect = h(
    'select',
    { class: 'input select select--ghost', 'aria-label': 'Plateforme' },
    h('option', { value: 'all' }, 'Toutes plateformes'),
    Object.keys(VARIANT_PRESETS[0].safe ?? {}).map((p) => h('option', { value: p }, p)),
  );
  platformSelect.addEventListener('change', () => {
    opts.platform = platformSelect.value;
    save();
    renderPreviews();
  });
  const grid = h('div', { class: 'var-grid' });
  const previewCard = h(
    'section',
    { class: 'card' },
    h('div', { class: 'section__head' }, h('h2', { class: 'section__title' }, 'Aperçu'), h('span', { class: 'field__hint' }, 'glisse dans un format pour l\'ajuster')),
    h('div', { class: 'row var-safe' }, h('label', { class: 'check' }, safeToggle, h('span', { class: 'check__box' }, icon('check', 12)), h('span', {}, 'Zones de sécurité')), h('span', { class: 'spacer' }), platformSelect),
    grid,
  );

  const workArea = h('div', { class: 'stack var-work' }, sourcesBar, focalCard, formatsCard, renderCard, previewCard);
  root.append(input, hero, workArea);

  // ================= Pied =================
  const summary = h('div', { class: 'footer__summary' });
  const progress = h('div', { class: 'footer__progress' }, h('div', { class: 'footer__bar' }));
  const exportBtn = h('button', { type: 'button', class: 'btn btn--primary' }, icon('zip', 15), h('span', {}, 'Exporter (.zip)'));
  exportBtn.addEventListener('click', exportAll);
  footer.append(progress, h('div', { class: 'footer__row' }, summary, h('div', { class: 'footer__actions' }, exportBtn)));

  // ================= Logique =================
  async function addSources(files: { blob: Blob; name: string }[]) {
    for (const f of files) {
      try {
        const parts = await normalize(f.blob, f.name, { pdfDpi: 150 });
        for (const p of parts) {
          let blob = p.source;
          if (p.kind === 'svg') {
            // Vectoriel : on rastérise assez grand pour le plus grand format.
            const size = await probe(p.source, f.name);
            const scale = Math.min(8, Math.max(1, 2400 / Math.max(size.width, size.height)));
            blob = await rasterizeSvg(p.source, scale);
          }
          const bitmap = await createImageBitmap(blob);
          const src: Source = {
            id: `s${++idCounter}`,
            name: p.name,
            blob,
            bitmap,
            url: URL.createObjectURL(blob),
            w: bitmap.width,
            h: bitmap.height,
            focal: { x: 0.5, y: 0.5 },
            overrides: new Map(),
          };
          sources.push(src);
          current = src;
        }
      } catch (e) {
        toast(`${f.name} : ${e instanceof Error ? e.message : 'illisible'}`, 'error');
      }
    }
    renderAll();
  }

  function removeSource(src: Source) {
    const i = sources.indexOf(src);
    sources.splice(i, 1);
    src.bitmap.close();
    URL.revokeObjectURL(src.url);
    if (current === src) current = sources[Math.min(i, sources.length - 1)] ?? null;
    renderAll();
  }

  function renderSources() {
    strip.replaceChildren(
      ...sources.map((s) => {
        const del = h('button', { type: 'button', class: 'chip-del', title: 'Retirer' }, icon('x', 10));
        const el = h('button', { type: 'button', class: `src-thumb${s === current ? ' is-on' : ''}`, title: s.name }, h('img', { src: s.url, alt: '' }), del);
        el.addEventListener('click', (e) => {
          if ((e.target as HTMLElement).closest('.chip-del')) return removeSource(s);
          current = s;
          renderAll();
        });
        return el;
      }),
    );
  }

  function renderFocal() {
    if (!current) return;
    if (focalImg.getAttribute('src') !== current.url) focalImg.src = current.url;
    focalDot.style.left = `${current.focal.x * 100}%`;
    focalDot.style.top = `${current.focal.y * 100}%`;
    resetAll.hidden = current.overrides.size === 0;
  }

  function renderFormats() {
    const groups: [VariantPreset['group'], string][] = [
      ['social', 'Réseaux sociaux'],
      ['display', 'Display (IAB)'],
      ['custom', 'Formats perso'],
    ];
    formatsBody.replaceChildren(
      ...groups
        .map(([g, label]) => {
          const list = allVariants().filter((v) => v.group === g);
          if (!list.length) return null;
          const all = list.every((v) => opts.selected.includes(v.id));
          return h(
            'div',
            { class: 'var-group' },
            h(
              'div',
              { class: 'field__label' },
              h('span', {}, label),
              h('button', { type: 'button', class: 'link-btn', onclick: () => {
                opts.selected = all ? opts.selected.filter((id) => !list.some((v) => v.id === id)) : [...new Set([...opts.selected, ...list.map((v) => v.id)])];
                save();
                renderFormats();
                renderPreviews();
              } }, all ? 'Aucun' : 'Tout'),
            ),
            h(
              'div',
              { class: 'var-chips' },
              list.map((v) =>
                h(
                  'button',
                  {
                    type: 'button',
                    class: `var-chip${opts.selected.includes(v.id) ? ' is-on' : ''}`,
                    title: v.hint ?? '',
                    onclick: () => {
                      opts.selected = opts.selected.includes(v.id) ? opts.selected.filter((x) => x !== v.id) : [...opts.selected, v.id];
                      save();
                      renderFormats();
                      renderPreviews();
                    },
                    oncontextmenu: (e: Event) => {
                      if (v.group !== 'custom') return;
                      e.preventDefault();
                      opts.customs = opts.customs.filter((c) => c.id !== v.id);
                      opts.selected = opts.selected.filter((x) => x !== v.id);
                      save();
                      renderFormats();
                      renderPreviews();
                    },
                  },
                  h('strong', {}, v.group === 'display' || v.group === 'custom' ? `${v.w}×${v.h}` : v.label),
                  h('span', {}, v.group === 'display' ? v.label : v.group === 'custom' ? 'clic droit : supprimer' : `${v.w}×${v.h}`),
                ),
              ),
            ),
          );
        })
        .filter((n): n is HTMLDivElement => !!n),
    );
    (formatsCard.querySelector('.section__count') as HTMLElement).textContent = String(opts.selected.filter((id) => allVariants().some((v) => v.id === id)).length);
  }

  function renderOptions() {
    fitSeg.sync();
    fmtSeg.sync();
    colorInput.value = opts.color;
    colorRow.hidden = opts.fit === 'cover' && opts.format !== 'jpeg';
    qSlider.value = String(opts.socialQuality);
    qSlider.style.setProperty('--fill', `${((opts.socialQuality - 50) / 50) * 100}%`);
    qValue.textContent = String(opts.socialQuality);
    if (document.activeElement !== kbInput) kbInput.value = String(opts.displayKB);
    pngNote.hidden = opts.format !== 'png';
    safeToggle.checked = opts.safe;
    platformSelect.value = opts.platform;
    platformSelect.hidden = !opts.safe;
  }

  /** Dessine un format en petit (même logique de cadrage que l'export). */
  function drawVariant(canvas: HTMLCanvasElement, src: Source, v: VariantPreset) {
    const box = 168;
    const k = Math.min(box / v.w, box / v.h);
    const cw = Math.max(24, Math.round(v.w * k));
    const ch = Math.max(12, Math.round(v.h * k));
    const dpr = window.devicePixelRatio || 1;
    canvas.width = cw * dpr;
    canvas.height = ch * dpr;
    canvas.style.width = `${cw}px`;
    canvas.style.height = `${ch}px`;
    const ctx = canvas.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.imageSmoothingQuality = 'high';
    const focal = src.overrides.get(v.id) ?? src.focal;
    if (opts.fit === 'cover') {
      const r = coverCrop(src.w, src.h, v.w, v.h, focal);
      ctx.drawImage(src.bitmap, r.x, r.y, r.w, r.h, 0, 0, cw, ch);
    } else {
      if (opts.fit === 'blur') {
        const r = coverCrop(src.w, src.h, v.w, v.h, { x: 0.5, y: 0.5 });
        ctx.filter = `blur(${Math.max(3, Math.round(Math.max(cw, ch) / 40))}px) brightness(0.85)`;
        ctx.drawImage(src.bitmap, r.x, r.y, r.w, r.h, -6, -6, cw + 12, ch + 12);
        ctx.filter = 'none';
      } else {
        ctx.fillStyle = opts.color;
        ctx.fillRect(0, 0, cw, ch);
      }
      const s = Math.min(cw / src.w, ch / src.h);
      ctx.drawImage(src.bitmap, (cw - src.w * s) / 2, (ch - src.h * s) / 2, src.w * s, src.h * s);
    }
    const zone = opts.safe ? safeFor(v, opts.platform) : null;
    if (zone) {
      ctx.fillStyle = 'rgba(255, 70, 70, 0.32)';
      ctx.fillRect(0, 0, cw, ch * zone.top);
      ctx.fillRect(0, ch * (1 - zone.bottom), cw, ch * zone.bottom);
      ctx.fillRect(0, ch * zone.top, cw * zone.left, ch * (1 - zone.top - zone.bottom));
      ctx.fillRect(cw * (1 - zone.right), ch * zone.top, cw * zone.right, ch * (1 - zone.top - zone.bottom));
      ctx.setLineDash([4, 3]);
      ctx.strokeStyle = 'rgba(255,255,255,0.9)';
      ctx.lineWidth = 1;
      ctx.strokeRect(cw * zone.left + 0.5, ch * zone.top + 0.5, cw * (1 - zone.left - zone.right) - 1, ch * (1 - zone.top - zone.bottom) - 1);
    }
    return { cw, ch };
  }

  function renderPreviews() {
    if (!current) return grid.replaceChildren();
    const src = current;
    grid.replaceChildren(
      ...selectedVariants().map((v) => {
        const canvas = h('canvas', { class: 'var-card__canvas' });
        const size = drawVariant(canvas, src, v);
        const upscale = opts.fit === 'cover' ? 1 / coverCrop(src.w, src.h, v.w, v.h, src.focal).scale : Math.max(src.w / v.w, src.h / v.h);
        const reset = h('button', { type: 'button', class: 'icon-btn icon-btn--sm', title: 'Revenir au point focal', hidden: !src.overrides.has(v.id) }, icon('reset', 12));
        reset.addEventListener('click', () => {
          src.overrides.delete(v.id);
          renderPreviews();
          renderFocal();
        });
        const card = h(
          'div',
          { class: 'var-card' },
          h('div', { class: 'var-card__stage' }, canvas),
          h(
            'div',
            { class: 'var-card__meta' },
            h('span', { class: 'var-card__name' }, v.group === 'display' ? `${v.w}×${v.h}` : v.label),
            upscale < 1 ? h('span', { class: 'pill pill--sm pill--bad', title: 'Le visuel source est plus petit : il sera agrandi' }, `agrandi ×${(1 / upscale).toFixed(1)}`) : null,
            h('span', { class: 'spacer' }),
            reset,
          ),
        );
        if (opts.fit === 'cover') {
          canvas.addEventListener('pointerdown', (e) => {
            canvas.setPointerCapture(e.pointerId);
            const start = { x: e.clientX, y: e.clientY, focal: { ...(src.overrides.get(v.id) ?? src.focal) } };
            const r = coverCrop(src.w, src.h, v.w, v.h, start.focal);
            const move = (ev: PointerEvent) => {
              // Glisser l'image : on déplace le cadrage en sens inverse.
              const fx = start.focal.x - ((ev.clientX - start.x) * (r.w / size.cw)) / src.w;
              const fy = start.focal.y - ((ev.clientY - start.y) * (r.h / size.ch)) / src.h;
              src.overrides.set(v.id, { x: Math.min(1, Math.max(0, fx)), y: Math.min(1, Math.max(0, fy)) });
              drawVariant(canvas, src, v);
            };
            const up = () => {
              canvas.removeEventListener('pointermove', move);
              canvas.removeEventListener('pointerup', up);
              reset.hidden = !src.overrides.has(v.id);
              renderFocal();
            };
            canvas.addEventListener('pointermove', move);
            canvas.addEventListener('pointerup', up);
          });
        }
        return card;
      }),
    );
  }

  function renderFooter(progressRatio?: number) {
    const n = selectedVariants().length * sources.length;
    footer.hidden = currentModule() !== 'variants' || !sources.length;
    summary.replaceChildren(
      h('strong', {}, `${n} fichier${n > 1 ? 's' : ''}`),
      h('span', { class: 'muted' }, ` · ${selectedVariants().length} format${selectedVariants().length > 1 ? 's' : ''} × ${sources.length} visuel${sources.length > 1 ? 's' : ''}`),
    );
    progress.hidden = progressRatio === undefined;
    (progress.firstElementChild as HTMLElement).style.width = `${Math.round((progressRatio ?? 0) * 100)}%`;
    exportBtn.disabled = exporting || n === 0;
    (exportBtn.lastElementChild as HTMLElement).textContent = exporting ? `Export… ${Math.round((progressRatio ?? 0) * 100)} %` : 'Exporter (.zip)';
  }

  function renderAll() {
    const has = sources.length > 0;
    hero.hidden = has;
    workArea.hidden = !has;
    renderSources();
    renderFocal();
    renderFormats();
    renderOptions();
    renderPreviews();
    renderFooter();
  }

  function settingsFor(v: VariantPreset): Settings {
    const s = cloneSettings(DEFAULT_SETTINGS);
    s.format = opts.format;
    s.background = opts.color;
    if (v.group === 'display' && opts.format !== 'png') {
      s.mode = 'target';
      s.targetKB = opts.displayKB;
    } else {
      s.mode = 'quality';
      s.compression = 100 - opts.socialQuality;
    }
    return s;
  }

  function fileName(src: Source, v: VariantPreset): string {
    const stem = baseName(src.name).replace(/[\\/:*?"<>|]+/g, '-');
    const ext = FORMATS[opts.format].ext;
    const folder = v.group === 'display' ? 'Display' : v.group === 'social' ? 'Reseaux-sociaux' : 'Formats-perso';
    const name = v.group === 'social' ? `${stem}_${v.slug}_${v.w}x${v.h}.${ext}` : `${stem}_${v.w}x${v.h}.${ext}`;
    return sources.length > 1 ? `${stem}/${folder}/${name}` : `${folder}/${name}`;
  }

  async function exportAll() {
    if (exporting || !sources.length) return;
    const jobs = sources.flatMap((src) => selectedVariants().map((v) => ({ src, v })));
    if (!jobs.length) return;
    exporting = true;
    pool ??= new WorkerPool();
    let done = 0;
    renderFooter(0);
    const overweight: string[] = [];
    try {
      const files = await Promise.all(
        jobs.map(async ({ src, v }) => {
          const res = await pool!.runQueued({
            sourceKey: `var-${src.id}`,
            source: src.blob,
            settings: settingsFor(v),
            compose: {
              width: v.w,
              height: v.h,
              fit: opts.fit === 'cover' ? 'cover' : 'contain',
              focal: src.overrides.get(v.id) ?? src.focal,
              background: opts.fit === 'blur' ? 'blur' : opts.color,
            },
          });
          done++;
          renderFooter(done / jobs.length);
          if (res.targetMet === false) overweight.push(`${v.w}×${v.h} (${formatBytes(res.blob.size)})`);
          return { name: fileName(src, v), blob: res.blob };
        }),
      );
      const stem = sources.length === 1 ? baseName(sources[0].name) : 'visuels';
      await downloadBlob(await buildZip(files), `declinaisons-${stem}-${timestamp()}.zip`);
      toast(`${files.length} déclinaisons exportées`, 'success');
      if (overweight.length) toast(`Au-dessus de ${opts.displayKB} Ko même en qualité minimale : ${overweight.join(', ')}`, 'error', 8000);
    } catch (e) {
      toast(`Export impossible : ${e instanceof Error ? e.message : e}`, 'error');
    } finally {
      exporting = false;
      renderFooter();
    }
  }

  registerDropHandler('variants', (files) => addSources(files));
  onModuleChange(() => renderFooter());
  renderAll();
}
