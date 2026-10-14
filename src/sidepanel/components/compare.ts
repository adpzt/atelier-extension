import { h, icon } from '../dom';
import { store, type Item } from '../store';
import { FORMATS, usesTargetSize } from '../../core/types';
import { formatBytes, savingPercent } from '../../lib/files';
import { downloadItem } from '../actions';

export function mountCompare(root: HTMLElement) {
  let split = 50;
  let actualSize = false;

  const before = h('img', { class: 'compare__img compare__before', alt: 'Original', draggable: false });
  const after = h('img', { class: 'compare__img compare__after', alt: 'Converti', draggable: false });
  const handle = h('div', { class: 'compare__handle', role: 'slider', tabindex: 0, 'aria-label': 'Comparer avant / après' }, h('span', { class: 'compare__knob' }));
  const frame = h('div', { class: 'compare__frame' }, after, before, handle);
  const busy = h('div', { class: 'compare__busy' }, h('span', { class: 'spinner' }), 'Encodage…');
  const tagBefore = h('span', { class: 'compare__tag compare__tag--left' }, 'Original');
  const tagAfter = h('span', { class: 'compare__tag compare__tag--right' }, 'Converti');
  const stage = h('div', { class: 'compare' }, frame, tagBefore, tagAfter, busy);

  const zoomBtn = h('button', { class: 'icon-btn', type: 'button', title: 'Taille réelle (100 %)' }, icon('expand', 15));
  zoomBtn.addEventListener('click', () => {
    actualSize = !actualSize;
    zoomBtn.replaceChildren(icon(actualSize ? 'fit' : 'expand', 15));
    zoomBtn.title = actualSize ? 'Ajuster à la fenêtre' : 'Taille réelle (100 %)';
    zoomBtn.classList.toggle('is-on', actualSize);
    layout();
  });

  const dlBtn = h('button', { class: 'icon-btn', type: 'button', title: 'Télécharger cette image' }, icon('download', 15));
  dlBtn.addEventListener('click', () => {
    const item = store.selected;
    if (item) downloadItem(item);
  });

  const title = h('div', { class: 'preview__name' });
  const sizes = h('div', { class: 'preview__sizes' });
  const meta = h('div', { class: 'preview__meta' });
  const warn = h('div', { class: 'preview__warn', hidden: true });

  root.append(
    h('div', { class: 'preview__head' }, title, h('div', { class: 'preview__tools' }, zoomBtn, dlBtn)),
    stage,
    h('div', { class: 'preview__stats' }, sizes, meta),
    warn,
  );

  // ----- Curseur -----
  const setSplit = (v: number) => {
    split = Math.min(100, Math.max(0, v));
    before.style.clipPath = `inset(0 ${100 - split}% 0 0)`;
    handle.style.left = `${split}%`;
    handle.setAttribute('aria-valuenow', String(Math.round(split)));
  };
  const fromPointer = (e: PointerEvent) => {
    const r = frame.getBoundingClientRect();
    setSplit(((e.clientX - r.left) / r.width) * 100);
  };
  let dragging: 'split' | 'pan' | null = null;
  let panStart = { x: 0, y: 0, left: 0, top: 0 };
  stage.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    if (actualSize && e.target !== handle && !handle.contains(e.target as Node)) {
      dragging = 'pan';
      panStart = { x: e.clientX, y: e.clientY, left: stage.scrollLeft, top: stage.scrollTop };
    } else {
      dragging = 'split';
      fromPointer(e);
    }
    stage.setPointerCapture(e.pointerId);
    stage.classList.add('is-dragging');
  });
  stage.addEventListener('pointermove', (e) => {
    if (dragging === 'split') fromPointer(e);
    else if (dragging === 'pan') {
      stage.scrollLeft = panStart.left - (e.clientX - panStart.x);
      stage.scrollTop = panStart.top - (e.clientY - panStart.y);
    }
  });
  const stop = () => {
    dragging = null;
    stage.classList.remove('is-dragging');
  };
  stage.addEventListener('pointerup', stop);
  stage.addEventListener('pointercancel', stop);
  handle.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowLeft') setSplit(split - 5);
    if (e.key === 'ArrowRight') setSplit(split + 5);
  });

  // ----- Rendu -----
  function layout() {
    const item = store.selected;
    stage.classList.toggle('is-actual', actualSize);
    if (!item) return;
    const w = item.result?.width ?? item.origW;
    const hgt = item.result?.height ?? item.origH;
    const dpr = window.devicePixelRatio || 1;
    if (actualSize) {
      frame.style.width = `${w / dpr}px`;
      frame.style.height = `${hgt / dpr}px`;
    } else {
      // Ajuster dans la zone, sans agrandir au-delà de la taille réelle.
      const scale = Math.min(stage.clientWidth / w, stage.clientHeight / hgt, 1 / dpr);
      frame.style.width = `${Math.max(1, Math.floor(w * scale))}px`;
      frame.style.height = `${Math.max(1, Math.floor(hgt * scale))}px`;
    }
  }

  let shownId: string | null = null;
  function render() {
    const item = store.selected;
    root.hidden = !item;
    if (!item) {
      shownId = null;
      return;
    }
    if (shownId !== item.id) {
      shownId = item.id;
      before.src = item.thumbUrl;
      stage.scrollTo(0, 0);
    }
    const res = item.result;
    if (res && after.getAttribute('src') !== res.previewUrl) after.src = res.previewUrl;
    tagAfter.textContent = res && res.previewUrl !== res.url ? 'Converti (aperçu)' : 'Converti';
    if (!res) after.removeAttribute('src');
    after.hidden = !res;
    handle.hidden = !res;
    tagAfter.hidden = !res;
    if (res) setSplit(split);
    else before.style.clipPath = 'none';
    busy.hidden = !store.isBusy(item);
    dlBtn.disabled = !res;
    layout();
    renderStats(item);
  }

  function renderStats(item: Item) {
    const s = store.settingsFor(item);
    title.textContent = item.name;
    title.title = item.name;
    const res = item.result;
    if (item.error) {
      sizes.replaceChildren(h('span', { class: 'pill pill--bad' }, 'Erreur'), ` ${item.error}`);
      meta.replaceChildren();
      warn.hidden = true;
      return;
    }
    if (!res) {
      sizes.replaceChildren(h('strong', {}, formatBytes(item.origSize)), h('span', { class: 'muted' }, ' → …'));
      meta.textContent = `${item.origW} × ${item.origH}`;
      warn.hidden = true;
      return;
    }
    const pct = savingPercent(item.origSize, res.blob.size);
    sizes.replaceChildren(
      h('span', { class: 'muted' }, formatBytes(item.origSize)),
      h('span', { class: 'arrow' }, '→'),
      h('strong', {}, formatBytes(res.blob.size)),
      // Un SVG ou une page PDF rastérisés sont forcément « plus lourds » : la comparaison n'a pas de sens.
      item.kind === 'svg' || item.kind === 'pdf'
        ? h('span', { class: 'pill pill--neutral' }, item.kind === 'pdf' ? 'page PDF → image' : 'vectoriel → pixels')
        : h('span', { class: `pill ${pct >= 0 ? 'pill--good' : 'pill--bad'}` }, pct >= 0 ? `−${pct} %` : `+${-pct} %`),
    );
    const dims =
      res.width !== item.origW || res.height !== item.origH
        ? `${item.origW} × ${item.origH} → ${res.width} × ${res.height}`
        : `${res.width} × ${res.height}`;
    const parts = [FORMATS[s.format].label, dims];
    if (res.quality !== null) parts.push(`qualité ${res.quality}`);
    else if (FORMATS[s.format].lossy) parts.push('sans perte');
    if (item.override) parts.push('réglages perso');
    meta.textContent = parts.join(' · ');

    const failedTarget = usesTargetSize(s) && res.targetMet === false;
    warn.hidden = !failedTarget;
    if (failedTarget) {
      warn.replaceChildren(icon('alert', 14), h('span', {}, `Objectif ${s.targetKB} Ko non atteint même en qualité minimale. Réduis la taille en pixels.`));
    } else if (pct < 0 && item.kind !== 'svg' && item.kind !== 'pdf') {
      warn.hidden = false;
      warn.replaceChildren(icon('alert', 14), h('span', {}, "Le fichier converti est plus lourd que l'original. Essaie un autre format ou plus de compression."));
    }
  }

  store.on('selection', render);
  store.on('item', (id) => {
    if (id === store.selectedId) render();
  });
  store.on('items', render);
  store.on('settings', () => store.selected && renderStats(store.selected));
  new ResizeObserver(() => layout()).observe(stage);
  render();
}
