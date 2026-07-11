import { pickDisruptive, pickWorkerExpansion } from './cpu-scoring'
import { placeWorkerOnPublic, placeWorkerOnBuilding, afterAction, afterHumanAction } from './turns'
import type { CpuNoAutoResult } from './turns'
import type { GameState } from './types'

export function cpuTakeTurnDisruptive(state: GameState, playerId: number): GameState {
  const expansion = pickWorkerExpansion(state, playerId)
  if (expansion) return placeWorkerOnPublic(state, playerId, expansion.id)

  const chosen = pickDisruptive(state, playerId)
  if (!chosen) return afterAction(state)
  if (chosen.type === 'pub') return placeWorkerOnPublic(state, playerId, chosen.id)
  return placeWorkerOnBuilding(state, playerId, chosen.id)
}

export function cpuTakeTurnDisruptiveNoAuto(state: GameState, playerId: number, deferRoundEnd = false): CpuNoAutoResult {
  const expansion = pickWorkerExpansion(state, playerId)
  if (expansion) {
    return { state: placeWorkerOnPublic(state, playerId, expansion.id, true, deferRoundEnd), target: { id: expansion.id, type: 'pub' } }
  }

  const chosen = pickDisruptive(state, playerId)
  if (!chosen) return { state: afterHumanAction(state, deferRoundEnd), target: null }
  const s = chosen.type === 'pub'
    ? placeWorkerOnPublic(state, playerId, chosen.id, true, deferRoundEnd)
    : placeWorkerOnBuilding(state, playerId, chosen.id, true, deferRoundEnd)
  return { state: s, target: { id: chosen.id, type: chosen.type } }
}
