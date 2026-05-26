import { availableWorkers } from './primitives'
import { processRoundEnd } from './round'
import { getAvailablePublicWorkplaces, getAvailableOwnedBuildings } from './availability'
import { evaluateSimEnd, getTopNActionsGreedy, pickWorkerExpansion } from './cpu-scoring'
import { setLastCpuNoAutoTarget } from './turns'
import { placeWorkerOnPublic, placeWorkerOnBuilding, afterAction, afterHumanAction } from './turns'
import { cpuTakeTurnGreedy, cpuTakeTurnGreedyNoAuto } from './cpu-strategy-greedy'
import { cpuTakeTurnDisruptiveNoAuto } from './cpu-strategy-disruptive'
import type { GameState } from './types'
import type { ActionOption } from './cpu-scoring'

// R1: 幅15から手番ごとに半分切り上げ（min4）、R2: 1手のみ幅10で平均評価
const R1_BEAM_START_WIDTH = 15
const R2_LOOKAHEAD_WIDTH = 10

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
    let s = action.type === 'pub'
      ? placeWorkerOnPublic(simState, beamPlayerId, action.id, true)
      : placeWorkerOnBuilding(simState, beamPlayerId, action.id, true)
    s = simulateUntilBeamOrEnd(s, beamPlayerId, startRound)

    const fa = firstAction ?? action

    if (s.round > startRound || s.phase === 'game-over') {
      results.push({ state: s, firstAction: fa, r1Score: evaluateSimEnd(s, beamPlayerId, startRound) })
    } else {
      results.push(...collectR1Leaves(s, beamPlayerId, startRound, nextWidth, fa))
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
