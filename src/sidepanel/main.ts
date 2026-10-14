import './styles.css';
import { store } from './store';
import { loadSettings } from '../lib/storage';
import { mountDropzone } from './components/dropzone';
import { mountCompare } from './components/compare';
import { mountSettings } from './components/settings';
import { mountQueue } from './components/queue';
import { mountFooter } from './components/footer';
import { mountPresets } from './components/presets';

const $ = (id: string) => document.getElementById(id) as HTMLElement;

async function boot() {
  store.init(await loadSettings());
  mountDropzone($('dropzone'));
  mountCompare($('preview'));
  mountSettings($('settings'));
  mountQueue($('queue'));
  mountFooter($('footer'));
  await mountPresets($('presets'), $('preset-form'));
  document.querySelector('.brand')?.setAttribute('title', `Atelier v${chrome.runtime.getManifest().version}`);
  document.body.classList.add('is-ready');
}

boot();
