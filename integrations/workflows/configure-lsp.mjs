#!/usr/bin/env node
/** Produce an id-targeted LSP override; never edit a user's profile implicitly. */
import { existsSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const cli = fileURLToPath(new URL('./language-tools/node_modules/typescript-language-server/lib/cli.mjs', import.meta.url));
const tsserver = fileURLToPath(new URL('./language-tools/node_modules/typescript/lib/tsserver.js', import.meta.url));
if (!existsSync(cli) || !existsSync(tsserver)) {
  console.error('Language tools are missing. Run npm ci --ignore-scripts --prefix integrations/workflows/language-tools from the repository root.');
  process.exit(1);
}
const args = process.argv.slice(2);
if (args.length > 1 || args.some(arg => arg.startsWith('-'))) {
  console.error('Usage: node integrations/workflows/configure-lsp.mjs [output.patch.yml]');
  process.exit(1);
}
const patch = [{
  id: 'lsp-actions',
  config: {
    servers: {
      typescript: {
        command: process.execPath,
        args: [cli, '--stdio'],
        extensionToLanguage: {
          '.ts': 'typescript', '.tsx': 'typescriptreact',
          '.js': 'javascript', '.jsx': 'javascriptreact',
          '.mjs': 'javascript', '.cjs': 'javascript',
          '.mts': 'typescript', '.cts': 'typescript',
        },
        projectMarkers: ['tsconfig.json', 'jsconfig.json', 'package.json'],
        initializationOptions: { tsserver: { path: tsserver } },
        formattingOptions: { tabSize: 2, insertSpaces: true },
      },
    },
    editor: { enabled: false, requestTimeoutMs: 60000, diagnosticsCacheMaxFiles: 64 },
    maxDiagnostics: 200, maxCompletionItems: 20, maxCodeActions: 50,
    maxSymbols: 100, maxSignatures: 10, maxInlayHints: 200,
    maxResultChars: 16000, timeoutMs: 60000,
  },
}];
// JSON is valid YAML, and safely quotes executable paths on every platform.
const text = JSON.stringify(patch, null, 2) + '\n';
if (args[0]) {
  const output = resolve(args[0]);
  if (existsSync(output)) {
    console.error(`Output already exists: ${output}. Choose a new path to preserve your settings.`);
    process.exit(1);
  }
  writeFileSync(output, text, { flag: 'wx' });
  console.log(output);
} else process.stdout.write(text);
