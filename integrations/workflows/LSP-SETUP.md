# TypeScript and JavaScript LSP setup

The LSP Actions fork uses a local language server for diagnostics, formatting, completion, symbols, code actions, signature help, inlay hints, and rename. The workflow integration includes pinned TypeScript 5.9.3 and typescript-language-server 5.3.0 in `language-tools/package-lock.json`.

From the repository root, install the tools and generate a profile override:

```sh
npm ci --ignore-scripts --prefix integrations/workflows/language-tools
node integrations/workflows/configure-lsp.mjs /absolute/path/to/lsp-workspace.patch.yml
```

The helper validates both local executables and emits JSON, which is valid YAML. It refuses to overwrite an existing file. Review the generated paths and add this file as the final profile patch after the LSP Actions bundle. Existing profile settings are never changed by the helper. The checked-in `lsp-workspace.patch.yml` is ready for this checkout; regenerate it after moving the checkout or changing the Node executable.

The override selects TS, TSX, JS, JSX, MJS, CJS, MTS, and CTS files and resolves project roots using `tsconfig.json`, `jsconfig.json`, or `package.json`. Configure normal project compiler options in these project files. JavaScript semantic diagnostics require `checkJs: true` in `jsconfig.json` or an `// @ts-check` file comment. Without these, JavaScript language features still work, but type checking follows TypeScript's normal defaults.

Restart the profile after applying the override. In a session whose workspace contains the project, call `lsp_diagnostics` with a workspace-relative `file_path`. Then use `lsp_format`, `lsp_completion`, or the other canonical LSP Actions tools. The editor backend remains disabled because a normal web or CLI profile owns stdio; use the plugin's separate headless editor instructions when configuring an IDE backend.

The server process runs locally and reads project files through the existing host subprocess and filesystem services. It does not download language tools on first use. The tool installation is shared by projects using this profile; compiler configuration comes from each workspace. This override uses the pinned TypeScript version explicitly; configure another server entry when a project requires a different TypeScript version.

Verify the generated override with `node integrations/workflows/verify-lsp-setup.mjs`. It starts the real server in a temporary directory, checks both TS and JS type-error diagnostics and formatting, then shuts down and removes the fixture. The upstream real-server editor protocol suite also runs with `LSP_ACTIONS_TSLS` pointing to this local CLI.
