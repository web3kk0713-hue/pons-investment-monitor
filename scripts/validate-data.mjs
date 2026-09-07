import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const latest = JSON.parse(await fs.readFile(path.join(root, 'site', 'data', 'latest.json'), 'utf8'))
const history = JSON.parse(await fs.readFile(path.join(root, 'site', 'data', 'history.json'), 'utf8'))
const errors = []

if (latest.schemaVersion !== 1) errors.push('schemaVersion must be 1')
if (!Number.isFinite(Date.parse(latest.generatedAt))) errors.push('generatedAt must be an ISO timestamp')
if (!['event_watch', 'fundamental_allocation', 'risk_downgrade'].includes(latest.decision?.status)) errors.push('decision.status is invalid')
if (!Array.isArray(latest.sourceHealth) || latest.sourceHealth.length === 0) errors.push('sourceHealth must not be empty')
if (!Array.isArray(latest.revenue?.series)) errors.push('revenue.series must be an array')
if (!Array.isArray(history) || history.length === 0) errors.push('history must contain at least one snapshot')
if (latest.market?.priceUsd !== null && latest.market.priceUsd <= 0) errors.push('priceUsd must be positive')
if (latest.market?.marketCapUsd !== null && latest.market.marketCapUsd <= 0) errors.push('marketCapUsd must be positive')
if (latest.capture?.deadBalancePct !== null && (latest.capture.deadBalancePct < 0 || latest.capture.deadBalancePct > 100)) errors.push('deadBalancePct must be within 0..100')
if (latest.decision?.coveragePct < 0 || latest.decision?.coveragePct > 100) errors.push('coveragePct must be within 0..100')

if (errors.length > 0) {
  console.error(errors.join('\n'))
  process.exit(1)
}

console.log(`Validated ${latest.date}: ${latest.sourceHealth.length} sources, ${history.length} daily snapshot(s).`)
