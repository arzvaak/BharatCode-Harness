# Agent Note：Linux GitHub 分发

Status: implemented

[English](2026-10-10-linux-github-distribution.md) | 中文

## 问题

Linux 预览版只提供手动更新的 AppImage。Fedora 和 Debian 用户需要原生安装包，公开下载需要易用的营销页面，同时应用 CI 必须继续在本机运行。

## 决策

Linux 打包生成带公开 GitHub release 更新配置的 AppImage、RPM 和 DEB 安装包。预发布版本包含干净提交的时间戳；release 标签使用 `v<version>` 和 `rc-linux.yml` 更新源。现有更新协调器分别要求下载与重启确认，并保留校验及防止降级的检查。本机验证在发布前记录安装包和更新源的精确字节。

静态营销源码与扩展商店放在一起。本机浏览器检查覆盖工作流标签、键盘导航、安装命令复制、响应式布局及无效 release 元数据。Pages 从 `gh-pages` 上传本机组装的网站；只有这一公开部署工作流获得授权。私有应用构建和测试 Actions 保持禁用。

## 影响

旧 AppImage 需要先手动安装一次，之后才能在应用内更新。RPM 和 DEB 更新可能要求系统授权。本次验证限于 Linux x64；依赖账户的模型生成和其他操作系统维持现有验证限制。仓库主分支的公开目录内容独立于 Pages 分支。

## 验证

本机发布运行器要求包元数据和校验验证、专属临时目录中真实 AppImage 校验失败和替换检查、营销页浏览器检查及现有完整本机检查。发布器拒绝过期源码修订和变化的产物字节。

## 已考虑的替代方案

保留手动 AppImage 下载无法完成原生包格式和应用内更新需求。托管应用构建会消耗用户的 Actions 额度，并违反本机发布要求。
