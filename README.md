# PONS 每日投资监测台

面向 PONS 投资决策的公开、可审计仪表板。每天 09:15（Asia/Shanghai）自动更新，页面同时保留 7 日、30 日和相邻窗口比较。

## 当前决策框架

只有价值捕获、留存与质量、安全与治理、流动性四个维度同时改善，且关键指标覆盖率达到 85%，才显示“基本面配置”。任一维度缺数据或未改善时保持“事件驱动观察”；命中关键权限变更、严重流动性或数据过期红旗时显示“风险降级”。

这不是把所有指标压成一个分数。尤其注意：

- V2 协议收入增长不自动等于 PONS 代币受益。
- 死地址余额增加不自动等于协议回购，必须完成交易路径归因。
- 缺失值显示为“待补齐”，不会被当作 0。
- Pons 与 Pools.trade 发行份额的混合时间窗口会明确标为近似口径。

## 自动数据源

- Pons Analytics 与 Buyback Status
- DefiLlama V1/V2 Fees、Revenue、Holders Revenue
- Robinhood Chain 公共 RPC
- CoinGecko
- DexScreener
- Binance Futures
- KuCoin

Creator 复发率、毕业项目 D7 留存、项目 Top10 成交集中度、Pons/Pools 精确成交份额和完整持币分布需要 Bitquery/Dune 等索引明细。在取得稳定数据源前，这些指标保持缺失并阻止结论升级。

## 本地检查

无需安装第三方依赖：

```bash
node scripts/collect.mjs
node --test tests/*.test.mjs
node scripts/validate-data.mjs
```

在 `site/` 启动任意静态文件服务器即可查看页面。

## GitHub Pages

推送到 GitHub 后，`Daily PONS investment monitor` 工作流会：

1. 每天采集实时数据并追加最多 365 天历史；
2. 运行判定测试和数据校验；
3. 将快照提交回仓库；
4. 部署 `site/` 到 GitHub Pages。

也可在 Actions 页面手动运行。GitHub 定时任务可能有少量排队延迟。

## 文档

- [指标合同](docs/metric-contract.md)
- [判定规则](docs/decision-rules.md)
- [数据源与降级](docs/data-sources.md)

## 免责声明

看板用于研究与风险监控，不构成投资建议。公开 API、链上索引、交易所盘口和协议参数都可能变化；建立仓位前应复核来源、滑点、合约权限和个人风险承受能力。
