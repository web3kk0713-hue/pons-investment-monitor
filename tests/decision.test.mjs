import test from 'node:test'
import assert from 'node:assert/strict'
import { evaluateDecision } from '../scripts/decision.mjs'

function snapshot(overrides = {}) {
  return {
    generatedAt: new Date().toISOString(),
    revenue: {
      protocolRevenue7dUsd: 140,
      previousProtocolRevenue7dUsd: 100,
      protocolRevenue30dUsd: 500,
      previousProtocolRevenue30dUsd: 450,
      v2RevenueShare30dPct: 40,
      v2HolderRevenue30dUsd: 10,
    },
    capture: { deadBalanceTokens: 300, deadBalanceDeltaTokens: 10, attributedBuyback30dUsd: 20 },
    retention: { uniqueCreators30d: 100, creatorRepeatRate30dPct: 30, graduationRate30dPct: 2, graduatedProjectD7RetentionPct: 25, top10ProjectVolumeSharePct: 40 },
    security: { factoryOwner: '0x1', hookOwner: '0x2', sweepOperator: '0x3', auditStatus: '审计完成' },
    market: { depth2PctUsd: 500000, dexLiquidityUsd: 1000000, fundingRatePct: 0.01 },
    ...overrides,
  }
}

test('upgrades only when all four dimensions improve and coverage is complete', () => {
  const previous = snapshot({
    retention: { uniqueCreators30d: 90, creatorRepeatRate30dPct: 20, graduationRate30dPct: 2, graduatedProjectD7RetentionPct: 20, top10ProjectVolumeSharePct: 45 },
    market: { depth2PctUsd: 400000, dexLiquidityUsd: 900000, fundingRatePct: 0.01 },
  })
  const result = evaluateDecision(snapshot(), previous, { minRequiredCoveragePct: 85, minDepth2PctUsd: 250000 })
  assert.equal(result.status, 'fundamental_allocation')
})

test('missing retention metrics blocks fundamental allocation', () => {
  const current = snapshot({ retention: { uniqueCreators30d: null, creatorRepeatRate30dPct: null, graduationRate30dPct: null, graduatedProjectD7RetentionPct: null, top10ProjectVolumeSharePct: null } })
  const result = evaluateDecision(current, snapshot(), { minRequiredCoveragePct: 85 })
  assert.equal(result.status, 'event_watch')
  assert.equal(result.dimensions.retention.state, 'unknown')
})

test('owner change triggers risk downgrade', () => {
  const current = snapshot({ security: { factoryOwner: '0x9', hookOwner: '0x2', sweepOperator: '0x3', auditStatus: '审计完成' } })
  const result = evaluateDecision(current, snapshot(), { minRequiredCoveragePct: 85 })
  assert.equal(result.status, 'risk_downgrade')
  assert.ok(result.alerts.some((alert) => alert.code === 'PRIVILEGE_CHANGE'))
})

test('partial order-book coverage does not create a false liquidity risk', () => {
  const current = snapshot({ market: { depth2PctUsd: null, observedDepth2PctUsd: 80000, dexLiquidityUsd: 1000000, fundingRatePct: null } })
  const result = evaluateDecision(current, snapshot(), { minRequiredCoveragePct: 85, minDepth2PctUsd: 250000 })
  assert.equal(result.status, 'event_watch')
  assert.ok(!result.alerts.some((alert) => alert.code === 'THIN_DEPTH'))
})
