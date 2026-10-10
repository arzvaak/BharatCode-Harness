# dsh-tool-call-guard

[English](README.md) | 中文

在工具调用进入协议传输前，中和 JSON **arguments** 无效的调用，避免一次格式错误的模型生成使整个会话无法继续。

[![许可证：MIT](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)
[![dsh-plugin](https://img.shields.io/badge/DSH-plugin-5b50ed.svg)](https://github.com/deepseek-ai/deepseek-harness)
[![npm](https://img.shields.io/npm/v/dsh-tool-call-guard.svg)](https://www.npmjs.com/package/dsh-tool-call-guard)
[![测试](https://img.shields.io/badge/tests-9%20passed-brightgreen.svg)](#tests)

```sh
dsh plugin add dsh-tool-call-guard
```

## 原因

某些模型偶尔生成 `arguments` 字符串不是有效 JSON 的工具调用，最常见的原因是内部引号未转义：

```json
{"queries": [""The Idiots" trailer youtube official"]}
```

严格的 OpenAI 兼容服务器（vLLM 等）**对此采用不对称处理**：

- **流式生成路径**——宽松。格式错误的调用可通过流式输出，harness 将其持久化到仅追加会话日志，轮次看起来成功。
- **历史回放路径**——严格。下一次请求回放有问题的工具调用，服务器校验后拒绝**整个请求**：

```
400 {"message": "Assistant tool call function.arguments must be valid JSON.",
     "type": "BadRequestError"}
```

从此，**会话中每次后续请求都会失败**。除非手动精确修复日志，会话无法继续。同类失败存在于多个生态（[openai-agents-python #2061](https://github.com/openai/openai-agents-python/issues/2061)、[vLLM #41122](https://github.com/vllm-project/vllm/issues/41122)）。

## 功能

拦截 harness 的 `llm/stream` waterfall（瀑布式事件）。对于 `arguments` 无法通过 `JSON.parse` 的每个 assistant 工具调用块：

1. **调用变为如实的文本记录**（仅限协议传输）——模型看到自身生成的确切内容，可以重新发出修正后的调用：
   ```
   [A tool call to 'web_search' was removed from history because its arguments
   were malformed JSON. Original arguments as emitted: {"queries": [""The Idiots" …]}]
   ```
2. **匹配的工具结果重新表示为普通用户消息**——保留结果内容，维持对话协议平衡（没有悬空 `tool_calls` 条目或无对应调用的 `role:"tool"` 回复；严格服务器上这两者本身也会触发 400）：
   ```
   [Tool Result: web_search] 10 results about The Idiots
   ```

将无对应调用的结果表示为用户消息的方式遵循上游序列化器讨论（[deepseek-harness #4668](https://github.com/deepseek-ai/deepseek-harness/discussions/4668)）。

### 特性

- **干净历史无需额外处理**——每个工具调用块执行一次 `JSON.parse`；没有问题时，消息数组保持对象身份直接传递。
- **遵守仅追加日志约定**——harness 的持久化会话日志绝不重写；仅在每次请求的协议投影中执行中和。
- **提供方无关**——位于 `llm/stream`，因此覆盖每种适配器（deepseek、社区及自定义）。
- **故障时放行**——防护自身出错时，原始请求原样传递。
- **零配置**——安装并重启即可。

## 安装

```sh
dsh plugin --profile web add dsh-tool-call-guard
# or desktop:
dsh plugin --profile desktop add dsh-tool-call-guard
```

也可以从 GitHub 安装：`dsh plugin add github:alchemistwu/dsh-tool-call-guard`。

包声明了 `dsh.bundle` patch，因此安装时插件自行注册。重启 `dsh web` / DSH Desktop 宿主，再开始新会话。

## 生产环境观察

首次观察发生于 vLLM 0.27（`--enable-auto-tool-choice`）提供的 `zai-org/GLM-5.3-Flash`：一次 `web_search` 调用中电影标题周围的引号未转义，却成功流式输出并持久化，此后每个轮次均出现 `400 … arguments must be valid JSON`，使会话永久受损。本插件让该会话继续运行：每次请求重新表示有问题的条目，会话继续工作，模型在上下文中看到自身错误。

<a id="tests"></a>
## 测试

```sh
npm test
```

九项测试覆盖实际生产错误、混合有效/无效工具调用、协议平衡不变式（协议传输中无无效 `tool_calls` 或无对应调用的 `role:"tool"`）、退化输入及逐请求状态重置。

## 许可证

MIT

## BharatCode 集成

监听器在同级 LLM（大语言模型）插件作用域间全局生效。它仅更改出站投影，保留规范消息、有效调用和混合结果块。卸载会移除拦截器。原生 Loader/LLM fixture（测试前置数据）检查这些特性。本插件修复历史格式错误的 JSON；它不授予工具权限。
