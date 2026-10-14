// Fonction injectée dans la page analysée (chrome.scripting.executeScript).
// Elle doit être autonome : aucune variable extérieure, aucun import.

export interface Found {
  url: string;
  kind: 'img' | 'bg' | 'svg' | 'poster' | 'icon' | 'meta';
  w: number;
  h: number;
  alt: string;
  /** Code source pour les SVG intégrés à la page. */
  svg?: string;
}

export async function collectImages(): Promise<Found[]> {
  const out = new Map<string, Found>();
  const abs = (u: string) => {
    try {
      return new URL(u, document.baseURI).href;
    } catch {
      return '';
    }
  };
  const add = (raw: string, f: Omit<Found, 'url'>) => {
    const url = raw.startsWith('data:') || raw.startsWith('blob:') ? raw : abs(raw);
    if (!url || url === location.href) return;
    const prev = out.get(url);
    if (!prev || f.w * f.h > prev.w * prev.h) out.set(url, { url, ...f, alt: f.alt || prev?.alt || '' });
  };
  /** Plus grande image d'un srcset (« 800w » ou « 2x »). */
  const bestOf = (srcset: string): string => {
    let best = '';
    let bestScore = -1;
    for (const part of srcset.split(/,\s+(?=\S)/)) {
      const [u, d] = part.trim().split(/\s+/);
      if (!u) continue;
      const score = d ? parseFloat(d) * (d.endsWith('w') ? 1 : 1000) : 1;
      if (score > bestScore) {
        bestScore = score;
        best = u;
      }
    }
    return best;
  };

  // <img> et <picture> : la plus haute résolution disponible.
  document.querySelectorAll('img').forEach((img) => {
    const candidates = [img.currentSrc || img.src];
    if (img.srcset) candidates.push(bestOf(img.srcset));
    const pic = img.closest('picture');
    pic?.querySelectorAll('source[srcset]').forEach((s) => candidates.push(bestOf(s.getAttribute('srcset') || '')));
    for (const lazy of ['data-src', 'data-lazy-src', 'data-original', 'data-srcset']) {
      const v = img.getAttribute(lazy);
      if (v) candidates.push(lazy.endsWith('srcset') ? bestOf(v) : v);
    }
    // On garde la dernière candidate « haute résolution » distincte, plus l'image affichée.
    const uniq = [...new Set(candidates.filter(Boolean))];
    const main = uniq.length > 1 ? uniq[uniq.length - 1] : uniq[0];
    if (main) add(main, { kind: 'img', w: img.naturalWidth, h: img.naturalHeight, alt: img.alt || '' });
  });

  // Images de fond CSS (y compris ::before / ::after).
  const urlRe = /url\(\s*(['"]?)(.*?)\1\s*\)/g;
  const all = Array.from(document.querySelectorAll('*')).slice(0, 6000);
  for (const el of all) {
    for (const pseudo of [null, '::before', '::after']) {
      const bg = getComputedStyle(el, pseudo).backgroundImage;
      if (!bg || bg === 'none' || !bg.includes('url(')) continue;
      for (const m of bg.matchAll(urlRe)) if (m[2]) add(m[2], { kind: 'bg', w: 0, h: 0, alt: '' });
    }
  }

  // SVG intégrés (logos, pictos) : on reconstitue un fichier autonome.
  let svgIndex = 0;
  document.querySelectorAll('svg').forEach((svg) => {
    if (svg.parentElement?.closest('svg')) return;
    const box = svg.getBoundingClientRect();
    if (box.width < 6 || box.height < 6) return;
    const clone = svg.cloneNode(true) as SVGSVGElement;
    clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    clone.setAttribute('xmlns:xlink', 'http://www.w3.org/1999/xlink');
    if (!clone.getAttribute('width')) clone.setAttribute('width', String(Math.round(box.width)));
    if (!clone.getAttribute('height')) clone.setAttribute('height', String(Math.round(box.height)));
    // currentColor -> couleur réelle du texte autour
    clone.setAttribute('color', getComputedStyle(svg).color);
    // <use href="#icone"> : on embarque les symboles référencés (sprites).
    const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
    clone.querySelectorAll('use').forEach((u) => {
      const ref = (u.getAttribute('href') || u.getAttribute('xlink:href') || '').trim();
      if (!ref.startsWith('#')) return;
      const target = document.getElementById(ref.slice(1));
      if (target && !clone.querySelector(ref)) defs.append(target.cloneNode(true));
    });
    if (defs.childNodes.length) clone.prepend(defs);
    const code = new XMLSerializer().serializeToString(clone);
    if (code.length > 2_000_000) return;
    svgIndex++;
    out.set(`svg:${svgIndex}:${code.length}`, {
      url: `svg-inline-${svgIndex}`,
      kind: 'svg',
      w: Math.round(box.width),
      h: Math.round(box.height),
      alt: svg.getAttribute('aria-label') || svg.querySelector('title')?.textContent || '',
      svg: code,
    });
  });

  // Affiches de vidéos, icônes du site, image de partage.
  document.querySelectorAll('video[poster]').forEach((v) => add(v.getAttribute('poster')!, { kind: 'poster', w: 0, h: 0, alt: '' }));
  document.querySelectorAll('link[rel~="icon"], link[rel="apple-touch-icon"], link[rel="mask-icon"]').forEach((l) => {
    const href = l.getAttribute('href');
    if (href) add(href, { kind: 'icon', w: 0, h: 0, alt: 'Icône du site' });
  });
  document.querySelectorAll('meta[property="og:image"], meta[name="twitter:image"]').forEach((m) => {
    const c = m.getAttribute('content');
    if (c) add(c, { kind: 'meta', w: 0, h: 0, alt: 'Image de partage' });
  });

  // Les URL blob: ne sont lisibles que depuis la page : on les convertit ici.
  const list = [...out.values()];
  await Promise.all(
    list.map(async (f) => {
      if (!f.url.startsWith('blob:')) return;
      try {
        const blob = await (await fetch(f.url)).blob();
        if (blob.size > 20_000_000) return;
        f.url = await new Promise<string>((res) => {
          const r = new FileReader();
          r.onload = () => res(String(r.result));
          r.readAsDataURL(blob);
        });
      } catch {
        /* illisible : on la laisse telle quelle */
      }
    }),
  );
  return list;
}
