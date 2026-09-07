# 数据源与降级策略

| 来源 | 用途 | 无密钥 | 降级规则 |
|---|---|---:|---|
| Pons 官方 Analytics API | 发行、累计成交、累计协议/创作者收入 | 是 | 最新日成交为 0 或延迟时标记异常，不用 0 推导趋势 |
| Pons 官方 Buyback Status API | splitter、intake、escrow 待执行资金 | 是 | 地址变化触发红色告警 |
| DefiLlama Fees API | V1/V2 费用、协议收入、持币人收入 | 是 | V1/V2 分页为主，组合页仅交叉验证 |
| Robinhood Chain RPC | 总供应、死地址、Owner/operator、日志 | 是 | RPC失败时保留上次值并标为过期 |
| CoinGecko | 价格、市值、供应量、成交额 | 是 | 限流时回退 DexScreener 价格并将市值置空 |
| DexScreener | PONS 链上池、成交、池流动性 | 是 | 去除无有效 USD 数据的池 |
| Binance Futures | 永续深度、资金费率、OI、基差 | 是 | 合约下架即触发市场可用性告警 |
| KuCoin | 现货盘口深度 | 是 | 只保留返回的前100档并注明范围 |
| Bitquery GraphQL | creator、复发、毕业、D7留存、项目集中度、Pools成交 | 否 | 未配置 `BITQUERY_API_KEY` 时明确显示“需密钥” |
| 官方审计/条款页面 | 审计与地区限制 | 是/人工 | 只记录可验证文本和复核日期 |

所有采集结果写入 `site/data/latest.json`；每日快照追加到 `site/data/history.json`，最多保留 365 天。采集失败不会静默使用虚构数据。
