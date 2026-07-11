import { ROUND_CARDS } from './constants'
import { getPlayer, ALL_BUILDING_CARDS } from './primitives'
import { getAvailablePublicWorkplaces, getAvailableOwnedBuildings } from './availability'
import { scoreEffect, filterDominatedWorkplaces, getPlayerWeights } from './cpu-scoring'
import { placeWorkerOnPublic, placeWorkerOnBuilding, afterAction, afterHumanAction } from './turns'
import type { CpuNoAutoResult } from './turns'
import { cpuTakeTurnRandom, cpuTakeTurnRandomNoAuto } from './cpu-strategy-random'
import type { GameState, BuildingCard, PublicWorkplace, OwnedBuilding } from './types'

export function cpuTakeTurnGreedy(state: GameState, playerId: number): GameState {
  const { pubOptions, bldOptions } = filterDominatedWorkplaces(
    getAvailablePublicWorkplaces(state, playerId),
    getAvailableOwnedBuildings(state, playerId),
  )
  if (pubOptions.length === 0 && bldOptions.length === 0) return afterAction(state)

  const player = getPlayer(state, playerId)
  const weights = getPlayerWeights(playerId)
  const availableWorkers = player.workers.filter(w => !w.isTraining && w.placedAt === null).length
  const pubBonus = availableWorkers >= 2 ? weights.pubBonus : 1.0
  const isStartPlayer = state.players[state.startPlayerIndex]?.id === player.id

  let bestScore = -Infinity
  let bestPub: PublicWorkplace | null = null
  let bestBld: OwnedBuilding | null = null

  const drawKinds = new Set(['draw', 'discard-draw', 'draw-consumption', 'draw-if-empty'])

  for (const wp of pubOptions) {
    const base = scoreEffect(wp.effect, player, state.household, state.round, availableWorkers, isStartPlayer, weights)
    const soldDef = ALL_BUILDING_CARDS[wp.name]
    // 売却建物 かつ draw 系施設 → コスト連動ボーナス（コスト高いほど優先）
    const sc = (soldDef && drawKinds.has(wp.effect.kind))
      ? base * (1.0 + weights.drawPubExtra + soldDef.cost * weights.drawCostMult)
      : base * pubBonus
    if (sc > bestScore) { bestScore = sc; bestPub = wp; bestBld = null }
  }
  for (const bld of bldOptions) {
    const def = ALL_BUILDING_CARDS[bld.name]
    if (!def) continue
    const base = scoreEffect(def.effect, player, state.household, state.round, availableWorkers, isStartPlayer, weights)
    // draw 系施設 → コスト連動ボーナス、build 系等 → pubBonus 適用
    const sc = drawKinds.has(def.effect.kind)
      ? base * (1.0 + def.cost * weights.drawCostMult)
      : base * pubBonus
    if (sc > bestScore) { bestScore = sc; bestBld = bld; bestPub = null }
  }

  // すべて -Infinity ならランダム
  if (bestScore === -Infinity) return cpuTakeTurnRandom(state, playerId)

  if (bestPub) return placeWorkerOnPublic(state, playerId, bestPub.id)
  if (bestBld) return placeWorkerOnBuilding(state, playerId, bestBld.id)
  return afterAction(state)
}

export function cpuTakeTurnGreedyNoAuto(state: GameState, playerId: number, deferRoundEnd = false): CpuNoAutoResult {
  const { pubOptions, bldOptions } = filterDominatedWorkplaces(
    getAvailablePublicWorkplaces(state, playerId),
    getAvailableOwnedBuildings(state, playerId),
  )
  if (pubOptions.length === 0 && bldOptions.length === 0) return { state: afterHumanAction(state, deferRoundEnd), target: null }

  const player = getPlayer(state, playerId)
  const weights = getPlayerWeights(playerId)
  const availableWorkers = player.workers.filter(w => !w.isTraining && w.placedAt === null).length
  const pubBonus = availableWorkers >= 2 ? weights.pubBonus : 1.0
  const isStartPlayer = state.players[state.startPlayerIndex]?.id === player.id

  // Fix 2: money < wage かつ建設可能カードより高コストの自分の建物があれば直接その建物を使う
  const wage = ROUND_CARDS[state.round - 1]?.wage ?? 0
  const expectedWageLocal = player.workers.length * wage
  if (player.money < expectedWageLocal && bldOptions.length > 0) {
    const buildDiscount = pubOptions
      .filter(wp => wp.effect.kind === 'build')
      .reduce((max, wp) => {
        const d = (wp.effect as { kind: 'build'; discount: number; drawAfter: number }).discount
        return Math.max(max, d)
      }, 0)
    const bestBuildableCost = player.hand
      .filter(c => c.kind === 'building')
      .reduce((max, c) => {
        const def = ALL_BUILDING_CARDS[(c as BuildingCard).name]
        if (!def) return max
        const dc = Math.max(0, def.cost - buildDiscount)
        if (player.hand.length - 1 < dc) return max
        return Math.max(max, def.cost)
      }, -1)
    if (bestBuildableCost >= 0) {
      const equivBld = bldOptions.find(b => {
        const def = ALL_BUILDING_CARDS[b.name]
        return def && def.isWorkplace && def.cost >= bestBuildableCost
      })
      if (equivBld) {
        return { state: placeWorkerOnBuilding(state, playerId, equivBld.id, true, deferRoundEnd), target: { id: equivBld.id, type: 'bld' } }
      }
    }
  }

  let bestScore = -Infinity
  let bestPub: PublicWorkplace | null = null
  let bestBld: OwnedBuilding | null = null

  const drawKinds = new Set(['draw', 'discard-draw', 'draw-consumption', 'draw-if-empty'])

  for (const wp of pubOptions) {
    const base = scoreEffect(wp.effect, player, state.household, state.round, availableWorkers, isStartPlayer, weights)
    const soldDef = ALL_BUILDING_CARDS[wp.name]
    const sc = (soldDef && drawKinds.has(wp.effect.kind))
      ? base * (1.0 + weights.drawPubExtra + soldDef.cost * weights.drawCostMult)
      : base * pubBonus
    if (sc > bestScore) { bestScore = sc; bestPub = wp; bestBld = null }
  }
  for (const bld of bldOptions) {
    const def = ALL_BUILDING_CARDS[bld.name]
    if (!def) continue
    const base = scoreEffect(def.effect, player, state.household, state.round, availableWorkers, isStartPlayer, weights)
    const sc = drawKinds.has(def.effect.kind)
      ? base * (1.0 + def.cost * weights.drawCostMult)
      : base * pubBonus
    if (sc > bestScore) { bestScore = sc; bestBld = bld; bestPub = null }
  }

  if (bestScore === -Infinity) return cpuTakeTurnRandomNoAuto(state, playerId, deferRoundEnd)

  if (bestPub) {
    return { state: placeWorkerOnPublic(state, playerId, bestPub.id, true, deferRoundEnd), target: { id: bestPub.id, type: 'pub' } }
  }
  if (bestBld) {
    return { state: placeWorkerOnBuilding(state, playerId, bestBld.id, true, deferRoundEnd), target: { id: bestBld.id, type: 'bld' } }
  }
  return { state: afterHumanAction(state, deferRoundEnd), target: null }
}
