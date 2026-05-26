import { availableWorkers, getPlayer, updatePlayer, drawCards, ALL_BUILDING_CARDS } from './primitives'
import { processRoundEnd } from './round'
import { getAvailablePublicWorkplaces, getAvailableOwnedBuildings } from './availability'
import { evaluateSimEnd, getTopNActionsGreedy, pickWorkerExpansion } from './cpu-scoring'
import { setLastCpuNoAutoTarget } from './turns'
import { placeWorkerOnPublic, placeWorkerOnBuilding, afterAction, afterHumanAction } from './turns'
import { cpuTakeTurnGreedy, cpuTakeTurnGreedyNoAuto } from './cpu-strategy-greedy'
import { cpuTakeTurnDisruptiveNoAuto } from './cpu-strategy-disruptive'
import {
  getBuildableCards, getFarmBuildableCards, getFreeBuildableCards,
  getNoSellBuildableCards, constructBuilding, getConstructionDiscount,
} from './build'
import { GREEDY_BUILD_EXCLUDED } from './cpu'
import type { GameState, HandCard } from './types'
import type { ActionOption } from './cpu-scoring'

// R1: 幅15から手番ごとに半分切り上げ（min4）、R2: 1手のみ幅10で平均評価
const R1_BEAM_START_WIDTH = 15
const R2_LOOKAHEAD_WIDTH = 10

const BUILD_EFFECT_KINDS = new Set([
  'build', 'build-double', 'build-farm-free', 'build-no-sell',
  'build-free-if-cheap', 'build-two', 'build-gain-vp',
])

type LeafState = {
  state: GameState
  firstAction: ActionOption
  r1Score: number
}

function simulateUntilBeamOrEnd(state: GameState, beamPlayerId: number, startRound: number): GameState {
  let s = state
  const total = s.players.length

  while (true) {
    if (s.round > startRound || s.phase === 'game-over') return s

    const allPlaced = s.players.every(p => p.workers.every(w => w.isTraining || w.placedAt !== null))
    if (allPlaced) return processRoundEnd(s, true)

    const current = s.players[s.currentPlayerIndex]
    const avail = availableWorkers(current)

    if (avail.length === 0) {
      s = { ...s, currentPlayerIndex: (s.currentPlayerIndex + 1) % total }
      continue
    }

    if (current.id === beamPlayerId) return s

    s = cpuTakeTurnDisruptiveNoAuto(s, current.id)
  }
}

// build系エフェクトの全建設ブランチを生成する
// isCpu=falseにした状態でplaceWorkerを呼び、pendingActionを取得してから分岐展開する
function resolveBuildBranches(stateWithPending: GameState): GameState[] {
  const pa = stateWithPending.pendingAction
  if (!pa) return []

  switch (pa.kind) {
    case 'choose-build-target': {
      let targets = getBuildableCards(stateWithPending, pa.playerId, pa.discount)
      const player = getPlayer(stateWithPending, pa.playerId)
      const availableAfter = player.workers.filter(w => !w.isTraining && w.placedAt === null).length
      const filtered = targets.filter(c => {
        if (GREEDY_BUILD_EXCLUDED.has(c.name)) return false
        const def = ALL_BUILDING_CARDS[c.name]!
        if (def.effect.kind.startsWith('p-')) return stateWithPending.round >= 8 && def.assetValue > 0
        if (stateWithPending.round <= 7 && !def.isWorkplace) return false
        if (availableAfter >= 1) {
          const selfDiscount = getConstructionDiscount(stateWithPending, pa.playerId, c.name)
          const remainingHand = player.hand.length - 1 - Math.max(0, def.cost - pa.discount - selfDiscount)
          if (def.effect.kind === 'build' && remainingHand < 2) return false
        }
        return true
      })
      if (filtered.length > 0) targets = filtered

      const sourceEffect = pa.sourceName ? ALL_BUILDING_CARDS[pa.sourceName]?.effect : undefined
      const isGainVp = sourceEffect?.kind === 'build-gain-vp'

      return targets.map(targetCard => {
        const selfDiscount = getConstructionDiscount(stateWithPending, pa.playerId, targetCard.name)
        const cost = Math.max(0, ALL_BUILDING_CARDS[targetCard.name]!.cost - pa.discount - selfDiscount)
        const playerNow = getPlayer(stateWithPending, pa.playerId)
        const payment = playerNow.hand.filter(c => c.id !== targetCard.id).slice(0, cost).map(c => c.id)
        let s: GameState = { ...stateWithPending, pendingAction: null }
        ;[s] = constructBuilding(s, pa.playerId, targetCard.id, payment, pa.drawAfter)
        if (isGainVp) s = updatePlayer(s, pa.playerId, p => ({ ...p, victoryPoints: p.victoryPoints + 1 }))
        return afterHumanAction(s)
      })
    }

    case 'choose-farm-build': {
      const targets = getFarmBuildableCards(stateWithPending, pa.playerId)
      return targets.map(targetCard => {
        let s: GameState = { ...stateWithPending, pendingAction: null }
        ;[s] = constructBuilding(s, pa.playerId, targetCard.id, [], 0)
        return afterHumanAction(s)
      })
    }

    case 'choose-free-build': {
      const targets = getFreeBuildableCards(stateWithPending, pa.playerId, pa.maxAsset)
      return targets.map(targetCard => {
        let s: GameState = { ...stateWithPending, pendingAction: null }
        ;[s] = constructBuilding(s, pa.playerId, targetCard.id, [], 0)
        return afterHumanAction(s)
      })
    }

    case 'choose-no-sell-build': {
      const targets = getNoSellBuildableCards(stateWithPending, pa.playerId)
      return targets.map(targetCard => {
        const def = ALL_BUILDING_CARDS[targetCard.name]!
        const selfDiscount = getConstructionDiscount(stateWithPending, pa.playerId, targetCard.name)
        const cost = Math.max(0, def.cost - selfDiscount)
        const playerNow = getPlayer(stateWithPending, pa.playerId)
        const payment = playerNow.hand.filter(c => c.id !== targetCard.id).slice(0, cost).map(c => c.id)
        let s: GameState = { ...stateWithPending, pendingAction: null }
        ;[s] = constructBuilding(s, pa.playerId, targetCard.id, payment, pa.drawAfter)
        return afterHumanAction(s)
      })
    }

    case 'choose-double-first': {
      const player = getPlayer(stateWithPending, pa.playerId)
      const buildings = player.hand.filter(c => c.kind === 'building')
      const costGroups: Record<number, typeof buildings> = {}
      for (const c of buildings) {
        const cost = ALL_BUILDING_CARDS[c.name]?.cost ?? 0
        costGroups[cost] = [...(costGroups[cost] ?? []), c]
      }
      const results: GameState[] = []
      for (const [costStr, cards] of Object.entries(costGroups)) {
        const cost = parseInt(costStr)
        if (cards.length >= 2 && player.hand.length - 2 >= cost) {
          const first = cards[0], second = cards[1]
          const payment = player.hand.filter(c => c.id !== first.id && c.id !== second.id).slice(0, cost).map(c => c.id)
          let s: GameState = { ...stateWithPending, pendingAction: null }
          ;[s] = constructBuilding(s, pa.playerId, first.id, payment, 0)
          ;[s] = constructBuilding(s, pa.playerId, second.id, [], 0)
          results.push(afterHumanAction(s))
        }
      }
      return results
    }

    case 'choose-build-two-first': {
      const player = getPlayer(stateWithPending, pa.playerId)
      const buildings = player.hand.filter(c => c.kind === 'building') as (HandCard & { kind: 'building' })[]
      const results: GameState[] = []
      for (let i = 0; i < buildings.length; i++) {
        for (let j = i + 1; j < buildings.length; j++) {
          const c1 = buildings[i], c2 = buildings[j]
          const d1 = getConstructionDiscount(stateWithPending, pa.playerId, c1.name)
          const d2 = getConstructionDiscount(stateWithPending, pa.playerId, c2.name)
          const cost1 = Math.max(0, (ALL_BUILDING_CARDS[c1.name]?.cost ?? 0) - d1)
          const cost2 = Math.max(0, (ALL_BUILDING_CARDS[c2.name]?.cost ?? 0) - d2)
          const totalCost = cost1 + cost2
          if (buildings.length - 2 >= totalCost) {
            const payment = player.hand.filter(c => c.id !== c1.id && c.id !== c2.id).slice(0, totalCost).map(c => c.id)
            let s: GameState = { ...stateWithPending, pendingAction: null }
            ;[s] = constructBuilding(s, pa.playerId, c1.id, payment, 0)
            ;[s] = constructBuilding(s, pa.playerId, c2.id, [], 0)
            if (getPlayer(s, pa.playerId).hand.length === 0) s = drawCards(s, pa.playerId, 3)
            results.push(afterHumanAction(s))
          }
        }
      }
      return results
    }

    default:
      return []
  }
}

function getActionEffectKind(simState: GameState, beamPlayerId: number, action: ActionOption): string {
  if (action.type === 'pub') {
    return simState.publicWorkplaces.find(w => w.id === action.id)?.effect.kind ?? ''
  }
  const bld = getPlayer(simState, beamPlayerId).ownedBuildings.find(b => b.id === action.id)
  return bld ? (ALL_BUILDING_CARDS[bld.name]?.effect.kind ?? '') : ''
}

// build系アクションを建物ごとに複数ブランチへ展開する。それ以外は1ブランチのみ返す
function expandPlacementStates(
  simState: GameState,
  beamPlayerId: number,
  action: ActionOption,
): GameState[] {
  if (!BUILD_EFFECT_KINDS.has(getActionEffectKind(simState, beamPlayerId, action))) {
    return [action.type === 'pub'
      ? placeWorkerOnPublic(simState, beamPlayerId, action.id, true)
      : placeWorkerOnBuilding(simState, beamPlayerId, action.id, true)]
  }

  // isCpu=falseにしてpendingActionを取得
  const humanSimState: GameState = {
    ...simState,
    players: simState.players.map(p =>
      p.id === beamPlayerId ? { ...p, isCpu: false } : p
    ),
  }
  const stateWithPending = action.type === 'pub'
    ? placeWorkerOnPublic(humanSimState, beamPlayerId, action.id, true)
    : placeWorkerOnBuilding(humanSimState, beamPlayerId, action.id, true)

  if (!stateWithPending.pendingAction) {
    return [action.type === 'pub'
      ? placeWorkerOnPublic(simState, beamPlayerId, action.id, true)
      : placeWorkerOnBuilding(simState, beamPlayerId, action.id, true)]
  }

  // ビームプレイヤーのisCpuをtrueに戻してからブランチ解決
  const restoredState: GameState = {
    ...stateWithPending,
    players: stateWithPending.players.map(p =>
      p.id === beamPlayerId ? { ...p, isCpu: true, cpuStrategy: 'greedy' as const } : p
    ),
  }

  const branches = resolveBuildBranches(restoredState)
  if (branches.length === 0) {
    return [action.type === 'pub'
      ? placeWorkerOnPublic(simState, beamPlayerId, action.id, true)
      : placeWorkerOnBuilding(simState, beamPlayerId, action.id, true)]
  }
  return branches
}

// R1を全展開し、全リーフ状態を収集する（各リーフに最初の手番を記録）
function collectR1Leaves(
  simState: GameState,
  beamPlayerId: number,
  startRound: number,
  currentWidth: number,
  firstAction: ActionOption | null,
): LeafState[] {
  const actions = getTopNActionsGreedy(simState, beamPlayerId, currentWidth)
  const nextWidth = Math.max(4, Math.ceil(currentWidth / 2))
  const results: LeafState[] = []

  if (actions.length === 0) {
    if (firstAction === null) return results
    const s = simulateUntilBeamOrEnd(
      { ...simState, currentPlayerIndex: (simState.currentPlayerIndex + 1) % simState.players.length },
      beamPlayerId, startRound,
    )
    if (s.round > startRound || s.phase === 'game-over') {
      results.push({ state: s, firstAction, r1Score: evaluateSimEnd(s, beamPlayerId, startRound) })
    } else {
      results.push(...collectR1Leaves(s, beamPlayerId, startRound, nextWidth, firstAction))
    }
    return results
  }

  for (const action of actions) {
    const fa = firstAction ?? action
    for (const s0 of expandPlacementStates(simState, beamPlayerId, action)) {
      const s = simulateUntilBeamOrEnd(s0, beamPlayerId, startRound)
      if (s.round > startRound || s.phase === 'game-over') {
        results.push({ state: s, firstAction: fa, r1Score: evaluateSimEnd(s, beamPlayerId, startRound) })
      } else {
        results.push(...collectR1Leaves(s, beamPlayerId, startRound, nextWidth, fa))
      }
    }
  }

  return results
}

// R2の1手を評価：ビームプレイヤーの手番まで進めてから上位N手の平均スコアを返す
function scoreR2OneTurn(state: GameState, beamPlayerId: number, startRound: number): number {
  const r2Round = state.round
  const s2 = simulateUntilBeamOrEnd(state, beamPlayerId, r2Round)

  if (s2.round > r2Round || s2.phase === 'game-over') {
    return evaluateSimEnd(s2, beamPlayerId, startRound)
  }

  const actions = getTopNActionsGreedy(s2, beamPlayerId, R2_LOOKAHEAD_WIDTH)
  if (actions.length === 0) return evaluateSimEnd(s2, beamPlayerId, startRound)

  let sum = 0
  for (const action of actions) {
    const s3 = action.type === 'pub'
      ? placeWorkerOnPublic(s2, beamPlayerId, action.id, true)
      : placeWorkerOnBuilding(s2, beamPlayerId, action.id, true)
    sum += evaluateSimEnd(s3, beamPlayerId, startRound)
  }
  return sum / actions.length
}

// リーフ群から最善の最初の手番を選択する
// 残留対象: 「手番ごとのベスト1」∪「グローバル上位10%（最小10個）」
// 各手番の代表スコアはR2評価の平均値
function selectBestFirstAction(leaves: LeafState[], beamPlayerId: number, startRound: number): ActionOption {
  const topCount = Math.max(Math.ceil(leaves.length * 0.1), 10)
  const sortedByR1 = [...leaves].sort((a, b) => b.r1Score - a.r1Score)
  const globalTopSet = new Set<LeafState>(sortedByR1.slice(0, topCount))

  // 手番ごとのベスト1
  const bestPerAction = new Map<string, LeafState>()
  for (const leaf of leaves) {
    const key = `${leaf.firstAction.type}:${leaf.firstAction.id}`
    const cur = bestPerAction.get(key)
    if (!cur || leaf.r1Score > cur.r1Score) bestPerAction.set(key, leaf)
  }

  // Union（重複除去）
  const r2Candidates = new Set<LeafState>([...globalTopSet, ...bestPerAction.values()])

  // 手番ごとにR2スコアを収集して平均
  const scoresByAction = new Map<string, { action: ActionOption; scores: number[] }>()

  for (const leaf of r2Candidates) {
    const key = `${leaf.firstAction.type}:${leaf.firstAction.id}`
    const r2Score = leaf.state.phase === 'game-over'
      ? leaf.r1Score
      : scoreR2OneTurn(leaf.state, beamPlayerId, startRound)

    if (!scoresByAction.has(key)) scoresByAction.set(key, { action: leaf.firstAction, scores: [] })
    scoresByAction.get(key)!.scores.push(r2Score)
  }

  // 平均スコア最大の手番を採用
  let bestScore = -Infinity
  let bestAction = leaves[0].firstAction

  for (const { action, scores } of scoresByAction.values()) {
    const avg = scores.reduce((a, b) => a + b, 0) / scores.length
    if (avg > bestScore) {
      bestScore = avg
      bestAction = action
    }
  }

  return bestAction
}

function buildSimState(state: GameState): GameState {
  return {
    ...state,
    players: state.players.map(p => ({
      ...p,
      isCpu: true,
      cpuStrategy: 'greedy' as const,
    })),
  }
}

export function cpuTakeTurnBeam(state: GameState, playerId: number): GameState {
  const pubOptions = getAvailablePublicWorkplaces(state, playerId)
  const bldOptions = getAvailableOwnedBuildings(state, playerId)
  if (pubOptions.length === 0 && bldOptions.length === 0) return afterAction(state)

  const expansion = pickWorkerExpansion(state, playerId)
  if (expansion) return placeWorkerOnPublic(state, playerId, expansion.id)

  const startRound = state.round
  const leaves = collectR1Leaves(buildSimState(state), playerId, startRound, R1_BEAM_START_WIDTH, null)
  if (leaves.length === 0) return cpuTakeTurnGreedy(state, playerId)

  const bestAction = selectBestFirstAction(leaves, playerId, startRound)

  if (bestAction.type === 'pub') return placeWorkerOnPublic(state, playerId, bestAction.id)
  return placeWorkerOnBuilding(state, playerId, bestAction.id)
}

export function cpuTakeTurnBeamNoAuto(state: GameState, playerId: number): GameState {
  const pubOptions = getAvailablePublicWorkplaces(state, playerId)
  const bldOptions = getAvailableOwnedBuildings(state, playerId)
  if (pubOptions.length === 0 && bldOptions.length === 0) return afterHumanAction(state)

  const expansion = pickWorkerExpansion(state, playerId)
  if (expansion) {
    setLastCpuNoAutoTarget({ id: expansion.id, type: 'pub' })
    return placeWorkerOnPublic(state, playerId, expansion.id, true)
  }

  const startRound = state.round
  const leaves = collectR1Leaves(buildSimState(state), playerId, startRound, R1_BEAM_START_WIDTH, null)
  if (leaves.length === 0) return cpuTakeTurnGreedyNoAuto(state, playerId)

  const bestAction = selectBestFirstAction(leaves, playerId, startRound)

  setLastCpuNoAutoTarget({ id: bestAction.id, type: bestAction.type })
  if (bestAction.type === 'pub') return placeWorkerOnPublic(state, playerId, bestAction.id, true)
  return placeWorkerOnBuilding(state, playerId, bestAction.id, true)
}
