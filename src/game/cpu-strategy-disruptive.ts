import { pickDisruptive, pickWorkerExpansion } from './cpu-scoring'
import { setLastCpuNoAutoTarget } from './turns'
import { placeWorkerOnPublic, placeWorkerOnBuilding, afterAction, afterHumanAction } from './turns'
import type { GameState } from './types'

export function cpuTakeTurnDisruptive(state: GameState, playerId: number): GameState {
  const expansion = pickWorkerExpansion(state, playerId)
  if (expansion) return placeWorkerOnPublic(state, playerId, expansion.id)

  const chosen = pickDisruptive(state, playerId)
  if (!chosen) return afterAction(state)
  if (chosen.type === 'pub') return placeWorkerOnPublic(state, playerId, chosen.id)
  return placeWorkerOnBuilding(state, playerId, chosen.id)
}

export function cpuTakeTurnDisruptiveNoAuto(state: GameState, playerId: number): GameState {
  const expansion = pickWorkerExpansion(state, playerId)
  if (expansion) {
    setLastCpuNoAutoTarget({ id: expansion.id, type: 'pub' })
    return placeWorkerOnPublic(state, playerId, expansion.id, true)
  }

  const chosen = pickDisruptive(state, playerId)
  if (!chosen) return afterHumanAction(state)
  setLastCpuNoAutoTarget({ id: chosen.id, type: chosen.type })
  if (chosen.type === 'pub') return placeWorkerOnPublic(state, playerId, chosen.id, true)
  return placeWorkerOnBuilding(state, playerId, chosen.id, true)
}
