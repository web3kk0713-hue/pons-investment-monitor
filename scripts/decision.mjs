export const REQUIRED_METRICS = [
  ['价值捕获', 'revenue.protocolRevenue7dUsd'],
  ['价值捕获', 'revenue.protocolRevenue30dUsd'],
  ['价值捕获', 'capture.deadBalanceTokens'],
  ['价值捕获', 'capture.attributedBuyback30dUsd'],
  ['留存', 'retention.uniqueCreators30d'],
  ['留存', 'retention.creatorRepeatRate30dPct'],
  ['留存', 'retention.graduationRate30dPct'],
  ['留存', 'retention.graduatedProjectD7RetentionPct'],
  ['留存', 'retention.top10ProjectVolumeSharePct'],
  ['安全', 'security.factoryOwner'],
  ['安全', 'security.hookOwner'],
  ['安全', 'security.sweepOperator'],
  ['安全', 'security.auditStatus'],
  ['流动性', 'market.depth2PctUsd'],
  ['流动性', 'market.dexLiquidityUsd'],
  ['流动性', 'market.fundingRatePct'],
]

function getPath(object, path) {
  return path.split('.').reduce((value, key) => value?.[key], object)
}

function hasValue(value) {
  return value !== null && value !== undefined && value !== ''
}

function changePct(current, previous) {
  if (!Number.isFinite(current) || !Number.isFinite(previous) || previous === 0) return null
  return ((current - previous) / Math.abs(previous)) * 100
}

export function evaluateDecision(snapshot, previousSnapshot = null, thresholds = {}) {
  const covered = REQUIRED_METRICS.filter(([, path]) => hasValue(getPath(snapshot, path))).length
  const coveragePct = (covered / REQUIRED_METRICS.length) * 100
  const alerts = []

  const revenue7ChangePct = changePct(snapshot.revenue.protocolRevenue7dUsd, snapshot.revenue.previousProtocolRevenue7dUsd)
  const revenue30ChangePct = changePct(snapshot.revenue.protocolRevenue30dUsd, snapshot.revenue.previousProtocolRevenue30dUsd)
  const deadDelta = snapshot.capture.deadBalanceDeltaTokens
  const attributedBuyback = snapshot.capture.attributedBuyback30dUsd

  let valueState = 'unknown'
  const valueReasons = []
  if (revenue7ChangePct !== null) valueReasons.push(`7日协议收入环比${revenue7ChangePct >= 0 ? '增加' : '减少'} ${Math.abs(revenue7ChangePct).toFixed(1)}%`)
  if (revenue30ChangePct !== null) valueReasons.push(`30日协议收入较前窗${revenue30ChangePct >= 0 ? '增加' : '减少'} ${Math.abs(revenue30ChangePct).toFixed(1)}%`)
  if (attributedBuyback === null) valueReasons.push('尚无可归因到协议路径的 PONS 回购金额')
  if (deadDelta !== null && deadDelta > 0) valueReasons.push(`死地址较上次增加 ${deadDelta.toLocaleString('en-US', { maximumFractionDigits: 0 })} PONS，但归因仍待验证`)
  if (revenue7ChangePct !== null && revenue30ChangePct !== null && attributedBuyback !== null) {
    valueState = revenue7ChangePct > 0 && revenue30ChangePct >= 0 && attributedBuyback > 0 ? 'improving' : 'not_improving'
  }

  if ((snapshot.revenue.v2RevenueShare30dPct ?? 0) > 50 && (snapshot.revenue.v2HolderRevenue30dUsd ?? 0) === 0) {
    alerts.push({
      severity: 'high',
      code: 'V2_CAPTURE_GAP',
      title: 'V2 增长没有直接回流 PONS',
      detail: 'V2 已贡献多数协议收入，但当前未观察到 V2 对 PONS 持有人的直接收入。',
    })
  }

  const retentionFields = [
    snapshot.retention.creatorRepeatRate30dPct,
    snapshot.retention.graduationRate30dPct,
    snapshot.retention.graduatedProjectD7RetentionPct,
    snapshot.retention.top10ProjectVolumeSharePct,
  ]
  let retentionState = 'unknown'
  const retentionReasons = []
  if (retentionFields.some((value) => value === null)) {
    retentionReasons.push('creator 复发、毕业 D7 留存或项目集中度仍缺实时可比数据')
  } else if (previousSnapshot) {
    const repeatUp = snapshot.retention.creatorRepeatRate30dPct > previousSnapshot.retention.creatorRepeatRate30dPct
    const d7Up = snapshot.retention.graduatedProjectD7RetentionPct > previousSnapshot.retention.graduatedProjectD7RetentionPct
    const qualityOkay = snapshot.retention.graduationRate30dPct >= (thresholds.minGraduationRatePct ?? 1.5)
    const concentrationOkay = snapshot.retention.top10ProjectVolumeSharePct <= (thresholds.maxTop10VolumeSharePct ?? 55)
    retentionState = repeatUp && d7Up && qualityOkay && concentrationOkay ? 'improving' : 'not_improving'
    retentionReasons.push(repeatUp && d7Up ? '复发率与 D7 留存同步改善' : '复发率与 D7 留存未同步改善')
  } else {
    retentionReasons.push('需要至少两个每日快照才能判断留存趋势')
  }

  let securityState = 'unknown'
  const securityReasons = []
  let securityRisk = false
  if (previousSnapshot) {
    const changed = [
      ['Factory owner', snapshot.security.factoryOwner, previousSnapshot.security.factoryOwner],
      ['Hook owner', snapshot.security.hookOwner, previousSnapshot.security.hookOwner],
      ['Sweep operator', snapshot.security.sweepOperator, previousSnapshot.security.sweepOperator],
    ].filter(([, current, previous]) => current && previous && current.toLowerCase() !== previous.toLowerCase())
    if (changed.length > 0) {
      securityRisk = true
      securityState = 'risk'
      changed.forEach(([label]) => securityReasons.push(`${label} 较昨日发生变化`))
      alerts.push({ severity: 'critical', code: 'PRIVILEGE_CHANGE', title: '关键权限地址发生变化', detail: changed.map(([label]) => label).join('、') })
    } else if (snapshot.security.auditStatus?.includes('未发现')) {
      securityState = 'not_improving'
      securityReasons.push('权限地址稳定，但仍未发现官方正式审计报告')
    } else {
      securityState = 'improving'
      securityReasons.push('关键权限未变化，审计状态无新增红旗')
    }
  } else {
    securityReasons.push('已建立权限基线；次日开始检测 Owner/operator 变化')
    if (snapshot.security.auditStatus?.includes('未发现')) securityReasons.push('未发现官方正式审计报告')
  }

  let liquidityState = 'unknown'
  const liquidityReasons = []
  let liquidityRisk = false
  if (snapshot.market.depth2PctUsd !== null) {
    liquidityReasons.push(`可观测市场正负2%深度约 $${Math.round(snapshot.market.depth2PctUsd).toLocaleString('en-US')}`)
    if (snapshot.market.depth2PctUsd < (thresholds.minDepth2PctUsd ?? 250000)) {
      liquidityRisk = true
      alerts.push({ severity: 'high', code: 'THIN_DEPTH', title: '正负2%盘口深度低于阈值', detail: '大额交易可能产生明显滑点。' })
    }
  } else if (snapshot.market.observedDepth2PctUsd !== null) {
    liquidityReasons.push(`仅部分市场可用，已观察深度约 $${Math.round(snapshot.market.observedDepth2PctUsd).toLocaleString('en-US')}，不据此触发硬阈值`)
  } else {
    liquidityReasons.push('现货与永续正负2%深度均不可用')
  }
  if (previousSnapshot && snapshot.market.depth2PctUsd !== null && previousSnapshot.market.depth2PctUsd !== null) {
    const depthUp = snapshot.market.depth2PctUsd > previousSnapshot.market.depth2PctUsd
    const top10Current = snapshot.retention.top10ProjectVolumeSharePct
    const top10Previous = previousSnapshot.retention.top10ProjectVolumeSharePct
    if (top10Current !== null && top10Previous !== null) {
      liquidityState = depthUp && top10Current <= top10Previous ? 'improving' : 'not_improving'
      liquidityReasons.push(depthUp ? '盘口深度较昨日改善' : '盘口深度较昨日下降')
    } else {
      liquidityReasons.push('缺 Top10 项目成交集中度，不能完成流动性维度判定')
    }
  } else {
    liquidityReasons.push('需要次日快照与项目集中度数据才能判断改善')
  }

  const generatedMs = Date.parse(snapshot.generatedAt)
  const ageHours = Number.isFinite(generatedMs) ? (Date.now() - generatedMs) / 3_600_000 : Infinity
  const staleRisk = ageHours > 72
  if (staleRisk) alerts.push({ severity: 'critical', code: 'STALE_DATA', title: '监控数据超过72小时未更新', detail: '暂停依据本面板作新增仓位判断。' })

  if (coveragePct < (thresholds.minRequiredCoveragePct ?? 85)) {
    alerts.push({ severity: 'medium', code: 'LOW_COVERAGE', title: '关键指标覆盖不足', detail: `当前覆盖 ${coveragePct.toFixed(0)}%，未达到升级阈值。` })
  }

  const dimensions = {
    valueCapture: { state: valueState, label: '价值捕获', reasons: valueReasons },
    retention: { state: retentionState, label: '留存与质量', reasons: retentionReasons },
    security: { state: securityState, label: '安全与治理', reasons: securityReasons },
    liquidity: { state: liquidityState, label: '流动性', reasons: liquidityReasons },
  }
  const allImproving = Object.values(dimensions).every((dimension) => dimension.state === 'improving')
  const hardRisk = securityRisk || liquidityRisk || staleRisk
  const status = hardRisk ? 'risk_downgrade' : allImproving && coveragePct >= (thresholds.minRequiredCoveragePct ?? 85) ? 'fundamental_allocation' : 'event_watch'

  return {
    status,
    label: status === 'fundamental_allocation' ? '基本面配置' : status === 'risk_downgrade' ? '风险降级' : '事件驱动观察',
    coveragePct,
    coveredRequiredMetrics: covered,
    totalRequiredMetrics: REQUIRED_METRICS.length,
    dimensions,
    alerts,
  }
}
