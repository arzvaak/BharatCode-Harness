# DSH Zero

[English](README.md) | 中文

与模型无关的 DeepSeek Harness 插件，通过编码连续重复的工具输出来节省上下文。它保留独有诊断，并在更改面向模型的投影前通过 DSH 的 spill 存储保存完整原文。

插件使用 DSH 中已选择的模型和提供方。不添加推理端点、凭据、工具执行器或权限系统。

## 模式

- **Safe**（默认）：可逆文本压缩，支持恢复已保存原文。
- **Lean**：Safe 加上简短的补充指令，鼓励有针对性的读取和简洁工作。此模式下的模型任务质量需要单独评估。
- **Off**：原始工具投影。

**Estimated** 计数适用于任何模型，要求完整候选内容（包括恢复通知）至少减少 20%。估算使用文本长度，而非提供方 tokenizer。**Exact only** 在当前提供方/模型没有注册 tokenizer 时保持输出不变。通过 `ctx.dshZeroCounters.register(provider, model, countTokens)` 注册同步精确 tokenizer；它返回资源释放函数。tokenizer 必须计数完整字符串并返回非负整数。插件不提供猜测的 tokenizer 映射。

## 安装打包插件

需要 Node 24 和已针对 `0.2.0-rc.2`、发布标签 `dsh-v0.2.0-rc.2` 验证的 DeepSeek Harness 接口。原生 Cordis、Schemastery 和 Typert 协议对等依赖由运行中的 Harness 提供。其他版本未经验证。

构建和打包后，安装到目标 profile：

```sh
dsh plugin --profile <profile-name> add /absolute/path/arzvaak-dsh-zero-0.1.0.tgz
```

对于链接的开发 checkout，使用 `dsh plugin --profile <profile-name> add /absolute/path/dsh-zero`。包包含预构建的宿主及客户端入口和原生组合包 patch。完整设置页需要 web/desktop 设置、Remote 网关和 slot 服务。具有工具、spill 存储和原生文件系统服务的 headless profile 也支持压缩。缺少存储时保持原始输出不变。

打开 **Settings → DSH Zero** 选择模式/计数方式、检查计数器并分页查看已保存原文。在现有 desktop profile 中激活是单独步骤；本仓库验证使用一次性 profile。

## 恢复与测量

压缩文本包含执行环境可读取的原始路径以及 DSH 常规 `read` 指引。`read` 结果绕过压缩。设置查看器通过 DSH 现有 Remote 传输读取已注册的不透明 ID，每个窗口最多读取 65,536 UTF-8 字节。它拒绝错误会话 ID、伪造路径、已更改文件和过期文件。外围 DSH 网关提供认证；插件不创建 HTTP 端点。

计数器覆盖当前宿主/插件激活周期，分别记录字节、估算计数、精确计数、模型恢复开销和查看器读取。当恢复使用不同计数基础/tokenizer，或注册表淘汰导致无法可靠跟踪时，净投影减少量不可用。它们不测量计费、缓存或反复回放上下文产生的节省。查看器读取不进入模型上下文。模型通过原生文件读取访问已注册原始路径时计入恢复开销；其他访问原文的方式无法完全归因。

产物注册表默认保留最多 1,000 个条目（可配置为 10,000）。插件重新加载时重置元数据和计数器。已保存文件遵循 DSH spill 存储保留策略；底层文件存在期间，其原生路径仍可使用。

## 兼容性与限制

版本 0.1 压缩包含连续重复行/块的单个文本块。它保留行结束符、Unicode、顺序和末尾换行，验证编解码往返转换，并保留规范程序值和工具元数据。混合内容、嵌套 code-mode 结果、恢复读取、格式错误的 Unicode 和不受支持结果绕过压缩。默认可处理大小为 4 KiB–16 MiB。编码负载使用 `DSH-ZERO/1` 有序 `[repeatCount, literalText]` 记录；偏好读取原文的模型始终可以访问原生原文。

现有 spill 策略仍具权威性；已 spill 的输出绕过此编解码器。标准内联输出可能显示编码投影；请使用显式原文查看器。编解码可逆性证明数据保留，不代表每种模型都具有等效推理质量。

重复结果引用、保温请求、新等待/批处理工具及 CodexZero 功能对等不属于首次发布范围。

## 开发与验证

```sh
npm ci
npm test
npm run build
DSH_SOURCE=/absolute/path/to/built/deepseek-harness npm run test:composition
DSH_SOURCE=/absolute/path/to/built/deepseek-harness npm run test:loop
npm pack
DSH_SOURCE=/absolute/path/to/built/deepseek-harness npm run test:package
```

组合检查使用真实 Loader、Settings、工具、文件系统/spill 存储、严格 Typert 网关及原生客户端 Remote/slot 生命周期。循环检查通过本地 HTTP/SSE fixture（测试前置数据），以两个路由标识驱动真实 AgentLoop 和 pi-ai，覆盖 off/safe/lean 模式及持久化结果/请求相等性。

运行配对本地 fixture 基准测试：

```sh
DSH_SOURCE=/absolute/path/to/built/deepseek-harness npm run benchmark -- examples/fixture-benchmark.json artifacts/benchmark.json
```

manifest（元数据清单）必须明确指定 `fixture`、重复次数、路由、任务、成功标记及每个案例的调用/输出/时间预算。真实运行需设置 `fixture:false`，并为每个路由提供原生 pi-ai `profile`，包含 `api`、`baseURL`、`apiKeyEnv` 和含 `id`、`contextWindow`、`maxTokens` 的 `models`。凭据存放于环境变量；报告排除 profile。`fixtureWorkspace` 按案例复制；可选 `outputFile` 提供诊断内容，`success.files` 检查预期相对路径。每个案例注册相同 `fixture_output` 任务工具。此测试评估压缩特定的诊断/修复任务，而非通用编码基准。所有成功的原生 `read` 调用记录在基准的 `recoveryReads` 字段中；其中可能包括普通文件读取。

执行器运行 off/safe/lean 并使用相同检查，记录路由标识、成功情况、运行时间、调用、持久化已开始重试、预算耗尽、文件读取、提供方用量和单独估算。没有明确 manifest 预算时绝不启动真实路由。fixture 用量为合成数据。参见[验证](docs/validation.md)和 [fixture 证据](docs/fixture-benchmark.json)。真实模型任务质量及计费节省仍未经验证。
