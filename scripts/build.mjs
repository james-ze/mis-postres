// Arma la carpeta dist/ que se publica. Uso: node scripts/build.mjs
import { build } from 'esbuild';
import { cpSync, mkdirSync, readFileSync, writeFileSync, rmSync, readdirSync } from 'node:fs';

const version = (process.env.GITHUB_SHA || Date.now().toString(36)).slice(0, 10);
rmSync('dist', { recursive: true, force: true });
mkdirSync('dist');
await build({ entryPoints: ['src/app.js'], bundle: true, minify: true, format: 'esm', target: 'es2019', outfile: 'dist/app.js', legalComments: 'none' });
cpSync('src/estilos.css', 'dist/estilos.css');
for (const f of readdirSync('public')) cpSync('public/' + f, 'dist/' + f);
for (const f of ['index.html', 'sw.js']) {
  const origen = f === 'index.html' ? 'index.html' : 'dist/' + f;
  writeFileSync('dist/' + f, readFileSync(origen, 'utf8').replaceAll('__VERSION__', version));
}
console.log('Listo: dist/ (versión ' + version + ')');
