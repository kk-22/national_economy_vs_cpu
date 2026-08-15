import type { GameState, ScoreResult, CpuStrategy, GameSeries } from './types'
import type { HistoryEntry } from './history'
import { applyHistoryEntry } from './replay'
import { ALL_BUILDING_CARDS } from './primitives'

export interface FacilityUsage {
  name: string
  count: number
}

export interface PlaySummary {
  date: number
  series: GameSeries
  rank: number
  totalPlayers: number
  total: number
  money: number
  buildingValue: number
  bonuses: number
  unpaidPenalty: number
  vpScore: number
  actionsPlaced: number
  publicIncomeTotal: number
  soldBuildingValueTotal: number
  drawnBuildingCount: number
  drawnConsumptionCount: number
  topFacilities: FacilityUsage[]
  finalBuildings: FacilityUsage[]
  moneyByRound: number[]
  turnOrder: number
  opponents: { count: number; strategies: CpuStrategy[] }
}

// プレイ内容にかかわらず必ず使うことになり分析価値がないため集計対象から除外
const EXCLUDED_FACILITIES = new Set(['大工'])
const TOP_FACILITIES_LIMIT = 10

function groupByName(names: string[]): FacilityUsage[] {
  const counts = new Map<string, number>()
  for (const name of names) counts.set(name, (counts.get(name) ?? 0) + 1)
  return [...counts.entries()].map(([name, count]) => ({ name, count }))
}

function sortFacilities(usages: FacilityUsage[]): FacilityUsage[] {
  return [...usages].sort((a, b) => {
    if (b.count !== a.count) return b.count - a.count
    const costA = ALL_BUILDING_CARDS[a.name]?.cost ?? 0
    const costB = ALL_BUILDING_CARDS[b.name]?.cost ?? 0
    return costB - costA
  })
}

export function computePlaySummary(
  initialState: GameState,
  actionLog: HistoryEntry[],
  finalState: GameState,
  finalScores: ScoreResult[],
): PlaySummary | null {
  const humanId = initialState.players.find(p => !p.isCpu)?.id
  if (humanId === undefined) return null

  const facilityCounts = new Map<string, number>()
  let publicIncomeTotal = 0
  let soldBuildingValueTotal = 0
  let drawnBuildingCount = 0
  let drawnConsumptionCount = 0
  const moneyByRound: number[] = []

  let prev = initialState
  for (const entry of actionLog) {
    const next = applyHistoryEntry(prev, entry)

    if (entry.playerId === humanId) {
      const prevHuman = prev.players.find(p => p.id === humanId)

      if (entry.targetId !== '__hand-limit__' && entry.targetId !== '__sell__') {
        const wp = prev.publicWorkplaces.find(w => w.id === entry.targetId)
        const ownedB = prevHuman?.ownedBuildings.find(b => b.id === entry.targetId)
        const name = wp?.name ?? ownedB?.name
        if (name && !EXCLUDED_FACILITIES.has(name)) {
          facilityCounts.set(name, (facilityCounts.get(name) ?? 0) + 1)
        }
        if (wp && wp.effect.kind === 'discard-gain') {
          publicIncomeTotal += wp.effect.gain
        }
      }

      if (entry.targetId === '__sell__') {
        for (const bId of entry.soldBuildingIds ?? []) {
          const b = prevHuman?.ownedBuildings.find(ob => ob.id === bId)
          if (b) soldBuildingValueTotal += ALL_BUILDING_CARDS[b.name]?.assetValue ?? 0
        }
      }

      const prevHandIds = new Set(prevHuman?.hand.map(c => c.id) ?? [])
      const nextHand = next.players.find(p => p.id === humanId)?.hand ?? []
      for (const c of nextHand) {
        if (!prevHandIds.has(c.id)) {
          if (c.kind === 'building') drawnBuildingCount++
          else drawnConsumptionCount++
        }
      }
    }

    if (next.round !== prev.round) {
      moneyByRound[prev.round - 1] = prev.players.find(p => p.id === humanId)?.money ?? 0
    }

    prev = next
  }

  const topFacilities = sortFacilities(
    [...facilityCounts.entries()].map(([name, count]) => ({ name, count })).filter(f => f.count > 1),
  ).slice(0, TOP_FACILITIES_LIMIT)

  const finalHuman = finalState.players.find(p => p.id === humanId)
  const finalBuildings = sortFacilities(groupByName(finalHuman?.ownedBuildings.map(b => b.name) ?? []))

  const humanScore = finalScores.find(sc => sc.playerId === humanId)
  if (!humanScore) return null
  const rank = 1 + finalScores.filter(sc => sc.total > humanScore.total).length

  const cpuPlayers = initialState.players.filter(p => p.isCpu)
  const playerCount = initialState.players.length
  const humanIndex = initialState.players.findIndex(p => p.id === humanId)
  const turnOrder = ((humanIndex - initialState.startPlayerIndex + playerCount) % playerCount) + 1

  return {
    date: Date.now(),
    series: initialState.series,
    rank,
    totalPlayers: finalScores.length,
    total: humanScore.total,
    money: humanScore.money,
    buildingValue: humanScore.buildingValue,
    bonuses: humanScore.bonuses,
    unpaidPenalty: humanScore.unpaidPenalty,
    vpScore: humanScore.vpScore,
    actionsPlaced: humanScore.actionsPlaced,
    publicIncomeTotal,
    soldBuildingValueTotal,
    drawnBuildingCount,
    drawnConsumptionCount,
    topFacilities,
    finalBuildings,
    moneyByRound,
    turnOrder,
    opponents: { count: cpuPlayers.length, strategies: cpuPlayers.map(p => p.cpuStrategy) },
  }
}
