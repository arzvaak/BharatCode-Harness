# 分支兼容性

[English](README.md) | 中文

已接受的上游记录、行为登记表与 GitHub Actions 检查共同管理上游集成。原有品牌修改工作树保持独立。初始记录标识此前接受的源代码提交；空产物列表表示没有保留旧产物标识。每个新检查任务成功后记录精确源代码 SHA、上游 SHA、Node/pnpm 版本、锁文件 SHA-256、运行链接与产物名称。GitHub 分配产物 ID，发布候选清单记录这些 ID。

## 每日上游集成

配置仅安装到此仓库的 GitHub App，授予 Contents、Pull requests、Issues 与 Workflows 读写权限。将 App ID 存为仓库变量 `UPSTREAM_APP_ID`，将 PEM 私钥存为密钥 `UPSTREAM_APP_PRIVATE_KEY`。Workflows 权限允许推送上游工作流变更；安装令牌的推送触发普通 PR 检查。不使用个人访问令牌作为后备。缺少凭据时，只读漂移报告完成后任务失败，不修改分支或 PR。

每日工作流将上游 master 与受保护 master 上的 `baseline.json` 比较。它将主干与上游合并到唯一的 `sync/upstream` 分支，保留此前候选修复与上游祖先关系。普通推送拒绝并发远端变动。工作流创建或更新一个 PR；冲突会中止合并并更新一个阻塞问题。接受记录仅在候选分支上变更，通过审核合并后才成为权威记录。上游历史重写需要人工调查。集成不会自动合并、强制推送、删除测试或重写预期输出。

```sh
node scripts/compatibility/upstream.mjs report upstream/master HEAD
node scripts/compatibility/upstream.mjs validate
```

准备命令会修改其检出目录，仅在干净、可丢弃的候选检出目录中运行。日常使用的配置档案与并发开发工作树应保持独立。

## 必需证据

`build + unit + config` 检查构建完整产品、验证实际配置档案设置、运行负向对照与持久化格式检查，并保留完整默认单元测试套件。`Linux replay + web + desktop` 运行已提交会话重放、构建后 CLI 预期输出、构建后浏览器场景，以及 Xvfb 下真实的 Electron 主进程、预加载与 Web Host。`Windows unsigned runtime` 在原生 Windows 上构建和打包，运行打包运行时检查，并验证缺少依赖时会被拒绝。任一必需任务失败、取消或跳过时，`fork compatibility` 汇总检查失败。GitHub 托管运行器负责这些完整检查；本地命令提供针对性反馈。

```sh
pnpm install --frozen-lockfile
pnpm run build
node --test scripts/compatibility/*.test.mjs
node scripts/compatibility/composition.mjs
pnpm exec vitest run scripts/compatibility/continuation.spec.ts apps/desktop/tests/runtime-tree.spec.ts
pnpm exec vitest run --config vitest.expected.config.ts apps/cli/tests/profiles/web/tests/fork-compatibility.expected.e2e.ts
xvfb-run -a pnpm exec tsx scripts/compatibility/linux-desktop.ts
```

执行桌面命令前，使用 `pnpm --dir apps/desktop exec node node_modules/electron/install.js` 安装 Electron 运行时。检查拥有独立临时主目录、用户数据与操作系统分配的端口。`BHARATCODE_COMPAT_RUNTIME` 可在本地检查中指定已准备的 Linux 运行时；CI 准备自身固定版本的运行时。启动应用前，准备过程验证 Office/Python 载荷。Linux 输出是开发运行时检查，并非可分发安装程序。

全新配置档案检查覆盖 web、headless、SDK、SDK-minimal 与 ACP。脱敏桌面覆盖配置验证 BharatCode 模型、上下文与输出上限、最高推理选项、Cordis 预设和 SearXNG 路由，不包含凭据或用户会话。构建后的 Web 进程报告独立收集的插件状态、读取实际模型与预设服务，并通过操作系统分配端口的本地模拟服务调用已接受的 SearXNG 适配器。禁用插件与错误提供方的对照必须无法通过行为断言。桌面插件集合保持为显式测试夹具；第三方插件必须先添加独立激活与行为检查，才能宣称兼容。

SearXNG 适配器夹具是已接受的树外实现，在初始设置时从本地扩展包复制。本地插件变更需要在经过审核的 PR 中更新此夹具与测试；CI 无法读取开发者的外部文件系统。真实 SearXNG 实例需通过实际安装的配置档案执行搜索并检查服务流量来单独验证。重放不能证明真实搜索引擎可用或真实模型推理成功。

## 自定义与故障修复

每项自定义在 `behaviors.json` 中登记用途、依赖的上游路径与证据归属。变更需求前先添加行为测试。包接口变更可能影响某行为，即使没有触及分支修改过的文件；文件重叠只是风险信号。品牌修改阶段必须同时更新品牌测试与身份断言；此分支保留已提交的现有身份，不将未提交品牌修改混入兼容性基础设施。

修复简报包含一个行为 ID、相关差异、精确失败命令、预期结果与证据报告。在等效工具链和环境下比较旧分支、所选上游与候选版本，再将失败归类为上游回归、分支回归、环境故障或不稳定测试。不得通过刷新快照、删除测试、广泛排除或接受跳过的平台检查来取得绿色 CI。所有变更的预期输出必须明确审核。会话格式变更遵循仓库的持久化确认规则与已提交历史代际。

## 内部候选与回滚

受保护 master 的所有检查成功后，在 master 上手动触发 `Retain compatibility candidate`。在 `compatibility-release` 环境中配置 `BHARATCODE_API_KEY`；可选变量 `BHARATCODE_BASE_URL` 与 `BHARATCODE_MODEL` 选择 HTTPS 端点与模型。凭据化推理探测在缺少凭据或响应不符合预期时失败。此直接推理探测补充分支的无密钥端到端测试，并不验证所有真实工具或推理级别。

工作流要求同一精确提交的主干 CI 成功、汇总检查通过，且 unit/Linux/Windows 产物未过期。它为内部预发布版本打标签，保留原始产物压缩包及其 ID 和 SHA-256。普通 CI 产物保存 30 天；内部候选附件保留选定的已知良好输出。重复使用候选标签不能覆盖已有发布资产。Windows 载荷未签名。Linux 压缩包包含已测试的源代码、依赖、Electron 与固定版本运行时；解压后使用 `ELECTRON_RUN_AS_NODE=1 apps/desktop/node_modules/electron/dist/electron --import tsx/esm apps/desktop/scripts/start-linux-local.ts` 启动，它会为新目录重新生成开发链接。这不是安装程序。公开发布仍需签名打包、安装程序验证与升级测试；兼容性候选并非公开发布。

仅使用配置档案与会话数据的可丢弃副本测试升级。重放套件在独立临时目录中读取已提交的历史会话。升级通过前保留旧应用与数据备份。向前数据迁移可能使仅回滚应用无效；没有明确受支持的降级路径时，切勿让旧应用读取已迁移的实际数据。
