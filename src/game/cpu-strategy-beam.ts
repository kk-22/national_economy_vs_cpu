import { availableWorkers } from './primitives'
import { getAvailablePublicWorkplaces, getAvailableOwnedBuildings } from './availability'
import { processRoundEnd } from './round'
import { BEAM_WIDTH, evaluateSimEnd, getTopNActionsGreedy, pickWorkerExpansion } from './cpu-scoring'
import { setLastCpuNoAutoTarget } from './turns'
import { placeWorkerOnPublic, placeWorkerOnBuilding, afterAction, afterHumanAction } from './turns'
import { cpuTakeTurnGreedy, cpuTakeTurnGreedyNoAuto } from './cpu-strategy-greedy'
import { cpuTakeTurnDisruptiveNoAuto } from './cpu-strategy-disruptive'
import type { GameState } from './types'

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

// シミュレーション後のスコアを計算（次ラウンドは下限2で幅を段階削減、2ラウンド先以降はevaluateSimEnd）
function scoreAfterSim(s: GameState, beamPlayerId: number, startRound: number, beamWidth: number, roundsLeft: number): number {
  if (s.phase === 'game-over') return evaluateSimEnd(s, beamPlayerId, startRound)

  if (s.round > startRound) {
    if (roundsLeft > 0 && beamWidth >= 3) {
      const nextRound = s.round
      const nextBeamWidth = beamWidth - 1
      const sNext = simulateUntilBeamOrEnd(s, beamPlayerId, nextRound)
      if (sNext.round > nextRound || sNext.phase === 'game-over') {
        return evaluateSimEnd(sNext, beamPlayerId, nextRound)
      }
      return beamSimulateFromTurn(sNext, beamPlayerId, nextRound, nextBeamWidth, roundsLeft - 1)
    }
    return evaluateSimEnd(s, beamPlayerId, startRound)
  }

  // 同ラウンド内：現在ラウンドは下限4、次ラウンドは下限2
  const minWidth = roundsLeft > 0 ? 4 : 2
  const nextWidth = Math.max(minWidth, beamWidth - 1)
  return beamSimulateFromTurn(s, beamPlayerId, startRound, nextWidth, roundsLeft)
}

// beam プレイヤーの番から再帰的に探索し、中央値スコアを返す
function beamSimulateFromTurn(simState: GameState, beamPlayerId: number, startRound: number, beamWidth: number, roundsLeft: number): number {
  const actions = getTopNActionsGreedy(simState, beamPlayerId, beamWidth)

  if (actions.length === 0) {
    const s = simulateUntilBeamOrEnd(
      { ...simState, currentPlayerIndex: (simState.currentPlayerIndex + 1) % simState.players.length },
      beamPlayerId, startRound,
    )
    return scoreAfterSim(s, beamPlayerId, startRound, beamWidth, roundsLeft)
  }

  const scores: number[] = []
  for (const action of actions) {
    let s = action.type === 'pub'
      ? placeWorkerOnPublic(simState, beamPlayerId, action.id, true)
      : placeWorkerOnBuilding(simState, beamPlayerId, action.id, true)

    s = simulateUntilBeamOrEnd(s, beamPlayerId, startRound)
    scores.push(scoreAfterSim(s, beamPlayerId, startRound, beamWidth, roundsLeft))
  }

  scores.sort((a, b) => a - b)
  return scores[Math.floor(scores.length / 2)]
}

export function cpuTakeTurnBeam(state: GameState, playerId: number): GameState {
  const pubOptions = getAvailablePublicWorkplaces(state, playerId)
  const bldOptions = getAvailableOwnedBuildings(state, playerId)
  if (pubOptions.length === 0 && bldOptions.length === 0) return afterAction(state)

  const expansion = pickWorkerExpansion(state, playerId)
  if (expansion) return placeWorkerOnPublic(state, playerId, expansion.id)

  const simState: GameState = {
    ...state,
    players: state.players.map(p => ({
      ...p,
      isCpu: true,
      cpuStrategy: 'greedy' as const,
    })),
  }

  const startRound = state.round
  const topActions = getTopNActionsGreedy(simState, playerId, BEAM_WIDTH)
  if (topActions.length === 0) return cpuTakeTurnGreedy(state, playerId)

  let bestScore = -Infinity
  let bestAction = topActions[0]

  for (const action of topActions) {
    let s = action.type === 'pub'
      ? placeWorkerOnPublic(simState, playerId, action.id, true)
      : placeWorkerOnBuilding(simState, playerId, action.id, true)

    s = simulateUntilBeamOrEnd(s, playerId, startRound)

    const score = scoreAfterSim(s, playerId, startRound, BEAM_WIDTH, 1)
    if (score > bestScore) { bestScore = score; bestAction = action }
  }

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

  const simState: GameState = {
    ...state,
    players: state.players.map(p => ({
      ...p,
      isCpu: true,
      cpuStrategy: 'greedy' as const,
    })),
  }

  const startRound = state.round
  const topActions = getTopNActionsGreedy(simState, playerId, BEAM_WIDTH)
  if (topActions.length === 0) return cpuTakeTurnGreedyNoAuto(state, playerId)

  let bestScore = -Infinity
  let bestAction = topActions[0]

  for (const action of topActions) {
    let s = action.type === 'pub'
      ? placeWorkerOnPublic(simState, playerId, action.id, true)
      : placeWorkerOnBuilding(simState, playerId, action.id, true)

    s = simulateUntilBeamOrEnd(s, playerId, startRound)

    const score = scoreAfterSim(s, playerId, startRound, BEAM_WIDTH, 1)
    if (score > bestScore) { bestScore = score; bestAction = action }
  }

  setLastCpuNoAutoTarget({ id: bestAction.id, type: bestAction.type })
  if (bestAction.type === 'pub') return placeWorkerOnPublic(state, playerId, bestAction.id, true)
  return placeWorkerOnBuilding(state, playerId, bestAction.id, true)
}
