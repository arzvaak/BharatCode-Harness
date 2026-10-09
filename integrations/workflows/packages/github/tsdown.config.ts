import { defineConfig } from 'tsdown'
export default defineConfig({
 entry: { client: 'src/client.ts' }, outDir: 'lib', format: 'cjs', platform: 'browser',
 dts: false, clean: false, sourcemap: true,
 external: ['react', '@deepseek-ai/dsh-client-ui-primitives'],
 outputOptions: {
  entryFileNames: 'client.js',
  banner: 'window.__ModuleLoader__.load({ id: "@perrylink/dsh-github", factory: (require) => {',
  footer: 'return module.exports; } });',
  intro: 'var module = { exports: {} }; var exports = module.exports;'
 }
})
