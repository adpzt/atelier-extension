import { h, icon } from '../dom';
import { store } from '../store';
import { formatBytes, savingPercent } from '../../lib/files';
import { downloadAll } from '../actions';

export function mountFooter(root: HTMLElement) {
  const summary = h('div', { class: 'footer__summary' });
  const progress = h('div', { class: 'footer__progress' }, h('div', { class: 'footer__bar' }));
  const zipBtn = h('button', { type: 'button', class: 'btn btn--primary' });
  const clearBtn = h('button', { type: 'button', class: 'btn btn--ghost', title: 'Vider la liste' }, icon('trash', 15));
  let exporting = false;

  zipBtn.addEventListener('click', async () => {
    if (exporting) return;
    exporting = true;
    render();
    try {
      await downloadAll();
    } finally {
      exporting = false;
      render();
    }
  });
  clearBtn.addEventListener('click', () => store.clear());

  root.append(progress, h('div', { class: 'footer__row' }, summary, h('div', { class: 'footer__actions' }, clearBtn, zipBtn)));

  function render() {
    const items = store.items;
    root.hidden = items.length === 0;
    if (!items.length) return;
    const busy = store.busyCount;
    const done = items.filter((i) => i.result && !store.isBusy(i));
    const before = done.reduce((a, i) => a + i.origSize, 0);
    const after = done.reduce((a, i) => a + i.result!.blob.size, 0);
    const pct = savingPercent(before, after);

    const parts: HTMLElement[] = [h('strong', {}, `${items.length} image${items.length > 1 ? 's' : ''}`)];
    if (done.length) {
      parts.push(
        h('span', { class: 'muted' }, ` · ${formatBytes(before)} → ${formatBytes(after)} `),
        h('span', { class: `pill pill--sm ${pct >= 0 ? 'pill--good' : 'pill--bad'}` }, pct >= 0 ? `−${pct} %` : `+${-pct} %`),
      );
    }
    summary.replaceChildren(...parts);

    const ratio = items.length ? (items.length - busy) / items.length : 1;
    progress.hidden = busy === 0;
    (progress.firstElementChild as HTMLElement).style.width = `${Math.round(ratio * 100)}%`;

    const label = exporting
      ? 'Préparation…'
      : busy
        ? `Encodage… ${items.length - busy}/${items.length}`
        : done.length > 1
          ? 'Tout télécharger (.zip)'
          : 'Télécharger';
    zipBtn.replaceChildren(icon(done.length > 1 ? 'zip' : 'download', 15), h('span', {}, label));
    zipBtn.disabled = exporting || busy > 0 || done.length === 0;
  }

  store.on('items', render);
  store.on('item', render);
  render();
}
