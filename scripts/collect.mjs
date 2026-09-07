import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { evaluateDecision } from './decision.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const config = JSON.parse(await fs.readFile(path.join(root, 'config', 'monitor.json'), 'utf8'))
const dataDir = path.join(root, 'site', 'data')
const latestPath = path.join(dataDir, 'latest.json')
const historyPath = path.join(dataDir, 'history.json')
const generatedAt = new Date().toISOString()
const date = generatedAt.slice(0, 10)
const sourceHealth = []

const urls = {
  ponsAnalytics: 'https://www.ponsfamily.com/api/pons-analytics?v=dune-v2',
  ponsBuyback: 'https://www.ponsfamily.com/api/pons-buyback-status?v=buyback-v1',
  coinGecko: 'https://api.coingecko.com/api/v3/coins/pons',
  dexScreener: `https://api.dexscreener.com/latest/dex/tokens/${config.contracts.ponsToken}`,
  binanceDepth: 'https://fapi.binance.com/fapi/v1/depth?symbol=PONSUSDT&limit=1000',
  binancePremium: 'https://fapi.binance.com/fapi/v1/premiumIndex?symbol=PONSUSDT',
  binanceOi: 'https://fapi.binance.com/fapi/v1/openInterest?symbol=PONSUSDT',
  kucoinDepth: 'https://api.kucoin.com/api/v1/market/orderbook/level2_100?symbol=PONS-USDT',
}

function finiteOrNull(value) {
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

function sum(values) {
  return values.reduce((total, value) => total + (finiteOrNull(value) ?? 0), 0)
}

function ratio(numerator, denominator, multiplier = 1) {
  return Number.isFinite(numerator) && Number.isFinite(denominator) && denominator !== 0 ? (numerator / denominator) * multiplier : null
}

function normalizeAddress(value) {
  if (typeof value !== 'string' || value.length < 40) return null
  return `0x${value.replace(/^0x/, '').slice(-40)}`
}

async function fetchJson(key, label, url, options = {}) {
  const started = Date.now()
  try {
    const response = await fetch(url, {
      ...options,
      headers: { 'user-agent': 'PONS-Investment-Monitor/1.0', accept: 'application/json', ...(options.headers ?? {}) },
      signal: AbortSignal.timeout(30_000),
    })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const payload = await response.json()
    sourceHealth.push({ key, label, url, status: 'current', checkedAt: generatedAt, latencyMs: Date.now() - started, note: null })
    return payload
  } catch (error) {
    sourceHealth.push({ key, label, url, status: 'failed', checkedAt: generatedAt, latencyMs: Date.now() - started, note: error.message })
    return null
  }
}

async function rpc(method, params, attempt = 0) {
  const response = await fetch(config.chain.rpc, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'user-agent': 'PONS-Investment-Monitor/1.0' },
    body: JSON.stringify({ jsonrpc: '2.0', id: Math.floor(Math.random() * 1_000_000), method, params }),
    signal: AbortSignal.timeout(30_000),
  })
  if ((response.status === 429 || response.status >= 500) && attempt < 4) {
    await new Promise((resolve) => setTimeout(resolve, 700 * 2 ** attempt))
    return rpc(method, params, attempt + 1)
  }
  if (!response.ok) throw new Error(`${method}: HTTP ${response.status}`)
  const payload = await response.json()
  if (payload.error) {
    if (attempt < 3 && /limit|rate|busy|timeout/i.test(payload.error.message ?? '')) {
      await new Promise((resolve) => setTimeout(resolve, 700 * 2 ** attempt))
      return rpc(method, params, attempt + 1)
    }
    throw new Error(`${method}: ${payload.error.message ?? JSON.stringify(payload.error)}`)
  }
  return payload.result
}

async function rpcSafe(key, task) {
  try {
    return await task()
  } catch (error) {
    sourceHealth.push({ key, label: 'Robinhood Chain RPC', url: config.chain.rpc, status: 'failed', checkedAt: generatedAt, latencyMs: null, note: error.message })
    return null
  }
}

async function selector(signature) {
  const encoded = `0x${Buffer.from(signature, 'utf8').toString('hex')}`
  return (await rpc('web3_sha3', [encoded])).slice(0, 10)
}

async function ethCall(address, signature, encodedArgs = '') {
  return rpc('eth_call', [{ to: address, data: `${await selector(signature)}${encodedArgs}` }, 'latest'])
}

function words(hex) {
  if (!hex || hex === '0x') return []
  const clean = hex.replace(/^0x/, '')
  return Array.from({ length: Math.floor(clean.length / 64) }, (_, index) => BigInt(`0x${clean.slice(index * 64, (index + 1) * 64)}`))
}

function addressArg(address) {
  return address.toLowerCase().replace(/^0x/, '').padStart(64, '0')
}

function formatUnits(raw, decimals = 18) {
  if (raw === null || raw === undefined) return null
  const value = typeof raw === 'bigint' ? raw : BigInt(raw)
  const divisor = 10n ** BigInt(decimals)
  const whole = value / divisor
  const fraction = (value % divisor).toString().padStart(decimals, '0').slice(0, 8).replace(/0+$/, '')
  return Number(`${whole}${fraction ? `.${fraction}` : ''}`)
}

function parseLlama(payload) {
  if (!payload) return { d1: null, d7: null, d30: null, previous7: null, previous30: null, allTime: null, series: [] }
  const series = Array.isArray(payload.totalDataChart)
    ? payload.totalDataChart.map(([timestamp, value]) => ({ date: new Date(Number(timestamp) * 1000).toISOString().slice(0, 10), value: finiteOrNull(value) ?? 0 }))
    : []
  const values = series.map((point) => point.value)
  const window = (days, offset = 0) => values.length >= days + offset ? sum(values.slice(values.length - days - offset, values.length - offset || undefined)) : null
  return {
    d1: finiteOrNull(payload.total24h) ?? window(1),
    d7: finiteOrNull(payload.total7d) ?? window(7),
    d30: finiteOrNull(payload.total30d) ?? window(30),
    previous7: window(7, 7),
    previous30: window(30, 30),
    allTime: finiteOrNull(payload.totalAllTime),
    series,
  }
}

function mergeSeries(...sets) {
  const rows = new Map()
  sets.forEach(({ key, series }) => {
    series.forEach((point) => {
      const row = rows.get(point.date) ?? { date: point.date }
      row[key] = point.value
      rows.set(point.date, row)
    })
  })
  return Array.from(rows.values()).sort((a, b) => a.date.localeCompare(b.date)).slice(-90)
}

function depthWithin(book, referencePrice, pct = 0.02) {
  if (!book || !Number.isFinite(referencePrice)) return { bidsUsd: null, asksUsd: null, totalUsd: null }
  const bidFloor = referencePrice * (1 - pct)
  const askCeiling = referencePrice * (1 + pct)
  const bidsUsd = sum((book.bids ?? []).filter(([price]) => Number(price) >= bidFloor).map(([price, qty]) => Number(price) * Number(qty)))
  const asksUsd = sum((book.asks ?? []).filter(([price]) => Number(price) <= askCeiling).map(([price, qty]) => Number(price) * Number(qty)))
  return { bidsUsd, asksUsd, totalUsd: bidsUsd + asksUsd }
}

async function blockAtOrBefore(timestampSeconds, latestBlock) {
  let low = Math.max(0, latestBlock - 200_000)
  let high = latestBlock
  while (low < high) {
    const mid = Math.ceil((low + high) / 2)
    const block = await rpc('eth_getBlockByNumber', [`0x${mid.toString(16)}`, false])
    const timestamp = Number(BigInt(block.timestamp))
    if (timestamp <= timestampSeconds) low = mid
    else high = mid - 1
  }
  return low
}

async function getLogsChunked(filter, fromBlock, toBlock, chunkSize = 5000) {
  const chunks = []
  for (let start = fromBlock; start <= toBlock; start += chunkSize) {
    chunks.push([start, Math.min(toBlock, start + chunkSize - 1)])
  }
  const output = []
  for (const [start, end] of chunks) {
    const logs = await rpc('eth_getLogs', [{ ...filter, fromBlock: `0x${start.toString(16)}`, toBlock: `0x${end.toString(16)}` }])
    output.push(...logs)
    await new Promise((resolve) => setTimeout(resolve, 180))
  }
  return output
}

async function collectRpcState() {
  const started = Date.now()
  try {
    const [blockHex, supplyHex, deadHex, factoryOwnerHex, hookOwnerHex, sweepHex, feePolicyHex] = await Promise.all([
      rpc('eth_blockNumber', []),
      ethCall(config.contracts.ponsToken, 'totalSupply()'),
      ethCall(config.contracts.ponsToken, 'balanceOf(address)', addressArg(config.contracts.dead)),
      ethCall(config.contracts.v2Factory, 'owner()'),
      ethCall(config.contracts.v2Hook, 'owner()'),
      ethCall(config.contracts.v2Hook, 'feeSweepOperator()'),
      ethCall(config.contracts.v2Hook, 'currentFeePolicy()'),
    ])
    const feeWords = words(feePolicyHex)
    sourceHealth.push({ key: 'robinhood_rpc', label: 'Robinhood Chain RPC', url: config.chain.rpc, status: 'current', checkedAt: generatedAt, latencyMs: Date.now() - started, note: null })
    return {
      block: Number(BigInt(blockHex)),
      totalSupplyTokens: formatUnits(BigInt(supplyHex)),
      deadBalanceTokens: formatUnits(BigInt(deadHex)),
      factoryOwner: normalizeAddress(factoryOwnerHex),
      hookOwner: normalizeAddress(hookOwnerHex),
      sweepOperator: normalizeAddress(sweepHex),
      feePolicy: feeWords.length >= 5 ? {
        protocolFeeRecipient: normalizeAddress(`0x${feeWords[0].toString(16).padStart(64, '0')}`),
        protocolFeeShareBps: Number(feeWords[1]),
        buybackBurnBps: Number(feeWords[2]),
        hookFeeBps: Number(feeWords[3]),
        maxInternalPriceImpactBps: Number(feeWords[4]),
      } : null,
    }
  } catch (error) {
    sourceHealth.push({ key: 'robinhood_rpc', label: 'Robinhood Chain RPC', url: config.chain.rpc, status: 'failed', checkedAt: generatedAt, latencyMs: Date.now() - started, note: error.message })
    return null
  }
}

async function collectOnchainActivity(rpcState) {
  if (!rpcState?.block) return { poolsLaunches24h: null, largeTransfers: [], scannedBlocks: 0, quality: 'missing' }
  try {
    const targetTimestamp = Math.floor(Date.now() / 1000) - 86_400
    const from24h = await blockAtOrBefore(targetTimestamp, rpcState.block)
    const poolsLogsPromise = getLogsChunked({ address: config.contracts.poolsTokenFactory, topics: [config.topics.poolsTokenCreated] }, from24h, rpcState.block)
    const transferFrom = Math.max(from24h, rpcState.block - 12_000)
    const transferLogsPromise = getLogsChunked({ address: config.contracts.ponsToken, topics: [config.topics.erc20Transfer] }, transferFrom, rpcState.block)
    const [poolsLogs, transferLogs] = await Promise.all([poolsLogsPromise, transferLogsPromise])
    const supply = rpcState.totalSupplyTokens ?? 0
    const thresholdTokens = supply * ((config.thresholds.largeTransferSupplyPct ?? 0.1) / 100)
    const largeTransfers = transferLogs.map((log) => ({
      blockNumber: Number(BigInt(log.blockNumber)),
      txHash: log.transactionHash,
      from: normalizeAddress(log.topics?.[1]),
      to: normalizeAddress(log.topics?.[2]),
      amountTokens: formatUnits(BigInt(log.data)),
    })).filter((transfer) => transfer.amountTokens >= thresholdTokens).sort((a, b) => b.amountTokens - a.amountTokens).slice(0, 20)
    return { poolsLaunches24h: poolsLogs.length, largeTransfers, scannedBlocks: rpcState.block - transferFrom + 1, quality: 'partial' }
  } catch (error) {
    sourceHealth.push({ key: 'robinhood_logs', label: 'Robinhood Chain logs', url: config.chain.rpc, status: 'partial', checkedAt: generatedAt, latencyMs: null, note: error.message })
    return { poolsLaunches24h: null, largeTransfers: [], scannedBlocks: 0, quality: 'missing' }
  }
}

async function loadHistory() {
  try {
    const payload = JSON.parse(await fs.readFile(historyPath, 'utf8'))
    return Array.isArray(payload) ? payload : []
  } catch {
    return []
  }
}

const llama = (slug, type) => fetchJson(`llama_${slug}_${type}`, `DefiLlama ${slug} ${type}`, `https://api.llama.fi/summary/fees/${slug}?dataType=${type}`)
const [
  ponsAnalytics,
  ponsBuyback,
  coinGecko,
  dexScreener,
  binanceDepth,
  binancePremium,
  binanceOi,
  kucoinDepth,
  v1RevenueRaw,
  v1FeesRaw,
  v1HoldersRaw,
  v2RevenueRaw,
  v2FeesRaw,
  rpcState,
] = await Promise.all([
  fetchJson('pons_analytics', 'Pons Analytics', urls.ponsAnalytics),
  fetchJson('pons_buyback', 'Pons Buyback Status', urls.ponsBuyback),
  fetchJson('coingecko', 'CoinGecko', urls.coinGecko),
  fetchJson('dexscreener', 'DexScreener', urls.dexScreener),
  fetchJson('binance_depth', 'Binance Futures depth', urls.binanceDepth),
  fetchJson('binance_premium', 'Binance Futures premium', urls.binancePremium),
  fetchJson('binance_oi', 'Binance Futures open interest', urls.binanceOi),
  fetchJson('kucoin_depth', 'KuCoin spot depth', urls.kucoinDepth),
  llama('pons-v1', 'dailyRevenue'),
  llama('pons-v1', 'dailyFees'),
  llama('pons-v1', 'dailyHoldersRevenue'),
  llama('pons-v2', 'dailyRevenue'),
  llama('pons-v2', 'dailyFees'),
  collectRpcState(),
])

sourceHealth.push({
  key: 'v2_holder_revenue',
  label: 'Pons V2 holder revenue',
  url: 'https://defillama.com/protocol/pons-v2',
  status: 'not_applicable',
  checkedAt: generatedAt,
  latencyMs: null,
  note: 'V2 当前没有 PONS holder-revenue 序列；V2 回购目标是各发行项目代币。',
})

const history = await loadHistory()
const previousSnapshot = history.length > 0 ? history[history.length - 1] : null
const activity = await collectOnchainActivity(rpcState)
const v1Revenue = parseLlama(v1RevenueRaw)
const v1Fees = parseLlama(v1FeesRaw)
const v1Holders = parseLlama(v1HoldersRaw)
const v2Revenue = parseLlama(v2RevenueRaw)
const v2Fees = parseLlama(v2FeesRaw)
const v2Holders = parseLlama(null)

const priceUsd = finiteOrNull(coinGecko?.market_data?.current_price?.usd)
  ?? finiteOrNull(dexScreener?.pairs?.[0]?.priceUsd)
const marketCapUsd = finiteOrNull(coinGecko?.market_data?.market_cap?.usd)
const markPrice = finiteOrNull(binancePremium?.markPrice)
const indexPrice = finiteOrNull(binancePremium?.indexPrice)
const perpDepth = depthWithin(binanceDepth, markPrice ?? priceUsd)
const spotBook = kucoinDepth?.data ? { bids: kucoinDepth.data.bids, asks: kucoinDepth.data.asks } : null
const spotReference = spotBook ? ((Number(spotBook.bids?.[0]?.[0]) + Number(spotBook.asks?.[0]?.[0])) / 2) : priceUsd
const spotDepth = depthWithin(spotBook, spotReference)
const validPairs = (dexScreener?.pairs ?? []).filter((pair) => pair.chainId === 'robinhood' && finiteOrNull(pair.liquidity?.usd) !== null)
const dexLiquidityUsd = sum(validPairs.map((pair) => pair.liquidity.usd))
const dexVolume24hUsd = sum(validPairs.map((pair) => pair.volume?.h24))

const protocolRevenue7dUsd = (v1Revenue.d7 ?? 0) + (v2Revenue.d7 ?? 0)
const protocolRevenue30dUsd = (v1Revenue.d30 ?? 0) + (v2Revenue.d30 ?? 0)
const previousProtocolRevenue7dUsd = Number.isFinite(v1Revenue.previous7) && Number.isFinite(v2Revenue.previous7) ? v1Revenue.previous7 + v2Revenue.previous7 : null
const previousProtocolRevenue30dUsd = Number.isFinite(v1Revenue.previous30) && Number.isFinite(v2Revenue.previous30) ? v1Revenue.previous30 + v2Revenue.previous30 : null
const fees7dUsd = (v1Fees.d7 ?? 0) + (v2Fees.d7 ?? 0)
const fees30dUsd = (v1Fees.d30 ?? 0) + (v2Fees.d30 ?? 0)
const holderRevenue30dUsd = (v1Holders.d30 ?? 0) + (v2Holders.d30 ?? 0)
const creatorRevenue7dUsd = Number.isFinite(fees7dUsd) && Number.isFinite(protocolRevenue7dUsd) ? Math.max(0, fees7dUsd - protocolRevenue7dUsd) : null
const creatorRevenue30dUsd = Number.isFinite(fees30dUsd) && Number.isFinite(protocolRevenue30dUsd) ? Math.max(0, fees30dUsd - protocolRevenue30dUsd) : null
const deadBalanceTokens = rpcState?.deadBalanceTokens ?? null
const previousDead = previousSnapshot?.capture?.deadBalanceTokens ?? null
const deadBalanceDeltaTokens = Number.isFinite(deadBalanceTokens) && Number.isFinite(previousDead) ? deadBalanceTokens - previousDead : null
const pendingBuybackUsd = finiteOrNull(ponsBuyback?.unclaimedUsd)
const ponsLaunches24h = finiteOrNull(ponsAnalytics?.totals?.launches24h)
const poolsLaunches24h = activity.poolsLaunches24h

const snapshot = {
  schemaVersion: 1,
  generatedAt,
  date,
  timezone: config.timezone,
  chain: { ...config.chain, block: rpcState?.block ?? null },
  market: {
    priceUsd,
    priceChange24hPct: finiteOrNull(coinGecko?.market_data?.price_change_percentage_24h),
    marketCapUsd,
    fullyDilutedValueUsd: finiteOrNull(coinGecko?.market_data?.fully_diluted_valuation?.usd),
    circulatingSupplyTokens: finiteOrNull(coinGecko?.market_data?.circulating_supply),
    totalSupplyTokens: rpcState?.totalSupplyTokens ?? finiteOrNull(coinGecko?.market_data?.total_supply),
    volume24hUsd: finiteOrNull(coinGecko?.market_data?.total_volume?.usd),
    marketCapRank: finiteOrNull(coinGecko?.market_cap_rank),
    spotDepth2PctUsd: spotDepth.totalUsd,
    spotBidDepth2PctUsd: spotDepth.bidsUsd,
    spotAskDepth2PctUsd: spotDepth.asksUsd,
    perpDepth2PctUsd: perpDepth.totalUsd,
    perpBidDepth2PctUsd: perpDepth.bidsUsd,
    perpAskDepth2PctUsd: perpDepth.asksUsd,
    depth2PctUsd: Number.isFinite(spotDepth.totalUsd) || Number.isFinite(perpDepth.totalUsd) ? (spotDepth.totalUsd ?? 0) + (perpDepth.totalUsd ?? 0) : null,
    dexLiquidityUsd,
    dexVolume24hUsd,
    dexPairCount: validPairs.length,
    fundingRatePct: finiteOrNull(binancePremium?.lastFundingRate) !== null ? Number(binancePremium.lastFundingRate) * 100 : null,
    openInterestTokens: finiteOrNull(binanceOi?.openInterest),
    openInterestUsd: finiteOrNull(binanceOi?.openInterest) !== null && Number.isFinite(markPrice) ? Number(binanceOi.openInterest) * markPrice : null,
    basisPct: Number.isFinite(markPrice) && Number.isFinite(indexPrice) ? ratio(markPrice - indexPrice, indexPrice, 100) : null,
    liquidations24hUsd: null,
  },
  revenue: {
    protocolRevenue7dUsd,
    protocolRevenue30dUsd,
    previousProtocolRevenue7dUsd,
    previousProtocolRevenue30dUsd,
    fees7dUsd,
    fees30dUsd,
    creatorRevenue7dUsd,
    creatorRevenue30dUsd,
    holderRevenue30dUsd,
    v1Revenue7dUsd: v1Revenue.d7,
    v1Revenue30dUsd: v1Revenue.d30,
    v2Revenue7dUsd: v2Revenue.d7,
    v2Revenue30dUsd: v2Revenue.d30,
    v1HolderRevenue30dUsd: v1Holders.d30,
    v2HolderRevenue30dUsd: v2Holders.d30,
    v2RevenueShare30dPct: ratio(v2Revenue.d30, protocolRevenue30dUsd, 100),
    cumulativeProtocolRevenueUsd: finiteOrNull(ponsAnalytics?.totals?.protocolRevenueUsd),
    cumulativeCreatorEarningsUsd: finiteOrNull(ponsAnalytics?.totals?.creatorEarningsUsd),
    annualizedProtocolRevenueYieldPct: ratio(protocolRevenue30dUsd * 12, marketCapUsd, 100),
    annualizedHolderRevenueYieldPct: ratio(holderRevenue30dUsd * 12, marketCapUsd, 100),
    marketCapToAnnualizedProtocolRevenue: ratio(marketCapUsd, protocolRevenue30dUsd * 12),
    marketCapToAnnualizedHolderRevenue: ratio(marketCapUsd, holderRevenue30dUsd * 12),
    holderCaptureToProtocolRevenuePct: ratio(holderRevenue30dUsd, protocolRevenue30dUsd, 100),
    series: mergeSeries(
      { key: 'v1RevenueUsd', series: v1Revenue.series },
      { key: 'v2RevenueUsd', series: v2Revenue.series },
      { key: 'v1FeesUsd', series: v1Fees.series },
      { key: 'v2FeesUsd', series: v2Fees.series },
    ),
  },
  capture: {
    deadBalanceTokens,
    deadBalancePct: ratio(deadBalanceTokens, rpcState?.totalSupplyTokens, 100),
    deadBalanceDeltaTokens,
    deadBalanceDeltaUsd: Number.isFinite(deadBalanceDeltaTokens) && Number.isFinite(priceUsd) ? deadBalanceDeltaTokens * priceUsd : null,
    attributedBuyback30dUsd: null,
    pendingBuybackUsd,
    pendingBuybackToRevenue30dPct: ratio(pendingBuybackUsd, protocolRevenue30dUsd, 100),
    splitterValueUsd: finiteOrNull(ponsBuyback?.splitter?.valueUsd),
    intakeValueUsd: finiteOrNull(ponsBuyback?.intake?.valueUsd),
    escrowValueUsd: finiteOrNull(ponsBuyback?.escrow?.valueUsd),
    note: '死地址增量仅表示通缩变化；完成交易路径归因前不计为协议回购。',
  },
  activity: {
    ponsLaunches24h,
    poolsLaunches24h,
    ponsIssuanceShareProvisionalPct: Number.isFinite(ponsLaunches24h) && Number.isFinite(poolsLaunches24h) ? ratio(ponsLaunches24h, ponsLaunches24h + poolsLaunches24h, 100) : null,
    issuanceShareQuality: Number.isFinite(ponsLaunches24h) && Number.isFinite(poolsLaunches24h) ? 'partial_mixed_window' : 'missing',
    launchesAllTime: finiteOrNull(ponsAnalytics?.totals?.launchesAllTime),
    volumeAllTimeUsd: finiteOrNull(ponsAnalytics?.totals?.volumeUsdAllTime),
    curveVolume30dUsd: null,
    postGraduationVolume30dUsd: null,
    ponsTradeShare30dPct: null,
    poolsTradeShare30dPct: null,
  },
  retention: {
    uniqueCreators30d: null,
    uniqueCreatorsAllTime: finiteOrNull(ponsAnalytics?.totals?.uniqueDevelopers),
    creatorRepeatRate30dPct: null,
    graduationRate30dPct: null,
    graduatedProjectD7RetentionPct: null,
    top10ProjectVolumeSharePct: null,
    botVolumeSharePct: null,
    newUserShare30dPct: null,
  },
  holders: {
    holderCount: null,
    top10ConcentrationPct: null,
    top50ConcentrationPct: null,
    exchangeNetflow24hTokens: null,
    largeTransfers: activity.largeTransfers,
    largeTransferScanBlocks: activity.scannedBlocks,
    largeTransferQuality: activity.quality,
  },
  security: {
    factoryOwner: rpcState?.factoryOwner ?? null,
    hookOwner: rpcState?.hookOwner ?? null,
    sweepOperator: rpcState?.sweepOperator ?? null,
    feePolicy: rpcState?.feePolicy ?? null,
    auditStatus: config.manual.auditStatus,
    auditReviewedAt: config.manual.auditReviewedAt,
    auditEvidenceUrl: config.manual.auditEvidenceUrl,
    regionStatus: config.manual.regionStatus,
    regionEvidenceUrl: config.manual.regionEvidenceUrl,
  },
  sourceHealth,
  dataNotes: [
    'Pons 官方 Analytics 最新日若成交为 0，将视为异常值，不用于趋势判断。',
    'Creator 复发、毕业率、D7 留存、项目 Top10 集中度和成交份额需要 Bitquery 或 Dune 明细权限。',
    '持币集中度等待稳定的 Robinhood Chain 索引器接口；当前不以推测值替代。',
  ],
}

const decision = evaluateDecision(snapshot, previousSnapshot, config.thresholds)
snapshot.decision = decision
snapshot.alerts = decision.alerts

const historyEntry = {
  date,
  generatedAt,
  market: snapshot.market,
  revenue: { ...snapshot.revenue, series: undefined },
  capture: snapshot.capture,
  activity: snapshot.activity,
  retention: snapshot.retention,
  holders: snapshot.holders,
  security: snapshot.security,
  decision: snapshot.decision,
}

const withoutSameDay = history.filter((entry) => entry.date !== date)
const nextHistory = [...withoutSameDay, historyEntry].sort((a, b) => a.date.localeCompare(b.date)).slice(-365)
await fs.mkdir(dataDir, { recursive: true })
await fs.writeFile(latestPath, `${JSON.stringify(snapshot, null, 2)}\n`)
await fs.writeFile(historyPath, `${JSON.stringify(nextHistory, null, 2)}\n`)

console.log(JSON.stringify({
  generatedAt,
  decision: decision.label,
  coveragePct: Number(decision.coveragePct.toFixed(1)),
  sources: { current: sourceHealth.filter((source) => source.status === 'current').length, failed: sourceHealth.filter((source) => source.status === 'failed').length },
  alerts: decision.alerts.length,
}, null, 2))
