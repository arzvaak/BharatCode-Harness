# 上游 seam 扩展跟踪

[English](README.md) | 中文

本目录跟踪插件为官方 `ctx.lsp` seam 添加操作（`diagnostics` / `formatDocument` / `completion`）的提案。

## 状态

| 日期 | 事件 |
| --- | --- |
| 2026-08-14 | 提案已提交至上游 [Discussion #781](https://github.com/deepseek-ai/deepseek-harness/discussions/781)（当时上游禁用 issue/PR）；fork 分支 `PerryLink/deepseek-harness:agent/lsp-action-seam`，所有门禁通过。 |
| 2026-08-15 | 针对当日可用 harness 树运行 `git apply --check upstream/lsp-action-seam.patch` 顺利通过：**34 个文件，+1201/−201**。patch 仍可回放；只需在上游启用 Pull Request 后开 PR 前，纳入 Discussion 链接及上游审查反馈。 |
| 2026-08-15 | 插件优先使用 seam 的路径现在按调用延迟解析 `ctx.lsp`（`src/runner.ts`、`src/index.ts`），因此无论 seam 在插件之前还是之后加载都能工作；不再有可能变陈旧的应用时快照。 |
| 2026-09-18 | **截至 `dsh-v0.1.6-alpha.2` 尚未合并**：发布的 seam 仍声明 `LspOperation = 'goToDefinition' \| 'findReferences' \| 'goToImplementation' \| 'hover'`，文档说明「恰好四种操作」，因此仍需插件自身客户端。针对该树回放 patch 现在**失败**（21 个区块，见下文）；提案需要 rebase 后才能重新提交。 |

### 当前 patch 差异（2026-09-18，基线 `dsh-v0.1.6-alpha.2`）

`git apply --check upstream/lsp-action-seam.patch` 在以下 21 个文件上失败；seam 代码本身未受影响（操作词汇仍为四种），差异来自文档/README/i18n 框架及 LSP stdio 翻译/测试文件：

```
docs/capability-seams.md:463          packages/lsp/lsp-stdio/README.zh.md:28
docs/subsystems/README.md:34          packages/lsp/lsp-stdio/src/translate.ts:1
docs/subsystems/lsp.i18n.yaml:2       packages/lsp/lsp-stdio/tests/instance.spec.ts:10
docs/subsystems/lsp.md:1              packages/lsp/lsp/README.i18n.yaml:2
docs/subsystems/lsp.zh.md:1           packages/lsp/lsp/README.md:2
packages/extensions/tool-cordis/src/api-catalog.ts:3317
packages/lsp/README.i18n.yaml:2       packages/lsp/lsp/README.zh.md:2
packages/lsp/README.md:10             packages/lsp/tool-lsp/README.i18n.yaml:2
packages/lsp/README.zh.md:10          packages/lsp/tool-lsp/README.md:10
packages/lsp/lsp-stdio/README.i18n.yaml:2   packages/lsp/tool-lsp/README.zh.md:10
packages/lsp/lsp-stdio/README.md:28   scripts/gen-doc-graphs.ts:537
```

插件的 seam 版本门禁（`scripts/seam-vintage-check.mjs`，接入 `verify:artifacts`）在发布的联合类型增加操作时立即使构建失败，因此此表不会悄然变陈旧：要么门禁失败（上游已接纳操作词汇，应移除自建客户端），要么在下一次提交前 rebase 上述差异。

## 重新验证步骤

```sh
cd <deepseek-harness checkout>
git apply --check <plugin>/upstream/lsp-action-seam.patch   # must exit 0 against the target tree
```

若 harness 产生差异导致检查失败，从 fork 分支针对新基线重新生成 patch（fork 保留提案提交），更新此表并提高此处验证日期。

## seam 合并后的迁移路径

1. 执行器的 `trySeamAction` 分类已处理合并后的操作词汇：成功则走 seam；`LSP_UNSUPPORTED_OPERATION` 明确失败；无代码错误（合并前的 seam）和 `LSP_UNAVAILABLE` 回退到内置客户端。
2. 保留内置客户端作为 `servers` 表的独立回退方案（seam 是可选能力；没有 `ctx.lsp` 的组合仍可工作）。
3. 稳定一段时间后，插件可用 `@deepseek-ai/dsh-lsp-stdio` 宿主替代 `src/framing.ts` / `src/connection.ts` / `src/client.ts` 内部实现；内置客户端与其对应，因此替换仅涉及 `client.ts` 和 `connection.ts`。
4. 新扩展操作（`codeAction`、`workspaceSymbol`、`documentSymbol`、`signatureHelp`、`inlayHint`、`rename`）目前使用内置客户端；首次扩展合并后，提出第二次上游操作词汇扩展。seam 查询已按结构转发操作特定附加字段（`query`、`onlyKinds`、`newName`），因此第二次提案只需扩展 seam 联合类型。

## 文件

- `lsp-action-seam.patch`：完整提案 patch（可针对当前树回放）。
- `PR-description.md`：上游启用 PR 时可使用的 Pull Request 描述。
