# BharatCode Harness

[English](README.md) | 中文

![BharatCode Harness — 集聊天、编程、研究和写作于一体的桌面应用](integrations/extension-store/site/assets/readme-cover.svg)

BharatCode Harness 将对话、项目文件和实用工具整合到一个桌面应用中。你可以开始独立聊天、进入编程工作区、收集研究资料或完善草稿。准备好后再选择提供方；首次设置可以跳过。

[了解 BharatCode](https://arzvaak.github.io/BharatCode-Harness/) · [下载 Linux 版本](https://github.com/arzvaak/BharatCode-Harness/releases) · [报告问题](https://github.com/arzvaak/BharatCode-Harness/issues)

## 可以做什么

- **无需工作区即可聊天。** 每个独立聊天都有自己的文件夹，位于通用聊天目录下。在工作区内打开聊天，则将文件与对话归入该工作区。
- **编程、研究与写作。** 切换工作流、查看项目文件、预览文档，让对话与工作并排显示。
- **选择自己的提供方。** 使用 BharatCode、受支持的订阅连接或 API 提供方。可以跳过设置，之后在设置页面完成。
- **扩展工作区。** 从侧栏发现扩展与技能。安装前会显示要求和可用状态；可选集成可能需要独立账户或本地软件。
- **自行决定更新时机。** 在应用内检查 GitHub 发布版本、下载更新，再确认何时重启。

## 在 Linux 上安装

当前预览版支持 Linux x64。从[发布页面](https://github.com/arzvaak/BharatCode-Harness/releases)选择安装包。

| 下载格式 | 适用平台 | 安装方式 |
| --- | --- | --- |
| `.rpm` | Fedora 及兼容 RPM 的桌面系统 | 使用 `sudo dnf install ./<filename>.rpm` 安装下载的文件。 |
| `.deb` | Debian、Ubuntu 及兼容桌面系统 | 使用 `sudo apt install ./<filename>.deb` 安装下载的文件。 |
| `.AppImage` | 支持 FUSE 的 Linux 桌面 | 运行 `chmod +x ./<filename>.AppImage`，然后打开该文件。 |

将 `<filename>` 替换为下载的安装包名称。发布版本包含校验和与本机验证记录。原生安装包更新可能请求系统授权。仅支持手动下载的旧版本需要先安装一次当前安装包，之后才能使用应用内更新。

这是预览版：当前 Linux 发布的验证范围不包含 Windows 或 ARM64，也不包含依赖真实账户的提供方认证及推理。在运行不可信工作负载前，请阅读 [SAFETY.zh.md](SAFETY.zh.md)。

<a id="build-from-source"></a>

## 从源码构建

安装 Node.js 22.19+（22 系列）或 24 及更新版本及 pnpm，然后运行：

```sh
git clone https://github.com/arzvaak/BharatCode-Harness.git
cd BharatCode-Harness
pnpm install --frozen-lockfile
pnpm run build
pnpm dsh web
```

最后一条命令在 `http://127.0.0.1:3080` 打开 Web 界面。桌面开发与 Linux 打包请参阅[桌面指南](apps/desktop/README.zh.md)。内部 `dsh` 命令及包标识符为兼容性而保留。

## 文档与贡献

从[用户指南](docs/user/guide/index.zh.md)、[开发指南](docs/development.zh.md)或[架构文档](docs/architecture.zh.md)开始。报告问题及准备修改请参阅 [CONTRIBUTING.zh.md](CONTRIBUTING.zh.md)。应用构建和测试检查在本机运行；公开 Pages 工作流仅部署预构建的网站内容。

## 许可证

BharatCode Harness 采用 [MIT 许可证](LICENSE)。依赖的许可信息请参阅[第三方声明](THIRD_PARTY_NOTICES.md)。

## 项目来源

本项目改编并 fork 自 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)，原项目由 DeepSeek AI 开发。其插件架构使用 [Cordis](https://github.com/cordiverse/cordis)。上游版权及许可声明予以保留。
