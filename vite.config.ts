import { defineConfig, type Plugin } from 'vite';
import { resolve } from 'node:path';
import { cpSync, readFileSync, writeFileSync } from 'node:fs';

// En CI, KOTAK_BUILD (numéro de build GitHub) donne une version unique :
// 0.1.0 -> 0.1.<build>. C'est ce changement de version qui déclenche la mise à jour.
function versionStamp(): Plugin {
  return {
    name: 'kotak-version',
    writeBundle(options) {
      const build = process.env.KOTAK_BUILD;
      if (!build || !options.dir) return;
      const pkg = JSON.parse(readFileSync(resolve(import.meta.dirname, 'package.json'), 'utf8'));
      const [major, minor] = String(pkg.version).split('.');
      const file = resolve(options.dir, 'manifest.json');
      const manifest = JSON.parse(readFileSync(file, 'utf8'));
      manifest.version = `${major}.${minor}.${build}`;
      writeFileSync(file, JSON.stringify(manifest, null, 2));
    },
  };
}

// L'extension est construite comme une app Vite multi-entrées :
// - le panneau latéral (HTML)
// - le service worker (background.js, nom fixe référencé par le manifeste)
// pdf.js a besoin de son worker, de ses polices/cmaps et de ses modules WASM à côté de l'extension.
function copyPdfjsAssets(): Plugin {
  return {
    name: 'kotak-pdfjs-assets',
    writeBundle(options) {
      if (!options.dir) return;
      const from = resolve(import.meta.dirname, 'node_modules/pdfjs-dist');
      const to = resolve(options.dir, 'pdfjs');
      const skip = (src: string) => !/(\/|^)\._|quickjs|\.map$/.test(src);
      cpSync(resolve(from, 'build/pdf.worker.min.mjs'), resolve(to, 'pdf.worker.min.mjs'));
      for (const dir of ['cmaps', 'standard_fonts', 'wasm']) {
        cpSync(resolve(from, dir), resolve(to, dir), { recursive: true, filter: skip });
      }
    },
  };
}

export default defineConfig({
  plugins: [versionStamp(), copyPdfjsAssets()],
  root: resolve(import.meta.dirname, 'src'),
  publicDir: resolve(import.meta.dirname, 'public'),
  build: {
    outDir: resolve(import.meta.dirname, 'dist'),
    emptyOutDir: true,
    target: 'chrome116',
    sourcemap: false,
    rollupOptions: {
      input: {
        sidepanel: resolve(import.meta.dirname, 'src/sidepanel/index.html'),
        offscreen: resolve(import.meta.dirname, 'src/offscreen/index.html'),
        background: resolve(import.meta.dirname, 'src/background.ts'),
      },
      output: {
        entryFileNames: (chunk) =>
          chunk.name === 'background' ? 'background.js' : 'assets/[name]-[hash].js',
      },
    },
  },
  worker: {
    format: 'es',
  },
});
