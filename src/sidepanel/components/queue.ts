import { h, icon } from '../dom';
import { store, type Item } from '../store';
import { FORMATS } from '../../core/types';
import { formatBytes, savingPercent } from '../../lib/files';
import { downloadItem } from '../actions';

interface Row {
  el: HTMLLIElement;
  update: () => void;
}

function createRow(item: Item): Row {
  const thumb = h('img', { class: 'row__thumb', src: item.thumbUrl, alt: '', loading: 'lazy', draggable: false });
  const name = h('div', { class: 'row__name' }, item.name);
  name.title = item.name;
  const info = h('div', { class: 'row__info' });
  const dot = h('span', { class: 'row__dot', title: 'Réglages spécifiques' });
  const dl = h('button', { type: 'button', class: 'icon-btn icon-btn--sm', title: 'Télécharger' }, icon('download', 14));
  const rm = h('button', { type: 'button', class: 'icon-btn icon-btn--sm', title: 'Retirer' }, icon('x', 14));
  dl.addEventListener('click', (e) => {
    e.stopPropagation();
    downloadItem(item);
  });
  rm.addEventListener('click', (e) => {
    e.stopPropagation();
    store.remove(item.id);
  });

  const el = h(
    'li',
    { class: 'row', tabindex: 0, onclick: () => store.select(item.id) },
    h('div', { class: 'row__thumb-wrap' }, thumb, dot),
    h('div', { class: 'row__body' }, name, info),
    h('div', { class: 'row__actions' }, dl, rm),
  );
  el.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      store.select(item.id);
    }
    if (e.key === 'Delete' || e.key === 'Backspace') store.remove(item.id);
  });

  const update = () => {
    el.classList.toggle('is-selected', store.selectedId === item.id);
    dot.hidden = !item.override;
    const busy = store.isBusy(item);
    const res = item.result;
    dl.disabled = !res || busy;
    if (item.error) {
      info.replaceChildren(h('span', { class: 'pill pill--bad' }, 'Erreur'), h('span', { class: 'muted ellipsis' }, item.error));
      return;
    }
    if (busy) {
      info.replaceChildren(
        h('span', { class: 'spinner spinner--sm' }),
        h('span', { class: 'muted' }, `${formatBytes(item.origSize)} · ${item.inflightVersion === item.version ? 'encodage…' : 'en attente'}`),
      );
      return;
    }
    if (res) {
      const pct = savingPercent(item.origSize, res.blob.size);
      info.replaceChildren(
        h('span', { class: 'muted' }, formatBytes(item.origSize)),
        h('span', { class: 'arrow' }, '→'),
        h('span', {}, formatBytes(res.blob.size)),
        item.kind === 'svg' || item.kind === 'pdf'
          ? h('span', { class: 'pill pill--sm pill--neutral' }, item.kind === 'pdf' ? 'PDF' : 'SVG')
          : h('span', { class: `pill pill--sm ${pct >= 0 ? 'pill--good' : 'pill--bad'}` }, pct >= 0 ? `−${pct} %` : `+${-pct} %`),
        h('span', { class: 'muted tag' }, FORMATS[store.settingsFor(item).format].label),
      );
    }
  };
  update();
  return { el, update };
}

export function mountQueue(root: HTMLElement) {
  const list = h('ul', { class: 'queue', 'aria-label': 'Images' });
  const count = h('span', { class: 'section__count' });
  root.append(h('div', { class: 'section__head' }, h('h2', { class: 'section__title' }, 'Images'), count), list);

  const rows = new Map<string, Row>();

  const renderAll = () => {
    root.hidden = store.items.length === 0;
    count.textContent = String(store.items.length);
    const ids = new Set(store.items.map((i) => i.id));
    for (const [id, row] of rows) {
      if (!ids.has(id)) {
        row.el.remove();
        rows.delete(id);
      }
    }
    for (const item of store.items) {
      let row = rows.get(item.id);
      if (!row) {
        row = createRow(item);
        rows.set(item.id, row);
      }
      list.append(row.el); // garde l'ordre
      row.update();
    }
  };

  store.on('items', renderAll);
  store.on('selection', () => rows.forEach((r) => r.update()));
  store.on('item', (id) => rows.get(id as string)?.update());
  renderAll();
}
