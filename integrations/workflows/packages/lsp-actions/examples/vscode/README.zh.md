# dsh-lsp-actions VS Code 示例

[English](README.md) | 中文

一个最小 VS Code 扩展，通过 ACP（Agent Client Protocol）风格的 JSON-RPC 使用 [`dsh-lsp-actions`](../../) 的**编辑器操作协议**（`lsp.actions.list` / `lsp.actions.run` / `lsp.events`）。扩展**仅负责 UI**：不实现 LSP 逻辑、不计算诊断、不编辑缓冲区；每项能力及每个写入字节都属于插件后端。

```
┌──────────────────┐  stdio JSON-RPC (newline-delimited)   ┌───────────────────────────────┐
│  VS Code         │  lsp.actions.list / lsp.actions.run   │  editor backend (headless DSH)│
│  extension (UI)  │ ────────────────────────────────────► │  dsh-lsp-actions              │
│  sidebar + cmds  │  ◄──────────────────────────────────── │  (editor.enabled: true)       │
│                  │  lsp.event (diagnostics, status, …)   │  fs-local · subprocess-local   │
└──────────────────┘                                       │  LSP servers (tsls, …)        │
                                                           └───────────────────────────────┘
```

## 侧栏显示内容

- **DSH Sessions**：后端运行时中的会话（执行可通过 `sessionId` 绑定其权限预设）。
- **LSP Diagnostics**：后端推送的逐文件诊断（`diagnostics.updated` 事件），可按需刷新。每个诊断行：
  - 点击 → 在范围位置打开文件（`openDiagnostic`，纯 VS Code UI）；
  - **Apply quickfix** 按钮 → 后端为该范围选择服务器偏好的代码操作，并通过官方写入策略应用（`quickfix.apply`）。扩展不触碰缓冲区。
- **DSH: Format the active document** → 通过后端执行 `format`（整个文件，编辑经服务器验证）。

## 安装与运行

### 1. 安装后端

```sh
cd examples/vscode/backend
npm install
# make sure a language server is on PATH, e.g.:
npm install -g typescript-language-server typescript
```

### 2. 启动扩展

```sh
cd examples/vscode/extension
code --new-window path/to/your/typescript/project .
```

- 在 VS Code 中：选择 **Run and Debug → Run Extension**（`F5`），或在 `npx @vscode/vsce package` 后选择 `Extensions: Install from VSIX…`。
- 打开 **DSH LSP Actions** 活动栏容器（服务器进程图标）。

### 3. 使用

1. **DSH: Connect to the editor backend**（命令面板）：启动 `node backend/bin.mjs backend/cordis.yml` 并读取 `lsp.actions.list`。
2. 打开一个有错误的 `.ts` 文件，再按 LSP Diagnostics 视图中的 **↻ refresh** 按钮。
3. 展开诊断并点击 **Apply quickfix**：后端应用服务器修复并推送 `file.changed`；刷新后错误消失。
4. 运行 **DSH: Format the active document**：后端通过 `typescript-language-server` 重写缩进。

## 设置

| 设置 | 默认值 | 含义 |
| --- | --- | --- |
| `dshLspActions.backend.node` | `node` | 后端的 Node 可执行文件。 |
| `dshLspActions.backend.bin` |（随附路径）| `backend/bin.mjs` 的绝对路径。 |
| `dshLspActions.backend.config` |（随附路径）| `backend/cordis.yml` 的绝对路径。 |

## 录制演示 gif

README 随附的演示 gif 在干净 profile 中按以下流程录制：

1. 在 `examples/vscode/backend` 新运行 `npm install`；新建 TypeScript 项目，包含一个有问题的文件（例如未声明变量及四空格缩进）。
2. 连接 → 刷新诊断（显示错误）→ 应用 quickfix（完成修复）→ 格式化文档（重写缩进）。
3. 使用你喜欢的 gif 工具录制（例如 Linux 的 `peek`、Windows 的 ScreenToGif、macOS 的 Kap），保存为 `docs/editor-demo.gif`；主 README 引用它。

## 边界（请阅读）

- **仅负责 UI。** 所有 LSP 请求、quickfix 选择、编辑计算和文件写入都在后端完成。扩展发送 `lsp.actions.run` 并渲染结构化结果/事件。
- **官方写入策略。** `quickfix.apply` 和 `format` 使用后端插件的 `fs/write-intent` waterfall（瀑布式事件）及会话官方权限预设。在此无沙箱示例组合中它们直接写入；组合 `@deepseek-ai/dsh-fs-sandbox` + `@deepseek-ai/dsh-sandbox-policy` + `@deepseek-ai/dsh-user-approval` 可强制执行预设（只读会话会以 `LSP_ACTION_READ_ONLY` 拒绝写入，升权通过官方审批路径询问）。
- **唯一 stdio 所有者。** 后端 stdout 只承载协议帧；绝不向 `backend/cordis.yml` 添加 stdout 日志器。
- **协议稳定性。** 协议为 `lsp-actions/v1`（参见 [`docs/editor-protocol.md`](../../docs/editor-protocol.md)）；客户端必须忽略未知字段和事件种类。
