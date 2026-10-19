import { context } from 'esbuild';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { bootstrap } from './browser.js';
const directory = dirname(fileURLToPath(new URL('../package.json', import.meta.url)));
const allowed = /^(three(?:\/|$)|react(?:\/|$)|react-dom(?:\/|$)|@react-three\/(fiber|drei|rapier)(?:\/|$)|@babylonjs\/(core|loaders|serializers)(?:\/|$))/;
export async function compile(project, signal) {
  signal?.throwIfAborted();
  const build = await context({
    stdin: {contents: bootstrap(project.engine), resolveDir: directory, sourcefile: 'bc-bootstrap.js'},
    bundle: true, write: false, platform: 'browser', format: 'iife', target: 'es2022',
    jsx: 'automatic', minify: true, legalComments: 'eof', logLevel: 'silent',
    plugins: [{name: 'workspace-source', setup(builder) {
      builder.onResolve({filter: /^bc-project$/}, () => ({path: 'scene.tsx', namespace: 'bc-project'}));
      builder.onLoad({filter: /.*/, namespace: 'bc-project'}, () => ({contents: project.source, loader: 'tsx', resolveDir: directory}));
      builder.onResolve({filter: /.*/, namespace: 'bc-project'}, async args => {
        if (!allowed.test(args.path) || args.path.includes('\\') || args.path.split('/').some(part=>part==='.'||part==='..')) return {errors: [{text: `Unsupported import: ${args.path}. Use bundled Three.js, React, Drei, Rapier or Babylon.js packages.`}]};
        return builder.resolve(args.path, {resolveDir: directory, kind: args.kind});
      });
    }}],
  });
  const cancel = () => { void build.cancel(); };
  const timeout = setTimeout(cancel, 30000);
  signal?.addEventListener('abort', cancel, {once: true});
  try {
    signal?.throwIfAborted();
    const result = await build.rebuild();
    signal?.throwIfAborted();
    const bytes = result.outputFiles[0].contents;
    if (bytes.length > 32 * 1024 * 1024) throw Error('Compiled scene exceeds 32 MiB');
    return Buffer.from(bytes);
  } finally {
    clearTimeout(timeout); signal?.removeEventListener('abort', cancel); await build.dispose();
  }
}
