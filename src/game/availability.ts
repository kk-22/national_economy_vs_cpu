import { BUILDING_CARDS } from './constants'
import { availableWorkers, workerCount, getMaxWorkers, getPlayer } from './primitives'
import type { GameState, Player, PublicWorkplace, OwnedBuilding, GameEffect } from './types'

function canUseEffect(effect: GameEffect, player: Player, household = Infinity): boolean {
  switch (effect.kind) {
    case 'gain-supply':     return household >= effect.n
    case 'discard-draw':    return player.hand.length >= effect.discard
    case 'discard-gain':    return player.hand.length >= effect.discard && household >= effect.gain
    case 'add-worker':      return workerCount(player) < getMaxWorkers(player)
    case 'fill-workers':    return workerCount(player) < Math.min(effect.target, getMaxWorkers(player))
    case 'build':           return player.hand.some(c => {
      if (c.kind !== 'building') return false
      const def = BUILDING_CARDS[c.name]
      const cost = Math.max(0, def.cost - effect.discount)
      return player.hand.length - 1 >= cost
    })
    case 'build-farm-free': return player.hand.some(c =>
      c.kind === 'building' && (BUILDING_CARDS[c.name]?.tags.includes('farm') ?? false)
    )
    case 'build-double': {
      const buildings = player.hand.filter(c => c.kind === 'building')
      const costGroups: Record<number, number> = {}
      for (const c of buildings) {
        if (c.kind !== 'building') continue
        const cost = BUILDING_CARDS[c.name]?.cost ?? 0
        costGroups[cost] = (costGroups[cost] ?? 0) + 1
      }
      return Object.entries(costGroups).some(([costStr, cnt]) => {
        if (cnt < 2) return false
        const cost = parseInt(costStr)
        return player.hand.length - 2 >= cost
      })
    }
    case 'draw-consumption-to': return player.hand.length < effect.target
    case 'reveal-pick':     return true
    default:                return true
  }
}

function canUseWorkplace(effect: GameEffect, currentWorkers: number, allowMultiple: boolean, player: Player, household: number): boolean {
  if (currentWorkers > 0 && !allowMultiple) return false
  return canUseEffect(effect, player, household)
}

export function getAvailablePublicWorkplaces(state: GameState, playerId: number): PublicWorkplace[] {
  const player = getPlayer(state, playerId)
  if (availableWorkers(player).length === 0) return []
  return state.publicWorkplaces.filter(wp => canUseWorkplace(wp.effect, wp.workerIds.length, wp.allowMultiple, player, state.household))
}

export function getAvailableOwnedBuildings(state: GameState, playerId: number): OwnedBuilding[] {
  const player = getPlayer(state, playerId)
  if (availableWorkers(player).length === 0) return []
  return player.ownedBuildings.filter(b => {
    const def = BUILDING_CARDS[b.name]
    if (!def || !def.isWorkplace) return false
    if (b.workerHereId !== null) return false
    return canUseEffect(def.effect, player)
  })
}
