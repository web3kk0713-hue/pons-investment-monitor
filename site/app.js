const $ = (selector) => document.querySelector(selector)

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;')
}

function isNumber(value) { return typeof value === 'number' && Number.isFinite(value) }

function compact(value, digits = 2) {
  if (!isNumber(value)) return '待补齐'
  const absolute = Math.abs(value)
  const units = [[1e9, 'B'], [1e6, 'M'], [1e3, 'K']]
  const unit = units.find(([floor]) => absolute >= floor)
  if (!unit) return value.toLocaleString('zh-CN', { maximumFractionDigits: digits })
  return `${(value / unit[0]).toLocaleString('zh-CN', { maximumFractionDigits: digits })}${unit[1]}`
}

function money(value, digits = 2) { return isNumber(value) ? `$${compact(value, digits)}` : '待补齐' }
function percent(value, digits = 1) { return isNumber(value) ? `${value.toFixed(digits)}%` : '待补齐' }
function multiple(value) { return isNumber(value) ? `${value.toFixed(1)}×` : '待补齐' }
function token(value) { return isNumber(value) ? `${compact(value, 2)} PONS` : '待补齐' }
function shortAddress(value) { return value ? `${value.slice(0, 6)}…${value.slice(-4)}` : '待补齐' }
function explorerAddress(value) { return `https://explorer.mainnet.chain.robinhood.com/address/${encodeURIComponent(value)}` }
function explorerTx(value) { return `https://explorer.mainnet.chain.robinhood.com/tx/${encodeURIComponent(value)}` }

function change(current, previous) {
  if (!isNumber(current) || !isNumber(previous) || previous === 0) return { text: '缺前窗', cls: '' }
  const value = ((current - previous) / Math.abs(previous)) * 100
  return { text: `${value >= 0 ? '+' : ''}${value.toFixed(1)}% 前窗`, cls: value >= 0 ? 'delta-up' : 'delta-down' }
}

function stateMeta(state) {
  return {
    improving: ['改善', 'improving'],
    not_improving: ['未改善', 'not_improving'],
    unknown: ['待验证', 'unknown'],
    risk: ['风险', 'risk'],
  }[state] ?? ['待验证', 'unknown']
}

function renderChart(series) {
  const rows = (series ?? []).slice(-30).filter((row) => isNumber(row.v1RevenueUsd) || isNumber(row.v2RevenueUsd))
  if (rows.length < 2) return '<div class="empty-chart">可用数据点不足</div>'
  const width = 820
  const height = 285
  const pad = { left: 55, right: 18, top: 12, bottom: 32 }
  const plotWidth = width - pad.left - pad.right
  const plotHeight = height - pad.top - pad.bottom
  const values = rows.flatMap((row) => [row.v1RevenueUsd, row.v2RevenueUsd]).filter(isNumber)
  const max = Math.max(...values, 1)
  const x = (index) => pad.left + (index / (rows.length - 1)) * plotWidth
  const y = (value) => pad.top + plotHeight - ((value ?? 0) / max) * plotHeight
  const pathFor = (key) => rows.map((row, index) => `${index === 0 ? 'M' : 'L'} ${x(index).toFixed(2)} ${y(row[key]).toFixed(2)}`).join(' ')
  const ticks = [0, .25, .5, .75, 1]
  const grid = ticks.map((tick) => {
    const lineY = pad.top + plotHeight - tick * plotHeight
    return `<line class="chart-grid" x1="${pad.left}" y1="${lineY}" x2="${width - pad.right}" y2="${lineY}"/><text x="4" y="${lineY + 4}">${escapeHtml(money(max * tick, 1))}</text>`
  }).join('')
  const labelIndexes = [0, Math.floor((rows.length - 1) / 2), rows.length - 1]
  const labels = labelIndexes.map((index) => `<text x="${x(index)}" y="${height - 8}" text-anchor="${index === 0 ? 'start' : index === rows.length - 1 ? 'end' : 'middle'}">${escapeHtml(rows[index].date.slice(5))}</text>`).join('')
  const last = rows.length - 1
  return `<svg class="chart-svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="最近30个可用数据点的 V1 和 V2 每日协议收入">${grid}<path class="chart-v1" d="${pathFor('v1RevenueUsd')}"/><path class="chart-v2" d="${pathFor('v2RevenueUsd')}"/><circle class="chart-dot-v1" cx="${x(last)}" cy="${y(rows[last].v1RevenueUsd)}" r="4"/><circle class="chart-dot-v2" cx="${x(last)}" cy="${y(rows[last].v2RevenueUsd)}" r="4"/>${labels}</svg>`
}

function tickerItem(label, value, detail, delta = null) {
  return `<div class="ticker-item"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong><small class="${delta?.cls ?? ''}">${escapeHtml(delta?.text ?? detail)}</small></div>`
}

function ledgerRow(label, value, detail = '') {
  return `<div class="ledger-row"><span>${escapeHtml(label)}${detail ? `<small> · ${escapeHtml(detail)}</small>` : ''}</span><strong>${escapeHtml(value)}</strong></div>`
}

function depthRow(label, total, bids, asks) {
  const bidPct = isNumber(bids) && isNumber(total) && total > 0 ? (bids / total) * 100 : 50
  const askPct = 100 - bidPct
  return `<div class="depth-row"><div class="depth-row-head"><span>${escapeHtml(label)}</span><strong>${escapeHtml(money(total))}</strong></div><div class="depth-bar" style="--bid:${bidPct.toFixed(1)}%;--ask:${askPct.toFixed(1)}%"><span class="bid"></span><span class="ask"></span></div><div class="depth-labels"><span>买盘 ${escapeHtml(money(bids))}</span><span>卖盘 ${escapeHtml(money(asks))}</span></div></div>`
}

function statusTag(value, quality = 'auto') {
  if (value === null || value === undefined) return '<b class="tag missing">待补齐</b>'
  if (quality.includes('partial')) return '<b class="tag partial">近似口径</b>'
  return '<b class="tag">自动</b>'
}

function activityRow(label, value, formatter, quality = 'auto') {
  return `<div class="ledger-row"><span>${escapeHtml(label)}</span><span><strong>${escapeHtml(formatter(value))}</strong> ${statusTag(value, quality)}</span></div>`
}

function securityItem(label, value, isAddress = false) {
  const content = isAddress && value
    ? `<a href="${escapeHtml(explorerAddress(value))}" target="_blank" rel="noreferrer"><code title="${escapeHtml(value)}">${escapeHtml(shortAddress(value))}</code></a>`
    : `<strong>${escapeHtml(value ?? '待补齐')}</strong>`
  return `<div class="security-item"><span>${escapeHtml(label)}</span>${content}</div>`
}

function render(data) {
  const decision = data.decision
  const market = data.market
  const revenue = data.revenue
  const capture = data.capture
  const created = new Date(data.generatedAt)
  const ageHours = (Date.now() - created.getTime()) / 3_600_000
  const fresh = ageHours <= 30
  const severityText = { critical: '严重', high: '高', medium: '中', low: '低' }

  document.body.dataset.status = decision.status
  $('#verdict-title').textContent = decision.label
  $('#verdict-summary').textContent = decision.status === 'fundamental_allocation'
    ? '四个维度同时改善，且关键数据覆盖达到门槛。仍需结合仓位和估值纪律。'
    : decision.status === 'risk_downgrade'
      ? '命中硬红旗。优先处理退出能力、安全或数据失真风险。'
      : '业务热度存在，但价值捕获、留存、安全或流动性尚未同时通过。'
  $('#generated-at').textContent = `数据时间 ${created.toLocaleString('zh-CN', { timeZone: data.timezone, hour12: false })}`
  $('#chain-block').textContent = `Robinhood Chain #${data.chain.block?.toLocaleString('en-US') ?? '—'}`
  $('#coverage-text').textContent = `${decision.coveredRequiredMetrics}/${decision.totalRequiredMetrics} 项关键指标`
  $('#coverage-number').textContent = `${decision.coveragePct.toFixed(0)}%`
  $('#coverage-bar').style.width = `${Math.max(0, Math.min(100, decision.coveragePct))}%`
  $('#freshness').textContent = fresh ? `已更新 · ${Math.max(0, ageHours).toFixed(1)} 小时前` : `数据过期 · ${ageHours.toFixed(0)} 小时`

  const revenue7Delta = change(revenue.protocolRevenue7dUsd, revenue.previousProtocolRevenue7dUsd)
  $('#ticker').innerHTML = [
    tickerItem('PONS 价格', money(market.priceUsd, 4), `${percent(market.priceChange24hPct)} / 24h`, { text: `${market.priceChange24hPct >= 0 ? '+' : ''}${percent(market.priceChange24hPct)} / 24h`, cls: market.priceChange24hPct >= 0 ? 'delta-up' : 'delta-down' }),
    tickerItem('流通市值', money(market.marketCapUsd), `排名 #${market.marketCapRank ?? '—'}`),
    tickerItem('7日协议收入', money(revenue.protocolRevenue7dUsd), '', revenue7Delta),
    tickerItem('30日协议收入', money(revenue.protocolRevenue30dUsd), `V2 占 ${percent(revenue.v2RevenueShare30dPct)}`),
    tickerItem('PONS 年化持币收益率', percent(revenue.annualizedHolderRevenueYieldPct, 2), '基于近30日持币人收入'),
    tickerItem('正负2%可观测深度', money(market.depth2PctUsd), 'KuCoin 现货 + Binance 永续'),
  ].join('')

  $('#gate-grid').innerHTML = Object.values(decision.dimensions).map((dimension) => {
    const [label, cls] = stateMeta(dimension.state)
    return `<article class="gate-card ${cls}"><div class="gate-status"><span>门槛状态</span><b>${escapeHtml(label)}</b></div><h3>${escapeHtml(dimension.label)}</h3><ul>${dimension.reasons.map((reason) => `<li>${escapeHtml(reason)}</li>`).join('')}</ul></article>`
  }).join('')

  $('#alert-list').innerHTML = (data.alerts?.length ? data.alerts : [{ severity: 'low', title: '今天没有新增红旗', detail: '仍需等待四维同步改善。' }]).map((alert) => `<article class="alert-item ${escapeHtml(alert.severity)}"><span class="severity">${escapeHtml(severityText[alert.severity] ?? '提示')}风险</span><strong>${escapeHtml(alert.title)}</strong><p>${escapeHtml(alert.detail)}</p></article>`).join('')

  $('#revenue-chart').innerHTML = renderChart(revenue.series)
  $('#valuation-ledger').innerHTML = `<h3>估值与捕获账本</h3>${[
    ledgerRow('市值 / 年化协议收入', multiple(revenue.marketCapToAnnualizedProtocolRevenue), '平台估值'),
    ledgerRow('市值 / 年化持币人收入', multiple(revenue.marketCapToAnnualizedHolderRevenue), '代币估值'),
    ledgerRow('持币人 / 协议收入', percent(revenue.holderCaptureToProtocolRevenuePct), '直接捕获率'),
    ledgerRow('V2 30日收入占比', percent(revenue.v2RevenueShare30dPct), '当前不直接回流 PONS'),
    ledgerRow('待执行回购资金', money(capture.pendingBuybackUsd), `${percent(capture.pendingBuybackToRevenue30dPct)} / 30日收入`),
    ledgerRow('死地址占供应量', percent(capture.deadBalancePct, 2), token(capture.deadBalanceTokens)),
  ].join('')}`

  const flow = [
    ['30日总费用', money(revenue.fees30dUsd)],
    ['创作者收入', money(revenue.creatorRevenue30dUsd)],
    ['协议收入', money(revenue.protocolRevenue30dUsd)],
    ['PONS 持币人收入', money(revenue.holderRevenue30dUsd)],
    ['待执行回购资金', money(capture.pendingBuybackUsd)],
    ['已归因 PONS 回购', money(capture.attributedBuyback30dUsd)],
  ]
  $('#cashflow-rail').innerHTML = flow.map(([label, value], index) => `<div class="flow-step ${index === 5 && capture.attributedBuyback30dUsd === null ? 'unknown' : ''}"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`).join('')

  $('#liquidity-panel').innerHTML = [
    depthRow('KuCoin 现货 · 正负2%', market.spotDepth2PctUsd, market.spotBidDepth2PctUsd, market.spotAskDepth2PctUsd),
    depthRow('Binance 永续 · 正负2%', market.perpDepth2PctUsd, market.perpBidDepth2PctUsd, market.perpAskDepth2PctUsd),
    `<div class="market-mini"><div><span>资金费率</span><strong>${escapeHtml(percent(market.fundingRatePct, 4))}</strong></div><div><span>未平仓量</span><strong>${escapeHtml(money(market.openInterestUsd))}</strong></div><div><span>基差</span><strong>${escapeHtml(percent(market.basisPct, 3))}</strong></div></div>`,
    `<div class="market-mini"><div><span>链上池流动性</span><strong>${escapeHtml(money(market.dexLiquidityUsd))}</strong></div><div><span>链上24h成交</span><strong>${escapeHtml(money(market.dexVolume24hUsd))}</strong></div><div><span>Robinhood 池数</span><strong>${escapeHtml(String(market.dexPairCount ?? '待补齐'))}</strong></div></div>`,
  ].join('')

  const activity = data.activity
  const retention = data.retention
  $('#activity-ledger').innerHTML = [
    activityRow('Pons 近24h发行', activity.ponsLaunches24h, (v) => compact(v, 0)),
    activityRow('Pools.trade 近24h发行', activity.poolsLaunches24h, (v) => compact(v, 0), activity.issuanceShareQuality),
    activityRow('Pons 发行份额', activity.ponsIssuanceShareProvisionalPct, percent, activity.issuanceShareQuality),
    activityRow('独立 creator / 30日', retention.uniqueCreators30d, (v) => compact(v, 0)),
    activityRow('creator 复发率 / 30日', retention.creatorRepeatRate30dPct, percent),
    activityRow('毕业率 / 30日', retention.graduationRate30dPct, percent),
    activityRow('毕业项目 D7 留存', retention.graduatedProjectD7RetentionPct, percent),
    activityRow('Top10 项目成交占比', retention.top10ProjectVolumeSharePct, percent),
  ].join('')

  const holders = data.holders
  $('#holder-summary').innerHTML = [
    ledgerRow('持币地址数', holders.holderCount === null ? '待补齐' : compact(holders.holderCount, 0), '等待索引器'),
    ledgerRow('Top10 集中度', percent(holders.top10ConcentrationPct), '排除池与死地址'),
    ledgerRow('交易所24h净流', token(holders.exchangeNetflow24hTokens), '等待地址标签'),
    ledgerRow('大额转账', `${holders.largeTransfers.length} 笔`, `扫描 ${compact(holders.largeTransferScanBlocks, 0)} 区块`),
  ].join('')
  $('#whale-table').innerHTML = holders.largeTransfers.length
    ? holders.largeTransfers.map((transfer) => `<tr><td><strong>${escapeHtml(token(transfer.amountTokens))}</strong></td><td><a href="${escapeHtml(explorerAddress(transfer.from))}" target="_blank" rel="noreferrer"><code>${escapeHtml(shortAddress(transfer.from))}</code></a></td><td><a href="${escapeHtml(explorerAddress(transfer.to))}" target="_blank" rel="noreferrer"><code>${escapeHtml(shortAddress(transfer.to))}</code></a></td><td>${escapeHtml(transfer.blockNumber.toLocaleString('en-US'))}</td><td><a class="tx-link" href="${escapeHtml(explorerTx(transfer.txHash))}" target="_blank" rel="noreferrer">${escapeHtml(shortAddress(transfer.txHash))}</a></td></tr>`).join('')
    : '<tr><td colspan="5" class="empty-row">当前扫描窗口没有达到阈值的大额转账，或日志数据暂不可用。</td></tr>'

  const security = data.security
  $('#security-grid').innerHTML = [
    securityItem('Factory owner', security.factoryOwner, true),
    securityItem('Hook owner', security.hookOwner, true),
    securityItem('Sweep operator', security.sweepOperator, true),
    securityItem('审计状态', security.auditStatus),
    securityItem('地区状态', security.regionStatus),
  ].join('') + (security.feePolicy ? `<div class="fee-policy" style="grid-column:1/-1">${[
    securityItem('协议费分成', `${security.feePolicy.protocolFeeShareBps / 100}%`),
    securityItem('V2 项目币回购', `${security.feePolicy.buybackBurnBps / 100}%`),
    securityItem('Hook 费', `${security.feePolicy.hookFeeBps / 100}%`),
    securityItem('最大内部价格冲击', `${security.feePolicy.maxInternalPriceImpactBps / 100}%`),
  ].join('')}</div>` : '')

  const healthySources = data.sourceHealth.filter((source) => source.status === 'current').length
  const failedSources = data.sourceHealth.filter((source) => ['failed', 'partial'].includes(source.status)).length
  $('#quality-summary').innerHTML = `<div><span>关键指标覆盖</span><strong>${escapeHtml(percent(decision.coveragePct, 0))}</strong></div><div><span>健康数据源</span><strong>${healthySources}/${data.sourceHealth.length}</strong></div><div><span>使用限制</span><p>${escapeHtml(data.dataNotes.join(' '))}</p></div>`
  const sourceStatusText = { current: '正常', failed: '失败', partial: '部分', not_applicable: '不适用' }
  $('#source-table').innerHTML = data.sourceHealth.map((source) => `<tr><td><a href="${escapeHtml(source.url)}" target="_blank" rel="noreferrer">${escapeHtml(source.label)}</a></td><td><span class="source-status ${escapeHtml(source.status)}">${escapeHtml(sourceStatusText[source.status] ?? source.status)}</span></td><td>${escapeHtml(new Date(source.checkedAt).toLocaleString('zh-CN', { timeZone: data.timezone, hour12: false }))}</td><td>${escapeHtml(source.note ?? (source.latencyMs ? `${source.latencyMs} ms` : '—'))}</td></tr>`).join('')
}

async function start() {
  try {
    const response = await fetch('./data/latest.json', { cache: 'no-store' })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    render(await response.json())
  } catch (error) {
    $('#verdict-title').textContent = '数据读取失败'
    $('#verdict-summary').textContent = `无法读取每日快照：${error.message}。请查看 GitHub Actions 更新状态。`
    $('#freshness').textContent = '数据不可用'
  }
}

start()
