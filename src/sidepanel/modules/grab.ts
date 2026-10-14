// Module Récupérer : liste les images de l'onglet actif (meilleure résolution,
// SVG intégrés, fonds CSS…), puis téléchargement ou envoi au convertisseur.
import { h, icon } from '../dom';
import { toast } from '../components/toast';
import { store } from '../store';
import { buildZip, dedupeNames, downloadBlob, timestamp } from '../../lib/files';
import { currentModule, onModuleChange, showModule } from '../nav';
import { collectImages, type Found } from './grab-collect';
import { captureFullPage, captureVideoFrame, dataUrlToBlob } from './capture';
import { engine, engineStatus } from '../../lib/engine';

interface GrabItem extends Found {
  key: string;
  ext: string;
  selected: boolean;
  /** URL affichable (blob: pour les SVG intégrés). */
  thumb: string;
  failed: boolean;
}

const KIND_LABEL: Record<Found['kind'], string> = {
  img: 'Image',
  bg: 'Fond CSS',
  svg: 'SVG intégré',
  poster: 'Affiche vidéo',
  icon: 'Icône',
  meta: 'Partage',
};

const MIN_SIZES = [0, 100, 300, 800];

function extOf(f: Found): string {
  if (f.kind === 'svg') return 'svg';
  const data = /^data:image\/([a-z0-9+.-]+)/i.exec(f.url);
  if (data) return data[1].replace('svg+xml', 'svg').replace('jpeg', 'jpg').toLowerCase();
  try {
    const path = new URL(f.url).pathname.toLowerCase();
    const m = /\.(jpe?g|png|webp|avif|gif|svg|ico|bmp|tiff?|heic|jxl)$/.exec(path);
    if (m) return m[1].replace('jpeg', 'jpg').replace('tiff', 'tif');
    // CDN : format dans les paramètres (?fm=webp, ?format=jpg…)
    const q = new URL(f.url).searchParams;
    const fmt = (q.get('fm') || q.get('format') || q.get('f') || '').toLowerCase();
    if (/^(jpe?g|png|webp|avif|gif)$/.test(fmt)) return fmt.replace('jpeg', 'jpg');
  } catch {
    /* URL invalide */
  }
  return '';
}

function fileNameOf(item: GrabItem, blobType: string): string {
  const ext = item.ext || ({ 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/avif': 'avif', 'image/gif': 'gif', 'image/svg+xml': 'svg' } as Record<string, string>)[blobType] || 'img';
  let stem = item.kind === 'svg' ? item.url : 'image';
  try {
    if (!item.url.startsWith('data:') && item.kind !== 'svg') {
      const last = decodeURIComponent(new URL(item.url).pathname.split('/').filter(Boolean).pop() ?? '');
      if (last) stem = last.replace(/\.[a-z0-9]+$/i, '');
    }
  } catch {
    /* nom par défaut */
  }
  stem = stem.replace(/[\\/:*?"<>|]+/g, '-').slice(0, 80) || 'image';
  return `${stem}.${ext}`;
}

async function fetchItem(item: GrabItem): Promise<{ blob: Blob; name: string }> {
  if (item.svg) {
    const blob = new Blob([item.svg], { type: 'image/svg+xml' });
    return { blob, name: fileNameOf(item, blob.type) };
  }
  const res = await fetch(item.url, { credentials: 'include' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const blob = await res.blob();
  return { blob, name: fileNameOf(item, blob.type) };
}

export function mountGrab(root: HTMLElement, footer: HTMLElement) {
  let items: GrabItem[] = [];
  let typeFilter = 'all';
  let minSize = 0;
  let analyzing = false;
  let pageInfo = { title: '', host: '' };

  // ---------- En-tête ----------
  const title = h('div', { class: 'grab-page__title' });
  const host = h('div', { class: 'grab-page__host muted' });
  const scanBtn = h('button', { type: 'button', class: 'btn btn--primary btn--sm' }, icon('refresh', 14), h('span', {}, 'Analyser la page'));
  scanBtn.addEventListener('click', () => scan());
  const head = h('section', { class: 'card grab-page' }, h('div', { class: 'grab-page__info' }, title, host), scanBtn);

  // ---------- Filtres ----------
  const typeChips = h('div', { class: 'chips' });
  const sizeSelect = h(
    'select',
    { class: 'input select select--ghost', 'aria-label': 'Taille minimale' },
    MIN_SIZES.map((v) => h('option', { value: v }, v ? `≥ ${v} px` : 'Toutes tailles')),
  );
  sizeSelect.addEventListener('change', () => {
    minSize = Number(sizeSelect.value);
    render();
  });
  const selectAll = h('input', { type: 'checkbox' });
  selectAll.addEventListener('change', () => {
    visible().forEach((i) => (i.selected = selectAll.checked));
    render();
  });
  const filters = h(
    'div',
    { class: 'grab-filters' },
    typeChips,
    h('div', { class: 'row grab-filters__row' }, h('label', { class: 'check' }, selectAll, h('span', { class: 'check__box' }, icon('check', 12)), h('span', {}, 'Tout sélectionner')), h('span', { class: 'spacer' }), sizeSelect),
  );

  const grid = h('div', { class: 'grab-grid' });
  const emptyMsg = h('div', { class: 'grab-empty muted' });
  // ---------- Captures ----------
  const pageBtn = h('button', { type: 'button', class: 'btn btn--ghost btn--sm', title: 'Toute la page, en défilant (résolution Retina ×2)' }, icon('page', 14), 'Page entière');
  const frameBtn = h('button', { type: 'button', class: 'btn btn--ghost btn--sm', title: 'Image de la vidéo en cours, à sa résolution native' }, icon('camera', 14), 'Image vidéo');
  const captureStatus = h('span', { class: 'field__hint capture__status' });
  const captureResult = h('div', { class: 'capture__result', hidden: true });
  const captureCard = h(
    'section',
    { class: 'card capture' },
    h('div', { class: 'row capture__row' }, h('span', { class: 'section__title' }, 'Capturer'), h('span', { class: 'spacer' }), pageBtn, frameBtn),
    captureStatus,
    captureResult,
  );

  async function activeTab() {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    if (!tab?.id || !tab.url || !/^(https?|file):/.test(tab.url)) throw new Error('Ouvre une page web (les pages internes du navigateur ne sont pas capturables)');
    return tab as chrome.tabs.Tab & { id: number; url: string };
  }

  function showCapture(blob: Blob, w: number, hgt: number, label: string, base: string) {
    const url = URL.createObjectURL(blob);
    const name = `${base.replace(/[\\/:*?"<>|]+/g, '-').slice(0, 60) || 'capture'}-${timestamp()}.png`;
    const dl = h('button', { type: 'button', class: 'btn btn--ghost btn--sm' }, icon('download', 14), 'PNG');
    dl.addEventListener('click', () => downloadBlob(blob, name));
    const conv = h('button', { type: 'button', class: 'btn btn--primary btn--sm' }, icon('send', 14), 'Convertir');
    conv.addEventListener('click', async () => {
      showModule('convert');
      await store.addFiles([{ blob, name }]);
    });
    const close = h('button', { type: 'button', class: 'icon-btn icon-btn--sm', title: 'Fermer' }, icon('x', 13));
    close.addEventListener('click', () => {
      captureResult.hidden = true;
      URL.revokeObjectURL(url);
    });
    captureResult.replaceChildren(
      h('img', { src: url, alt: label, class: 'capture__img' }),
      h('div', { class: 'row capture__meta' }, h('div', {}, h('strong', {}, label), h('div', { class: 'muted' }, `${w} × ${hgt} px · ${formatSize(blob.size)}`)), h('span', { class: 'spacer' }), dl, conv, close),
    );
    captureResult.hidden = false;
  }
  const formatSize = (n: number) => (n > 1048576 ? `${(n / 1048576).toFixed(1).replace('.', ',')} Mo` : `${Math.round(n / 1024)} Ko`);

  async function busy(btn: HTMLButtonElement, fn: () => Promise<void>) {
    pageBtn.disabled = frameBtn.disabled = true;
    btn.classList.add('is-busy');
    try {
      await fn();
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'error', 7000);
    } finally {
      pageBtn.disabled = frameBtn.disabled = false;
      btn.classList.remove('is-busy');
      captureStatus.textContent = '';
    }
  }

  pageBtn.addEventListener('click', () =>
    busy(pageBtn, async () => {
      const tab = await activeTab();
      const r = await captureFullPage(tab.id, 2, (m) => (captureStatus.textContent = m));
      showCapture(r.blob, r.width, r.height, 'Page entière', tab.title || 'page');
      if (r.truncated) toast('Page très longue : capture limitée aux 30 000 premiers pixels', 'info', 6000);
    }),
  );

  frameBtn.addEventListener('click', () =>
    busy(frameBtn, async () => {
      const tab = await activeTab();
      captureStatus.textContent = 'Recherche de la vidéo…';
      const r = await captureVideoFrame(tab.id);
      if (r.error === 'none') throw new Error('Aucune vidéo en cours sur cette page');
      if (r.dataUrl) {
        showCapture(await dataUrlToBlob(r.dataUrl), r.width!, r.height!, 'Image vidéo', tab.title || 'video');
        return;
      }
      // Vidéo protégée par son domaine : le moteur local récupère l'image dans le meilleur flux.
      if (!(await engineStatus())) throw new Error("Cette vidéo bloque la capture directe. Installe le moteur (onglet Lien) pour la capturer quand même.");
      captureStatus.textContent = 'Capture via le moteur local…';
      const bytes = await engine.frame(tab.url, r.time ?? 0, '');
      const blob = new Blob([bytes as BlobPart], { type: 'image/png' });
      const bmp = await createImageBitmap(blob);
      showCapture(blob, bmp.width, bmp.height, 'Image vidéo (meilleur flux)', tab.title || 'video');
      bmp.close();
    }),
  );

  root.append(head, captureCard, filters, grid, emptyMsg);

  // ---------- Pied ----------
  const count = h('div', { class: 'footer__summary' });
  const dlBtn = h('button', { type: 'button', class: 'btn btn--ghost' }, icon('download', 15), h('span', {}, 'Télécharger'));
  const convBtn = h('button', { type: 'button', class: 'btn btn--primary' }, icon('send', 15), h('span', {}, 'Convertir'));
  footer.append(h('div', { class: 'footer__row' }, count, h('div', { class: 'footer__actions' }, dlBtn, convBtn)));

  dlBtn.addEventListener('click', () => withSelection(async (files) => {
    if (files.length === 1) await downloadBlob(files[0].blob, files[0].name);
    else {
      const names = dedupeNames(files.map((f) => f.name));
      await downloadBlob(await buildZip(files.map((f, i) => ({ name: names[i], blob: f.blob }))), `images-${pageInfo.host || 'page'}-${timestamp()}.zip`);
    }
    toast(`${files.length} image${files.length > 1 ? 's' : ''} téléchargée${files.length > 1 ? 's' : ''}`, 'success');
  }));
  convBtn.addEventListener('click', () => withSelection(async (files) => {
    showModule('convert');
    const errors = await store.addFiles(files);
    if (errors.length) toast(`Ignoré : ${errors.slice(0, 2).join(' · ')}`, 'error', 6000);
  }));

  async function withSelection(fn: (files: { blob: Blob; name: string }[]) => Promise<void>) {
    const sel = items.filter((i) => i.selected);
    if (!sel.length) return;
    dlBtn.disabled = convBtn.disabled = true;
    const files: { blob: Blob; name: string }[] = [];
    let failed = 0;
    await Promise.all(
      sel.map(async (i) => {
        try {
          files.push(await fetchItem(i));
        } catch {
          failed++;
        }
      }),
    );
    if (failed) toast(`${failed} image${failed > 1 ? 's' : ''} impossible${failed > 1 ? 's' : ''} à récupérer`, 'error');
    if (files.length) await fn(files);
    renderFooter();
  }

  // ---------- Analyse ----------
  async function scan() {
    if (analyzing) return;
    analyzing = true;
    scanBtn.disabled = true;
    emptyMsg.textContent = 'Analyse en cours…';
    emptyMsg.hidden = false;
    try {
      const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
      if (!tab?.id) throw new Error('Aucun onglet actif');
      pageInfo = { title: tab.title ?? '', host: tab.url ? new URL(tab.url).hostname : '' };
      title.textContent = pageInfo.title || 'Page sans titre';
      host.textContent = pageInfo.host;
      const results = await chrome.scripting.executeScript({ target: { tabId: tab.id, allFrames: true }, func: collectImages });
      const merged = new Map<string, Found>();
      for (const r of results) for (const f of (r.result as Found[] | undefined) ?? []) merged.set(f.svg ? `${f.url}-${merged.size}` : f.url, f);
      items.forEach((i) => i.svg && URL.revokeObjectURL(i.thumb));
      items = [...merged.values()].map((f, n) => ({
        ...f,
        key: `g${n}`,
        ext: extOf(f),
        selected: false,
        thumb: f.svg ? URL.createObjectURL(new Blob([f.svg], { type: 'image/svg+xml' })) : f.url,
        failed: false,
      }));
      typeFilter = 'all';
      selectAll.checked = false;
      emptyMsg.textContent = items.length ? '' : 'Aucune image trouvée sur cette page.';
    } catch (e) {
      items = [];
      const msg = e instanceof Error ? e.message : String(e);
      emptyMsg.textContent = /cannot be scripted|Cannot access|chrome:\/\/|extensions gallery/i.test(msg)
        ? 'Chrome ne permet pas d\'analyser cette page (pages internes, Chrome Web Store…).'
        : `Analyse impossible : ${msg}`;
    } finally {
      analyzing = false;
      scanBtn.disabled = false;
      render();
    }
  }

  // ---------- Rendu ----------
  const typeOf = (i: GrabItem) => (['jpg', 'png', 'webp', 'svg', 'gif', 'avif'].includes(i.ext) ? i.ext : 'autre');
  const visible = () =>
    items.filter((i) => !i.failed && (typeFilter === 'all' || typeOf(i) === typeFilter) && (i.kind === 'svg' || !minSize || (i.w >= minSize || i.h >= minSize)));

  function render() {
    const counts = new Map<string, number>();
    items.filter((i) => !i.failed).forEach((i) => counts.set(typeOf(i), (counts.get(typeOf(i)) ?? 0) + 1));
    const types = ['all', ...['jpg', 'png', 'webp', 'avif', 'svg', 'gif', 'autre'].filter((t) => counts.has(t))];
    typeChips.replaceChildren(
      ...types.map((t) =>
        h(
          'button',
          {
            type: 'button',
            class: `chip${typeFilter === t ? ' is-on' : ''}`,
            onclick: () => {
              typeFilter = t;
              render();
            },
          },
          t === 'all' ? `Tout ${items.filter((i) => !i.failed).length}` : `${t.toUpperCase()} ${counts.get(t)}`,
        ),
      ),
    );
    filters.hidden = items.length === 0;
    const list = visible();
    grid.replaceChildren(...list.map(card));
    if (items.length && !list.length) {
      emptyMsg.textContent = 'Aucune image ne correspond aux filtres.';
      emptyMsg.hidden = false;
    } else emptyMsg.hidden = !emptyMsg.textContent || items.length > 0;
    renderFooter();
  }

  function renderFooter() {
    const sel = items.filter((i) => i.selected).length;
    footer.hidden = currentModule() !== 'grab' || items.length === 0;
    count.replaceChildren(h('strong', {}, `${sel} sélectionnée${sel > 1 ? 's' : ''}`), h('span', { class: 'muted' }, ` / ${visible().length}`));
    dlBtn.disabled = convBtn.disabled = sel === 0;
    (dlBtn.lastElementChild as HTMLElement).textContent = sel > 1 ? 'Télécharger (.zip)' : 'Télécharger';
  }

  function card(item: GrabItem): HTMLElement {
    const img = h('img', { src: item.thumb, alt: item.alt, loading: 'lazy', draggable: false, referrerpolicy: 'no-referrer' });
    const dims = h('span', { class: 'grab-card__dims' }, item.w && item.h ? `${item.w}×${item.h}` : '…');
    img.addEventListener('load', () => {
      if (item.kind !== 'svg' && (img.naturalWidth > item.w || !item.w)) {
        item.w = img.naturalWidth;
        item.h = img.naturalHeight;
      }
      dims.textContent = `${item.w}×${item.h}`;
      // Images de fond : la taille n'est connue qu'au chargement, le filtre s'applique ensuite.
      if (minSize && item.kind !== 'svg' && item.w < minSize && item.h < minSize) el.remove();
    });
    img.addEventListener('error', () => {
      item.failed = true;
      el.remove();
    });
    const open = h('button', { type: 'button', class: 'icon-btn icon-btn--sm', title: 'Ouvrir dans un onglet' }, icon('external', 13));
    open.addEventListener('click', (e) => {
      e.stopPropagation();
      chrome.tabs.create({ url: item.thumb });
    });
    const dl = h('button', { type: 'button', class: 'icon-btn icon-btn--sm', title: 'Télécharger' }, icon('download', 13));
    dl.addEventListener('click', async (e) => {
      e.stopPropagation();
      try {
        const f = await fetchItem(item);
        await downloadBlob(f.blob, f.name);
      } catch (err) {
        toast(`Téléchargement impossible : ${err instanceof Error ? err.message : err}`, 'error');
      }
    });
    const el = h(
      'div',
      { class: `grab-card${item.selected ? ' is-selected' : ''}`, title: `${KIND_LABEL[item.kind]}${item.alt ? ` — ${item.alt}` : ''}` },
      h('div', { class: 'grab-card__thumb' }, img, h('span', { class: 'grab-card__check' }, icon('check', 12))),
      h('div', { class: 'grab-card__meta' }, h('span', { class: 'grab-card__ext' }, (item.ext || 'img').toUpperCase()), dims, h('span', { class: 'spacer' }), open, dl),
    );
    el.addEventListener('click', () => {
      item.selected = !item.selected;
      el.classList.toggle('is-selected', item.selected);
      renderFooter();
    });
    return el;
  }

  // Analyse automatique à l'ouverture du module et au changement d'onglet / de page.
  onModuleChange((m) => {
    if (m === 'grab' && !items.length && !analyzing) scan();
    renderFooter();
  });
  chrome.tabs.onActivated.addListener(() => currentModule() === 'grab' && scan());
  chrome.tabs.onUpdated.addListener((_id, info, tab) => {
    if (currentModule() === 'grab' && info.status === 'complete' && tab.active) scan();
  });

  emptyMsg.textContent = 'Ouvre une page web puis clique sur « Analyser la page ».';
  render();
}
