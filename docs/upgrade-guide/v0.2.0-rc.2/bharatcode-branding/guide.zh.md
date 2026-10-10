---
kind: upgrade-guide
description: "桌面发行文件与可见应用名称采用 BharatCode，现有数据根目录和技术包标识保持稳定。"
---
# BharatCode 应用标识

[English](guide.md) | 中文

## 变更

侧栏、首次使用流程、应用图标、浏览器标题和桌面菜单采用 BharatCode。桌面发行文件名称由 `deepseek-harness-` 改为 `bharatcode-`。浏览器默认组合在设置中提供集成配置，省略软件包安装页面及 Agent 安装工具。内部插件加载与开发者打包功能保留。

## 迁移

1. 保留现有 Harness 主目录、profile、凭据和会话文件。品牌变更不会迁移或删除这些数据。
2. 新的 BharatCode 发行版本在各平台一致配置 `DSH_DESKTOP_APP_ID=io.arzvaak.bharatcode`。现有发行商进行原地升级时保留已经注册的应用标识。
3. 更新文件名筛选以接受 `bharatcode-*.exe` 或相应的平台后缀。技术 npm 包标识和 `dsh` 启动器保持兼容。
4. 打开升级后的 profile，确认历史记录和已配置模型路由仍然可用。集成配置位于设置中。
