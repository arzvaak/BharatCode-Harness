import {createRequire} from 'node:module';import {dirname,join} from 'node:path';
import { build } from 'esbuild';
import { mkdir, copyFile } from 'node:fs/promises';
await mkdir('lib', { recursive: true });
await build({
  entryPoints: ['src/client.jsx'],
  outfile: 'lib/client.js',
  bundle: true,
  platform: 'browser',
  format: 'cjs',
  target: 'es2022',
  jsx: 'automatic',
  external: ['react', 'react/jsx-runtime'],
  legalComments: 'eof',
  banner: {
    js: 'window.__ModuleLoader__.load({id:"@bharatcode/extension-store",factory(require){const module={exports:{}};const exports=module.exports;',
  },
  footer: { js: 'return module.exports;}});' },
});

const require=createRequire(import.meta.url);await mkdir('lib/licenses',{recursive:true});await copyFile(join(dirname(require.resolve('semver/package.json')),'LICENSE'),'lib/licenses/semver-LICENSE');
