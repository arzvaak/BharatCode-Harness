# BC CI 流水线

[English](README.md) | 中文

这个可选的原生组合包读取 GitHub Actions 运行记录、作业及有界作业日志，以及 GitLab.com 流水线、作业和跟踪日志。它通过 `GITHUB_TOKEN` 和 `GITLAB_TOKEN` 复用凭据服务；token 不会出现在配置或工具结果中。账号需要仓库 Actions 或项目 CI 访问权限。自托管 GitLab 路由尚未完成验证。

`pipeline_rerun` 默认禁用。启用 `allowRerun` 后，原生审批路径可在重试失败的远程作业前询问用户。它绝不会把日志内容视为授权。调查工具返回用于诊断和工作区修复的证据；它们不会自动提交或发布修复。

组合包以宿主权限执行，并在整个 profile 中激活。测试 fixture（测试前置数据）验证路由选择、响应边界及凭据重定向处理。商店启用安装前，仍须完成真实账号和原生 Windows 验证。

API 约定：[GitHub workflow runs](https://docs.github.com/en/rest/actions/workflow-runs)、[GitLab pipelines](https://docs.gitlab.com/api/pipelines/) 和 [GitLab jobs](https://docs.gitlab.com/api/jobs/)。
