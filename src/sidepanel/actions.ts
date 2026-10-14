import { store, type Item } from './store';
import { buildZip, dedupeNames, downloadBlob, outputName, timestamp } from '../lib/files';
import { toast } from './components/toast';

function nameFor(item: Item): string {
  const res = item.result!;
  return outputName({
    originalName: item.name,
    width: res.width,
    height: res.height,
    index: store.items.indexOf(item) + 1,
    quality: res.quality,
    settings: store.settingsFor(item),
  });
}

export async function downloadItem(item: Item) {
  if (!item.result || store.isBusy(item)) return;
  await downloadBlob(item.result.blob, nameFor(item));
}

export async function downloadAll() {
  const ready = store.items.filter((i) => i.result && !store.isBusy(i));
  if (!ready.length) return;
  if (ready.length === 1) {
    await downloadItem(ready[0]);
    return;
  }
  const names = dedupeNames(ready.map(nameFor));
  const zip = await buildZip(ready.map((item, i) => ({ name: names[i], blob: item.result!.blob })));
  await downloadBlob(zip, `kotak-${timestamp()}.zip`);
  const skipped = store.items.length - ready.length;
  toast(
    skipped ? `${ready.length} images exportées (${skipped} ignorée${skipped > 1 ? 's' : ''} : en cours ou en erreur)` : `${ready.length} images exportées en ZIP`,
    'success',
  );
}

/** Assemble les PDF convertis (une page par image) en un seul document. */
export async function downloadMergedPdf() {
  const ready = store.items.filter((i) => i.result && !store.isBusy(i) && i.result.blob.type === 'application/pdf');
  if (!ready.length) return;
  const { PDFDocument } = await import('pdf-lib');
  const out = await PDFDocument.create();
  out.setProducer('Kotak');
  for (const item of ready) {
    const src = await PDFDocument.load(await item.result!.blob.arrayBuffer());
    const pages = await out.copyPages(src, src.getPageIndices());
    pages.forEach((p) => out.addPage(p));
  }
  const bytes = await out.save();
  await downloadBlob(new Blob([bytes as BlobPart], { type: 'application/pdf' }), `kotak-${timestamp()}.pdf`);
  toast(`PDF de ${ready.length} page${ready.length > 1 ? 's' : ''} exporté`, 'success');
}
