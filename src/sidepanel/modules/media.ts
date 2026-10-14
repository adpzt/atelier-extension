// Module Médias : colle un lien (YouTube, TikTok, X, Instagram, Vimeo…) et télécharge
// en vidéo (jusqu'à 4K/8K), audio (MP3, WAV…) ou image, via le moteur local yt-dlp + ffmpeg.
import { h, icon } from '../dom';
import { toast } from '../components/toast';
import { store } from '../store';
import { currentModule, onModuleChange, showModule } from '../nav';
import { engine, engineError, engineStatus, type DownloadOptions, type EngineStatus, type JobEvent, type ProbeInfo } from '../../lib/engine';
import { formatBytes } from '../../lib/files';

type Opts = Omit<DownloadOptions, 'url'>;

const KEY = 'kotak.media';
const WINDOWS = /win/i.test((navigator as Navigator & { userAgentData?: { platform: string } }).userAgentData?.platform ?? navigator.platform);
const DEFAULTS: Opts = {
  mode: 'video',
  quality: 0,
  container: 'mp4',
  codec: 'h264',
  audio: 'mp3',
  bitrate: 320,
  depth: 24,
  start: '',
  end: '',
  cookies: '',
};

const QUALITIES: [number, string][] = [
  [0, 'Maximum disponible'],
  [4320, '8K (4320p)'],
  [2160, '4K (2160p)'],
  [1440, '1440p'],
  [1080, '1080p (Full HD)'],
  [720, '720p'],
  [480, '480p'],
];

const CODECS: [Opts['codec'], string][] = [
  ['h264', 'H.264 : lisible partout (Premiere, Keynote, QuickTime)'],
  ['original', 'Original : qualité intacte, le plus rapide'],
  ['hevc', 'HEVC (H.265) : plus léger, Apple / Premiere récents'],
  ['prores', 'ProRes 422 : montage (fichiers lourds, .mov)'],
];

const BROWSERS: [string, string][] = [
  ['', 'Aucune (contenus publics)'],
  ['brave', 'Brave'],
  ['chrome', 'Chrome'],
  ['safari', 'Safari'],
  ['firefox', 'Firefox'],
  ['edge', 'Edge'],
  ['arc', 'Arc'],
];

interface Job {
  key: string;
  info: ProbeInfo;
  opts: Opts;
  requestId: string | null;
  state: 'running' | 'done' | 'error' | 'cancelled';
  event: JobEvent;
  file?: string;
  size?: number;
  el?: HTMLElement;
}

function fmtDuration(s: number | null): string {
  if (!s) return '';
  const hh = Math.floor(s / 3600);
  const mm = Math.floor((s % 3600) / 60);
  const ss = Math.round(s % 60);
  return hh ? `${hh}:${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}` : `${mm}:${String(ss).padStart(2, '0')}`;
}

function qualityLabel(height: number | null): string {
  if (!height) return '';
  if (height >= 4320) return '8K';
  if (height >= 2160) return '4K';
  if (height >= 1440) return '1440p';
  return `${height}p`;
}

export async function mountMedia(root: HTMLElement) {
  let opts: Opts = { ...DEFAULTS };
  try {
    opts = { ...DEFAULTS, ...((await chrome.storage.local.get(KEY))[KEY] as Partial<Opts> | undefined) };
  } catch {
    /* valeurs par défaut */
  }
  const save = () => chrome.storage.local.set({ [KEY]: opts }).catch(() => undefined);
  let status: EngineStatus | null = null;
  let analyzed: ProbeInfo[] = [];
  const jobs: Job[] = [];

  // ---------- État du moteur ----------
  const statusBox = h('section', { class: 'card engine' });

  // ---------- Liens ----------
  const links = h('textarea', { class: 'input links', rows: 3, placeholder: 'Colle un ou plusieurs liens (un par ligne)\nYouTube, TikTok, Instagram, X, Vimeo, Facebook, SoundCloud…', spellcheck: false });
  const tabBtn = h('button', { type: 'button', class: 'btn btn--ghost btn--sm' }, icon('link', 14), "Lien de l'onglet");
  const analyzeBtn = h('button', { type: 'button', class: 'btn btn--primary btn--sm' }, icon('refresh', 14), 'Analyser');
  const results = h('div', { class: 'media-results' });
  const linkCard = h('section', { class: 'card' }, h('div', { class: 'section__head' }, h('h2', { class: 'section__title' }, 'Liens')), links, h('div', { class: 'row media-actions' }, tabBtn, h('span', { class: 'spacer' }), analyzeBtn), results);

  tabBtn.addEventListener('click', async () => {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    if (!tab?.url || !/^https?:/.test(tab.url)) return toast("L'onglet actuel n'a pas de lien web", 'error');
    links.value = links.value.trim() ? `${links.value.trim()}\n${tab.url}` : tab.url;
    analyze();
  });
  analyzeBtn.addEventListener('click', () => analyze());
  links.addEventListener('paste', () => setTimeout(() => analyze(), 50));

  // ---------- Options ----------
  const seg = <T extends string>(items: [T, string][], get: () => T, set: (v: T) => void) => {
    const buttons = items.map(([v, l]) => h('button', { type: 'button', class: 'seg__btn', onclick: () => {
      set(v);
      save();
      renderOptions();
    } }, l));
    return { el: h('div', { class: 'seg' }, buttons), sync: () => buttons.forEach((b, i) => b.classList.toggle('is-on', items[i][0] === get())) };
  };
  const select = <T extends string | number>(items: [T, string][], get: () => T, set: (v: T) => void, label: string) => {
    const el = h('select', { class: 'input select', 'aria-label': label }, items.map(([v, l]) => h('option', { value: String(v) }, l)));
    el.addEventListener('change', () => {
      const raw = el.value;
      set((typeof items[0][0] === 'number' ? Number(raw) : raw) as T);
      save();
      renderOptions();
    });
    return { el, sync: () => (el.value = String(get())) };
  };
  const field = (label: string, ...children: Node[]) => h('div', { class: 'field' }, h('div', { class: 'field__label' }, h('span', {}, label)), ...children);

  const modeSeg = seg<Opts['mode']>([['video', 'Vidéo'], ['audio', 'Audio'], ['image', 'Miniature']], () => opts.mode, (v) => (opts.mode = v));
  const qualitySel = select<number>(QUALITIES, () => opts.quality, (v) => (opts.quality = v), 'Qualité');
  const containerSeg = seg<Opts['container']>([['mp4', 'MP4'], ['mov', 'MOV'], ['mkv', 'MKV'], ['webm', 'WebM']], () => opts.container, (v) => (opts.container = v));
  const codecSel = select<Opts['codec']>(CODECS, () => opts.codec, (v) => (opts.codec = v), 'Codec');
  const codecNote = h('p', { class: 'field__hint' });
  const audioSeg = seg<Opts['audio']>([['mp3', 'MP3'], ['wav', 'WAV'], ['aiff', 'AIFF'], ['m4a', 'M4A'], ['flac', 'FLAC'], ['opus', 'Opus']], () => opts.audio, (v) => (opts.audio = v));
  const bitrateSel = select<number>([[320, '320 kb/s (max)'], [256, '256 kb/s'], [192, '192 kb/s'], [128, '128 kb/s']], () => opts.bitrate, (v) => (opts.bitrate = v), 'Débit MP3');
  const depthSeg = seg<'16' | '24'>([['16', '16 bits'], ['24', '24 bits']], () => String(opts.depth) as '16' | '24', (v) => (opts.depth = Number(v) as 16 | 24));
  const startInput = h('input', { type: 'text', class: 'input mono', placeholder: 'début 0:00', 'aria-label': 'Début' });
  const endInput = h('input', { type: 'text', class: 'input mono', placeholder: 'fin 1:30', 'aria-label': 'Fin' });
  for (const [el, k] of [[startInput, 'start'], [endInput, 'end']] as const) {
    el.addEventListener('input', () => {
      opts[k] = el.value.trim();
      save();
    });
  }
  const cookiesSel = select<string>(BROWSERS, () => opts.cookies, (v) => (opts.cookies = v), 'Session');
  const dirLabel = h('span', { class: 'mono ellipsis dir-label' });
  const dirBtn = h('button', { type: 'button', class: 'btn btn--ghost btn--sm' }, icon('folder', 14), 'Changer…');
  dirBtn.addEventListener('click', async () => {
    try {
      const r = await engine.chooseDir();
      if (status) status.dir = r.dir;
      renderStatus();
    } catch {
      /* annulé */
    }
  });

  const videoBlock = h('div', { class: 'stack' }, field('Qualité', qualitySel.el), field('Format', containerSeg.el), field('Codec', codecSel.el, codecNote));
  const audioBlock = h('div', { class: 'stack' }, field('Format audio', audioSeg.el), h('div', { class: 'mp3-only' }, field('Débit', bitrateSel.el)), h('div', { class: 'pcm-only' }, field('Profondeur', depthSeg.el)));
  const optionsCard = h(
    'section',
    { class: 'card settings' },
    h('div', { class: 'section__head' }, h('h2', { class: 'section__title' }, 'Téléchargement')),
    modeSeg.el,
    videoBlock,
    audioBlock,
    h('details', { class: 'advanced' },
      h('summary', {}, 'Extrait, session, dossier'),
      field('Seulement un extrait (optionnel)', h('div', { class: 'row' }, startInput, h('span', { class: 'muted' }, '→'), endInput)),
      field('Session (contenus privés, Instagram, YouTube restreint)', cookiesSel.el, h('p', { class: 'field__hint' }, 'Utilise ta connexion du navigateur choisi. macOS peut demander l\'accès au trousseau la première fois.')),
      field('Dossier', h('div', { class: 'row' }, dirLabel, dirBtn)),
    ),
  );

  const dlBtn = h('button', { type: 'button', class: 'btn btn--primary media-go' }, icon('download', 16), h('span', {}, 'Télécharger'));
  dlBtn.addEventListener('click', () => startAll());

  const queue = h('div', { class: 'media-queue' });
  const queueCard = h('section', { class: 'card' }, h('div', { class: 'section__head' }, h('h2', { class: 'section__title' }, 'Téléchargements')), queue);

  const work = h('div', { class: 'stack media-work' }, linkCard, optionsCard, dlBtn, queueCard);
  root.append(statusBox, work);

  // ---------- Rendu ----------
  function renderStatus() {
    if (status) {
      statusBox.className = 'card engine engine--ok';
      statusBox.replaceChildren(icon('check', 14), h('span', {}, `Moteur prêt · yt-dlp ${status.ytdlp} · ffmpeg ${status.ffmpeg}`));
      dirLabel.textContent = status.dir.replace(/^\/Users\/[^/]+/, '~').replace(/^[A-Z]:\\Users\\[^\\]+/i, '~');
      dirLabel.title = status.dir;
    } else {
      statusBox.className = 'card engine engine--missing';
      const err = engineError();
      const detail = err && !/not found/i.test(err) ? [h('p', { class: 'field__hint' }, `Détail : ${err}`)] : [];
      statusBox.replaceChildren(
        h('div', { class: 'engine__title' }, icon('alert', 15), h('strong', {}, 'Moteur Médias non installé')),
        h('p', {}, `Les téléchargements passent par yt-dlp et ffmpeg (gratuits, open source) installés sur ton ordinateur. Lance une fois cette commande dans ${WINDOWS ? 'PowerShell' : 'le Terminal'}, puis rouvre le panneau :`),
        h('pre', { class: 'mono engine__cmd' }, WINDOWS
          ? 'irm https://raw.githubusercontent.com/adpzt/kotak/main/scripts/install-windows.ps1 | iex'
          : 'curl -fsSL https://raw.githubusercontent.com/adpzt/kotak/main/scripts/install-mac.sh | bash'),
        ...detail,
      );
    }
    work.hidden = !status;
  }

  function renderOptions() {
    modeSeg.sync();
    qualitySel.sync();
    containerSeg.sync();
    codecSel.sync();
    audioSeg.sync();
    bitrateSel.sync();
    depthSeg.sync();
    cookiesSel.sync();
    startInput.value = opts.start;
    endInput.value = opts.end;
    cookiesSel.el.value = opts.cookies;
    videoBlock.hidden = opts.mode !== 'video';
    audioBlock.hidden = opts.mode !== 'audio';
    (audioBlock.querySelector('.mp3-only') as HTMLElement).hidden = opts.audio !== 'mp3';
    (audioBlock.querySelector('.pcm-only') as HTMLElement).hidden = !['wav', 'aiff'].includes(opts.audio);
    containerSeg.el.hidden = opts.codec === 'prores';
    codecNote.textContent =
      opts.codec === 'original'
        ? 'Attention : la 4K YouTube n\'existe qu\'en VP9 / AV1, que QuickTime et Keynote ne lisent pas. Choisis H.264 pour être tranquille.'
        : opts.codec === 'prores'
          ? 'Toujours en .mov, son en PCM. Idéal pour le montage, environ 10× plus lourd.'
          : 'Converti avec l\'encodeur matériel du Mac (rapide).';
    (dlBtn.lastElementChild as HTMLElement).textContent = analyzed.length > 1 ? `Télécharger les ${analyzed.length}` : 'Télécharger';
    dlBtn.disabled = analyzed.length === 0;
  }

  function renderResults(errors: string[]) {
    results.replaceChildren(
      ...analyzed.map((i) =>
        h(
          'div',
          { class: 'media-item' },
          i.thumbnail ? h('img', { class: 'media-item__thumb', src: i.thumbnail, alt: '', referrerpolicy: 'no-referrer' }) : h('div', { class: 'media-item__thumb' }, icon(i.hasVideo ? 'film' : 'music', 20)),
          h(
            'div',
            { class: 'media-item__body' },
            h('div', { class: 'media-item__title', title: i.title }, i.title),
            h('div', { class: 'media-item__meta muted' }, [i.site, i.uploader, fmtDuration(i.duration), qualityLabel(i.maxHeight)].filter(Boolean).join(' · ')),
          ),
        ),
      ),
      ...errors.map((e) => h('div', { class: 'preview__warn' }, icon('alert', 14), h('span', {}, e))),
    );
  }

  async function analyze() {
    const urls = [...new Set(links.value.split(/\s+/).map((u) => u.trim()).filter((u) => /^https?:\/\//i.test(u)))];
    if (!urls.length || !status) return;
    analyzeBtn.disabled = true;
    results.replaceChildren(h('div', { class: 'importing' }, h('span', { class: 'spinner spinner--sm' }), h('span', {}, `Analyse de ${urls.length} lien${urls.length > 1 ? 's' : ''}…`)));
    const errors: string[] = [];
    const found: ProbeInfo[] = [];
    await Promise.all(
      urls.map(async (u) => {
        try {
          found.push(await engine.probe(u, opts.cookies));
        } catch (e) {
          errors.push(`${u.slice(0, 60)} : ${e instanceof Error ? e.message : e}`);
        }
      }),
    );
    analyzed = urls.map((u) => found.find((f) => f.url === u || u.includes(f.url) || f.url.includes(u))).filter((f): f is ProbeInfo => !!f);
    // Liens redirigés (URL finale différente) : on garde aussi ceux non appariés.
    for (const f of found) if (!analyzed.includes(f)) analyzed.push(f);
    analyzeBtn.disabled = false;
    renderResults(errors);
    renderOptions();
  }

  function startAll() {
    for (const info of analyzed) startJob(info);
    analyzed = [];
    links.value = '';
    results.replaceChildren();
    renderOptions();
  }

  function startJob(info: ProbeInfo) {
    const job: Job = { key: `j${jobs.length + 1}`, info, opts: { ...opts }, requestId: null, state: 'running', event: { type: 'stage', stage: 'Préparation' } };
    jobs.unshift(job);
    const req = engine.download({ url: info.url, ...job.opts }, (e) => {
      job.event = { ...job.event, ...e };
      renderJob(job);
    });
    job.requestId = req.id;
    req.promise
      .then((done) => {
        job.state = 'done';
        job.file = done.file;
        job.size = done.size;
        renderJob(job);
        toast(`Téléchargé : ${info.title.slice(0, 50)}`, 'success');
      })
      .catch((e) => {
        job.state = job.state === 'cancelled' ? 'cancelled' : 'error';
        job.event = { type: 'error', message: e instanceof Error ? e.message : String(e) };
        renderJob(job);
      });
    renderQueue();
  }

  function renderQueue() {
    queueCard.hidden = jobs.length === 0;
    queue.replaceChildren(...jobs.map((j) => (j.el ??= h('div', { class: 'job' }))));
    jobs.forEach(renderJob);
  }

  function renderJob(job: Job) {
    if (!job.el) return renderQueue();
    const e = job.event;
    const label = job.opts.mode === 'audio' ? job.opts.audio.toUpperCase() : job.opts.mode === 'image' ? 'Image' : `${job.opts.codec === 'prores' ? 'MOV' : job.opts.container.toUpperCase()} ${job.opts.quality ? qualityLabel(job.opts.quality) : 'max'}`;
    const actions: Node[] = [];
    if (job.state === 'running') {
      const stop = h('button', { type: 'button', class: 'icon-btn icon-btn--sm', title: 'Annuler' }, icon('stop', 13));
      stop.addEventListener('click', () => {
        job.state = 'cancelled';
        if (job.requestId) engine.cancel(job.requestId).catch(() => undefined);
      });
      actions.push(stop);
    } else if (job.state === 'done' && job.file) {
      const reveal = h('button', { type: 'button', class: 'icon-btn icon-btn--sm', title: 'Afficher dans le Finder' }, icon('folder', 13));
      reveal.addEventListener('click', () => engine.reveal(job.file!));
      const open = h('button', { type: 'button', class: 'icon-btn icon-btn--sm', title: 'Ouvrir' }, icon('play', 13));
      open.addEventListener('click', () => engine.open(job.file!));
      actions.push(reveal, open);
      if (job.opts.mode === 'image') {
        const conv = h('button', { type: 'button', class: 'icon-btn icon-btn--sm', title: 'Envoyer au convertisseur' }, icon('send', 13));
        conv.addEventListener('click', async () => {
          const bytes = await engine.readFile(job.file!);
          showModule('convert');
          await store.addFiles([{ blob: new Blob([bytes as BlobPart], { type: 'image/png' }), name: job.file!.split('/').pop()! }]);
        });
        actions.push(conv);
      }
    }
    const pct = job.state === 'done' ? 100 : e.percent ?? 0;
    const line =
      job.state === 'done'
        ? `Terminé · ${formatBytes(job.size ?? 0)}`
        : job.state === 'cancelled'
          ? 'Annulé'
          : job.state === 'error'
            ? e.message ?? 'Erreur'
            : [e.stage, e.percent !== undefined ? `${Math.round(e.percent)} %` : '', e.speed, e.eta && e.eta !== 'Unknown' ? `reste ${e.eta}` : ''].filter(Boolean).join(' · ');
    job.el.className = `job job--${job.state}`;
    job.el.replaceChildren(
      h(
        'div',
        { class: 'job__top' },
        h('span', { class: 'job__title', title: job.info.title }, job.info.title),
        h('span', { class: 'pill pill--sm pill--neutral' }, label),
        h('div', { class: 'job__actions' }, ...actions),
      ),
      h('div', { class: 'job__bar' }, h('div', { style: `width:${pct}%` })),
      h('div', { class: 'job__line' }, line),
    );
  }

  async function refreshStatus() {
    status = await engineStatus();
    renderStatus();
  }

  onModuleChange((m) => {
    if (m === 'media' && !status) refreshStatus();
  });
  if (currentModule() === 'media') await refreshStatus();
  else renderStatus();
  renderOptions();
  renderQueue();
}
