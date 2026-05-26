import { rngNext } from './primitives'
import { getAvailablePublicWorkplaces, getAvailableOwnedBuildings } from './availability'
import { setLastCpuNoAutoTarget } from './turns'
import { placeWorkerOnPublic, placeWorkerOnBuilding, afterAction, afterHumanAction } from './turns'
import type { GameState } from './types'

export function cpuTakeTurnRandom(state: GameState, playerId: number): GameState {
  const pubOptions = getAvailablePublicWorkplaces(state, playerId)
  const allBldOptions = getAvailableOwnedBuildings(state, playerId)
  const pubNames = new Set(pubOptions.map(wp => wp.name))
  const bldOptions = allBldOptions.filter(b => !pubNames.has(b.name))
  if (pubOptions.length === 0 && bldOptions.length === 0) return afterAction(state)

  let s = state, r: number
  ;[s, r] = rngNext(s)
  const usePub = pubOptions.length > 0 && (bldOptions.length === 0 || r < 0.5)
  if (usePub) {
    let r2: number
    ;[s, r2] = rngNext(s)
    return placeWorkerOnPublic(s, playerId, pubOptions[Math.floor(r2 * pubOptions.length)].id)
  } else if (bldOptions.length > 0) {
    let r2: number
    ;[s, r2] = rngNext(s)
    return placeWorkerOnBuilding(s, playerId, bldOptions[Math.floor(r2 * bldOptions.length)].id)
  }
  return afterAction(s)
}

export function cpuTakeTurnRandomNoAuto(state: GameState, playerId: number): GameState {
  const pubOptions = getAvailablePublicWorkplaces(state, playerId)
  const allBldOptions = getAvailableOwnedBuildings(state, playerId)
  const pubNames = new Set(pubOptions.map(wp => wp.name))
  const bldOptions = allBldOptions.filter(b => !pubNames.has(b.name))
  if (pubOptions.length === 0 && bldOptions.length === 0) return afterHumanAction(state)

  let s = state, r: number
  ;[s, r] = rngNext(s)
  const usePub = pubOptions.length > 0 && (bldOptions.length === 0 || r < 0.5)
  if (usePub) {
    let r2: number
    ;[s, r2] = rngNext(s)
    const pubId = pubOptions[Math.floor(r2 * pubOptions.length)].id
    setLastCpuNoAutoTarget({ id: pubId, type: 'pub' })
    return placeWorkerOnPublic(s, playerId, pubId, true)
  } else if (bldOptions.length > 0) {
    let r2: number
    ;[s, r2] = rngNext(s)
    const bldId = bldOptions[Math.floor(r2 * bldOptions.length)].id
    setLastCpuNoAutoTarget({ id: bldId, type: 'bld' })
    return placeWorkerOnBuilding(s, playerId, bldId, true)
  }
  return afterHumanAction(s)
}
