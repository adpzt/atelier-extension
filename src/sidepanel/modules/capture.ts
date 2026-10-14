// Captures que macOS ne sait pas faire : page web entière, image vidéo en résolution native.

/** Hauteur maximale d'une capture (limite des canvas du navigateur). */
const MAX_PX = 30000;
/** Hauteur d'une bande capturée d'un coup. */
const BAND_PX = 8000;

/**
 * Page entière via le protocole de débogage de Chrome (rendu exact, en-têtes fixes inclus une seule fois).
 * Chrome affiche un bandeau « … a commencé à déboguer ce navigateur » pendant la capture.
 */
export async function captureFullPage(tabId: number, scale = 2, onProgress?: (msg: string) => void): Promise<{ blob: Blob; width: number; height: number; truncated: boolean }> {
  const target = { tabId };
  await chrome.debugger.attach(target, '1.3');
  const send = async <T>(method: string, params?: object): Promise<T> => (await chrome.debugger.sendCommand(target, method, params as { [key: string]: unknown })) as T;
  try {
    onProgress?.('Chargement des images de la page…');
    // Défilement progressif : déclenche les images chargées « au scroll ».
    await send('Runtime.evaluate', {
      awaitPromise: true,
      expression: `(async () => {
        const start = scrollY;
        const step = innerHeight * 0.8;
        for (let y = 0; y < document.documentElement.scrollHeight && y < ${MAX_PX}; y += step) {
          scrollTo(0, y);
          await new Promise((r) => setTimeout(r, 120));
        }
        scrollTo(0, 0);
        await new Promise((r) => setTimeout(r, 400));
        return start;
      })()`,
    });
    const metrics = await send<{ cssContentSize: { width: number; height: number }; cssLayoutViewport: { clientWidth: number } }>('Page.getLayoutMetrics');
    const width = Math.ceil(metrics.cssLayoutViewport.clientWidth);
    const fullHeight = Math.ceil(metrics.cssContentSize.height);
    let s = scale;
    if (fullHeight * s > MAX_PX) s = Math.max(1, MAX_PX / fullHeight);
    const height = Math.min(fullHeight, Math.floor(MAX_PX / s));
    const canvas = new OffscreenCanvas(Math.round(width * s), Math.round(height * s));
    const ctx = canvas.getContext('2d')!;
    const band = Math.floor(BAND_PX / s);
    for (let y = 0; y < height; y += band) {
      onProgress?.(`Capture ${Math.min(100, Math.round((y / height) * 100))} %…`);
      const bh = Math.min(band, height - y);
      const shot = await send<{ data: string }>('Page.captureScreenshot', {
        format: 'png',
        captureBeyondViewport: true,
        fromSurface: true,
        clip: { x: 0, y, width, height: bh, scale: s },
      });
      const bytes = Uint8Array.from(atob(shot.data), (c) => c.charCodeAt(0));
      const bmp = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
      ctx.drawImage(bmp, 0, Math.round(y * s));
      bmp.close();
    }
    onProgress?.('Assemblage…');
    const blob = await canvas.convertToBlob({ type: 'image/png' });
    return { blob, width: canvas.width, height: canvas.height, truncated: height < fullHeight };
  } finally {
    await chrome.debugger.detach(target).catch(() => undefined);
  }
}

export interface FrameResult {
  dataUrl?: string;
  width?: number;
  height?: number;
  time?: number;
  error?: 'none' | 'tainted';
  area?: number;
}

/** Injecté dans la page : image de la vidéo principale à sa résolution native. */
function grabFrameInPage(): FrameResult {
  const videos = Array.from(document.querySelectorAll('video')).filter((v) => v.videoWidth > 0);
  if (!videos.length) return { error: 'none' };
  const score = (v: HTMLVideoElement) => {
    const r = v.getBoundingClientRect();
    return (v.paused ? 0 : 1e9) + r.width * r.height;
  };
  const v = videos.sort((a, b) => score(b) - score(a))[0];
  const r = v.getBoundingClientRect();
  try {
    const c = document.createElement('canvas');
    c.width = v.videoWidth;
    c.height = v.videoHeight;
    c.getContext('2d')!.drawImage(v, 0, 0);
    return { dataUrl: c.toDataURL('image/png'), width: c.width, height: c.height, time: v.currentTime, area: r.width * r.height };
  } catch {
    // Vidéo servie par un autre domaine sans autorisation : le navigateur interdit la lecture des pixels.
    return { error: 'tainted', time: v.currentTime, area: r.width * r.height };
  }
}

/** Cherche la vidéo dans la page et ses cadres (lecteurs intégrés). */
export async function captureVideoFrame(tabId: number): Promise<FrameResult> {
  const results = await chrome.scripting.executeScript({ target: { tabId, allFrames: true }, func: grabFrameInPage });
  const found = results.map((r) => r.result as FrameResult | undefined).filter((r): r is FrameResult => !!r && r.error !== 'none');
  if (!found.length) return { error: 'none' };
  return found.sort((a, b) => (b.area ?? 0) - (a.area ?? 0))[0];
}

export async function dataUrlToBlob(dataUrl: string): Promise<Blob> {
  return (await fetch(dataUrl)).blob();
}
