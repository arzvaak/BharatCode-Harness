# 侧栏按模型花费

在「设置 → 费用 → 显示 → 按模型花费」启用。默认关闭；首次显示时收起为「今日金额 · 模型数」，点击标题在原位置展开。

- **范围与排序**：今日或近 90 个自然日（含今日），按金额降序显示 Top-N，默认 5，可设 1–10；余下模型归为「其它」。历史受账本保留范围限制，没有记录的日期不会补造费用。
- **金额与占比**：币种、汇率、小数位及 API / Plan 口径跟随现有费用设置。默认显示 API 实际金额；打开「合并显示等值费用」后包含订阅等值金额。占比以当前周期全部模型金额之和为分母，零金额显示 0%。此卡片不重新计价。
- **Token**：可显示输入、缓存读写合计和输出。不同提供商的同名模型分开统计；长名称省略显示，悬停可查看全名，金额保持可见。
- **位置与摘要**：可放在图框序列最前、余额之后或最后；收起时可选总额与模型数，或花费最高的模型与金额。另可独立启用 Top-1 dock 角标。
- **展开状态**：可设置默认展开，并选择记住最后一次展开状态。记忆存于当前浏览器的本地存储；关闭记忆后，重新打开页面使用默认展开设置。卡片内临时切换周期不修改设置中的默认周期。
- **刷新**：10–60 秒，默认 60 秒，与现有费用看板共用 `getState` 快照轮询。页面隐藏时暂停；重新可见时刷新。展开、切换周期不会向模型服务或额度端点发起额外查询。
- **窄侧栏**：简化模式保留一行摘要；rail 收起态显示图标，悬停查看周期、总额和模型数。

模型设置保存为独立的 `sidebarModels` 配置；升级后自动补默认值。分模型明细仍来自原账本：优先逐日模型桶，旧数据依次回退旧模型字段、会话明细及未分模型合计。

额度页使用另一套展开规则：网关、Go、Coding Plan 和自定义余额各自展开，状态只保留在当前组件内存中。启用项优先；启用组与未启用组内部保持网关 → Go → Coding Plan → 自定义余额的顺序。卡片左侧启用、最右侧刷新；配置尚未保存、显示位置关闭或正在刷新时按钮禁用。自定义余额删除尚未保存时，也会等待新下标保存后再允许刷新。

## English

Enable the card under **Settings → Cost → Display → Model costs**. It is disabled by default and initially collapsed. Click its title to expand the breakdown inline.

- Select Today or the last 90 calendar days, including today. Top-N defaults to 5 (range 1–10); remaining models are combined into Other. Available history is limited by ledger retention.
- Amounts follow the existing currency, exchange rate, precision and API / Plan display settings. The default shows API spending; the existing combined-equivalent option includes subscription equivalents. Shares divide each amount by the sum across all models in the selected period; a zero total gives 0%. Existing ledger costs are not repriced.
- Optional tokens show input, combined cache reads/writes and output. Provider/model pairs remain distinct. Long names truncate with full-name tooltips, while amounts remain visible.
- Choose first, after balances or last in the sidebar stack. The collapsed summary can show total plus model count, or Top-1 plus its amount. A Top-1 composer dock chip can be enabled independently.
- Choose the default expansion state and whether to remember it in this browser's local storage. With memory disabled, remounting uses the configured default. Switching periods inside the card does not change the configured default period.
- Refresh every 10–60 seconds (default 60) using the shared `getState` poll. Hidden pages pause polling and refresh on visibility. Expanding or changing periods does not query model or quota endpoints.
- Simple sidebars use one summary row; collapsed rails use an icon with the period, total and model count in its tooltip.

Model preferences use a separate optional `sidebarModels` object. Quota cards retain their existing configuration and RPC signatures. Their expansion is memory-only, and enabled cards sort first while preserving gateway → Go → Coding Plan → custom balance order within each group. Refresh waits for saved enable/display settings; custom balance deletion also waits for its new index to be saved.
