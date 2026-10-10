# 为 BharatCode Harness 做贡献

[English](CONTRIBUTING.md) | 中文

在 [BharatCode 问题页面](https://github.com/arzvaak/BharatCode-Harness/issues)报告可复现的错误或讨论修改。请提供应用版本、操作系统、预期结果及复现步骤。发布日志前移除凭据和个人信息。

## 准备修改

按照[开发指南](docs/development.zh.md)设置代码目录。保持修改范围明确，保留已有用户数据，并同步更新相关英文及中文文档。[开发者指南](DEVELOPER_GUIDE.md)说明仓库约定；[架构文档](docs/architecture.zh.md)解释实现。

## 检查修改

在本机运行与修改相关的检查。文档使用 `pnpm run doc-sync`；代码修改可能需要构建、类型检查、lint 和针对性测试。Linux 发布要求完整的本机发布检查及匹配的产物哈希。不要启用应用构建或测试 Actions；公开 Pages 工作流仅部署在本机准备的内容。

## 许可证

贡献内容采用项目的 [MIT 许可证](LICENSE)。改编代码应保留上游归属及第三方许可声明。
