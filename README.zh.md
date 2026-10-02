# BharatCode Harness

[English](README.md) | 中文

BharatCode Harness 是 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（`dsh`，由 [DeepSeek AI](https://deepseek.com) 开发的开源 agent harness（智能体框架））的个人 fork，重新定位为 BharatCode 工作台：工作流优先的 flavor、按领域划分的专属视图，以及 BharatCode 品牌。

与上游一致，一切皆插件，构建于 [Cordis](https://github.com/cordiverse/cordis) 之上，其设计参见论文 [_A Programming Paradigm for Spatiotemporal Composability_](https://arxiv.org/abs/2608.25512)。上游文档仍是参考：[deepseek-harness docs](https://deepseek-harness.github.io/deepseek-harness/)。

## 开发者预览

上游处于_开发者预览_阶段并快速迭代——**破坏兼容性的变更会发生**，本 fork 继承这一状态。运行本项目前，请阅读[安全说明](SAFETY.zh.md)。

<a id="run"></a>

## 运行

### 运行 Desktop 应用

Electron Desktop 应用是主要界面。在仓库检出中：

```sh
pnpm install
pnpm run build
DSH_DESKTOP_WEB_PORT=19400 pnpm exec tsx apps/desktop/scripts/start-linux-local.ts
```

`start-linux-local` 会准备固定的 primary runtime 与一个开发 profile，然后以隔离的 home 与 user data 启动 Electron，使其可以与已安装实例并行运行。`DSH_DESKTOP_WEB_PORT` 选择端口；Desktop 默认端口为 19387。

<a id="run-the-web-ui"></a>

### 运行 Web UI

```sh
git clone https://github.com/arzvaak/Bharatcode-Harness.git
cd Bharatcode-Harness
pnpm install
pnpm run build
pnpm dsh web
```

`pnpm run build` 会准备仓库产物；`pnpm dsh web` 直接使用这些已构建产物，不会重新构建。参数会传递给 `dsh web`，例如 `pnpm run dev:web --no-open --port 3081`。

## 发布流程

任何变更都必须通过门禁才能进入 `main`。候选变更被拉入 `alpha`，晋级到 `beta`，最后发布到 `main`：

```text
upstream (read-only) ── manual sync PR ──► alpha ◄── candidate/* & feature PRs
                                              │
                                   promotion PR (required checks)
                                              ▼
                                             beta ── 3-day soak + smoke ──► main (default, tagged)
```

| 分支 | 用途 | 门禁 |
|---|---|---|
| `alpha` | 集成：上游同步、候选变更、功能 | 精简：冻结安装、构建、单元测试、品牌 tripwire |
| `beta` | 稳定 | 完整：测试矩阵、配置快照 diff、插件行 diff、品牌 tripwire、冒烟 |
| `main` | 发布状态——默认分支 | 仅接受 beta 晋级 PR：完整门禁、3 天 soak、agent 冒烟、人工合并 |

**配置快照 diff** 捕获上游测试无法发现的失效类别：Cordis Loader 会警告并跳过 `id` 不再存在的 patch 行，因此上游的行重命名会在不失败任何测试的情况下静默回退某项覆盖。

## 开发

请先阅读[开发指南](docs/development.zh.md)与[架构文档](docs/architecture.zh.md)。

`pnpm run dev:web` 会在一个终端里完成构建、启动，并在源码修改时重建 client bundle；`pnpm run dev:desktop` 会构建并启动 Desktop；`make help` 列出对应的 Make target。完整表格见开发指南的「应用命令」一节。

面向 agent：请遵循 [AGENTS.md](AGENTS.md)。上游的贡献入口见 [CONTRIBUTING.md](CONTRIBUTING.zh.md)。

## 上游与致谢

- 本项目 fork 自 [deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness)，采用 MIT License；按上游[品牌指南](https://github.com/deepseek-ai/deepseek-harness/blob/master/BRAND_GUIDELINES.md)，本项目描述为 _built on DeepSeek Harness_。
- 本地改动以 `local/*` 提交记录在固定的上游基线之上；决策与待办见 journal。
- `dsh` CLI、profiles、bundles 与 Cordis 插件系统均为未改动的上游技术。

```bibtex
@misc{deepseek-harness2026,
  title={DeepSeek Harness: Everything is a Plugin},
  author={DeepSeek-AI},
  year={2026},
  publisher={GitHub},
  howpublished={\url{https://github.com/deepseek-ai/deepseek-harness}},
}
```

## 许可证

[MIT](LICENSE)

第三方依赖及其许可证见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
