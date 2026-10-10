import { build } from 'esbuild';
import { readFile, mkdir, readdir, writeFile, copyFile, rm } from 'node:fs/promises';
import { dirname, resolve, join } from 'node:path';
const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
await mkdir(new URL('../lib', import.meta.url), { recursive: true });
const results = [];
for (const [entry, file, chunk] of [['src/client.js', 'client.js', undefined], ['src/engine.js', 'client.mermaid.js', 'client.mermaid.js']]) {
const result = await build({ entryPoints: [entry], outfile: 'lib/' + file, bundle: true, format: 'cjs', platform: 'browser', target: 'es2022', external: ['react'], sourcemap: false, minify: true, legalComments: 'linked', metafile: true,
  banner: { js: `window.__ModuleLoader__.load({id:${JSON.stringify(pkg.name)},${chunk ? `chunk:${JSON.stringify(chunk)},` : ''}factory(require){const module={exports:{}};const exports=module.exports;` },
  footer: { js: 'return module.exports;}});' },
  plugins: [{ name: 'inline-css', setup(b) { b.onLoad({ filter: /\.css$/ }, async ({ path }) => ({ contents: `export default ${JSON.stringify(await readFile(path, 'utf8'))}`, loader: 'js' })); } }],
});
if (!result.metafile.outputs['lib/' + file]?.bytes) throw Error('Missing bundled client module');
if (!(await readFile('lib/' + file, 'utf8')).includes('For license information please see ' + file + '.LEGAL.txt'))
  await rm('lib/' + file + '.LEGAL.txt', { force: true });
results.push(result);
console.log(`Built local Harness client module: ${file}`);
}

// Preserve notices for every third-party package included in the prebuilt factory.
const packages = new Map();
for (const input of results.flatMap(result => Object.keys(result.metafile.inputs)).filter(p => p.includes('node_modules/'))) {
  let dir = dirname(resolve(input));
  while (dir !== dirname(dir)) {
    try {
      const metadata = JSON.parse(await readFile(join(dir, 'package.json'), 'utf8'));
      if (metadata.name && metadata.version) { packages.set(metadata.name, { dir, metadata }); break; }
    } catch {}
    dir = dirname(dir);
  }
}
await mkdir('lib/licenses', { recursive: true });
const index = [];
for (const [name, { dir, metadata }] of [...packages].sort(([a], [b]) => a.localeCompare(b))) {
  const id = name.replace(/[^a-zA-Z0-9._-]/g, '_');
  const files = (await readdir(dir)).filter(file => /^(?:license|licence|copying|notice)(?:[._-]|$)/i.test(file));
  for (const file of files) {
    try { await copyFile(join(dir, file), join('lib/licenses', id + '-' + file)); } catch {}
  }
  index.push(`${name}@${metadata.version} — ${metadata.license || 'See package license'} — ${files.join(', ') || 'See source package'}`);
}
await writeFile('lib/licenses/INDEX.txt', index.join('\n') + '\n');
await mkdir('artifacts', { recursive: true });
await writeFile('artifacts/build-meta.json', JSON.stringify(results.map(result => result.metafile)));
