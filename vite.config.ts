import { defineConfig, type Plugin } from 'vite';
import { resolve } from 'node:path';
import { readFileSync, writeFileSync } from 'node:fs';

// En CI, ATELIER_BUILD (numéro de build GitHub) donne une version unique :
// 0.1.0 -> 0.1.<build>. C'est ce changement de version qui déclenche la mise à jour.
function versionStamp(): Plugin {
  return {
    name: 'atelier-version',
    writeBundle(options) {
      const build = process.env.ATELIER_BUILD;
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
export default defineConfig({
  plugins: [versionStamp()],
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
