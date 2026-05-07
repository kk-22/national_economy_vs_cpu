import { BUILDING_CARDS } from './constants'
import { getPlayer, updatePlayer, addLog, genId, drawCards } from './primitives'
import type { GameState, HandCard, BuildingCard, OwnedBuilding } from './types'

export function constructBuilding(state: GameState, playerId: number, cardId: string, paymentIds: string[], drawAfter: number): [GameState] {
  let s = state
  const player = getPlayer(s, playerId)
  const card = player.hand.find(c => c.id === cardId) as BuildingCard & { kind: 'building' }

  const toRemove = new Set([cardId, ...paymentIds])
  const removed = player.hand.filter(c => toRemove.has(c.id))
  const buildingCards = removed.filter(c => c.kind === 'building') as BuildingCard[]

  s = updatePlayer(s, playerId, p => ({ ...p, hand: p.hand.filter(c => !toRemove.has(c.id)) }))

  const discardedBuildings = buildingCards.filter(c => c.id !== cardId)
  s = { ...s, discardPile: [...s.discardPile, ...discardedBuildings] }

  let bId: string
  ;[s, bId] = genId(s, 'b-')
  const owned: OwnedBuilding = { id: bId, name: card.name, workerHereId: null }
  s = updatePlayer(s, playerId, p => ({ ...p, ownedBuildings: [...p.ownedBuildings, owned] }))

  if (drawAfter > 0) s = drawCards(s, playerId, drawAfter)

  return [s]
}

export function undoWorkerPlacement(state: GameState, playerId: number, effectKinds: string[], sourceId?: string): GameState {
  const player = getPlayer(state, playerId)

  let placedWorker: typeof player.workers[number] | undefined
  if (sourceId) {
    // sourceId が分かっている場合は直接特定する（複数 discard-gain 建物があっても正確）
    placedWorker = player.workers.find(w => w.placedAt === sourceId)
  } else {
    const effectSet = new Set(effectKinds)
    const matchingIds = new Set<string>()
    for (const wp of state.publicWorkplaces) {
      if (effectSet.has(wp.effect.kind)) matchingIds.add(wp.id)
    }
    for (const b of player.ownedBuildings) {
      const def = BUILDING_CARDS[b.name]
      if (def && effectSet.has(def.effect.kind)) matchingIds.add(b.id)
    }
    placedWorker = player.workers.find(w => w.placedAt !== null && matchingIds.has(w.placedAt!))
  }

  if (!placedWorker || placedWorker.placedAt === null) return { ...state, pendingAction: null }

  const targetId = placedWorker.placedAt
  let s: GameState = {
    ...state,
    publicWorkplaces: state.publicWorkplaces.map(wp =>
      wp.id === targetId ? { ...wp, workerIds: wp.workerIds.filter(id => id !== placedWorker.id) } : wp
    ),
  }
  s = updatePlayer(s, playerId, p => ({
    ...p,
    workers: p.workers.map(w => w.id === placedWorker.id ? { ...w, placedAt: null } : w),
    ownedBuildings: p.ownedBuildings.map(b => b.id === targetId ? { ...b, workerHereId: null } : b),
  }))
  return { ...s, pendingAction: null }
}

export function getBuildableCards(state: GameState, playerId: number, discount: number): (HandCard & { kind: 'building' })[] {
  const player = getPlayer(state, playerId)
  return player.hand.filter(c => {
    if (c.kind !== 'building') return false
    const def = BUILDING_CARDS[c.name]
    const cost = Math.max(0, def.cost - discount)
    return player.hand.length - 1 >= cost
  }) as (HandCard & { kind: 'building' })[]
}

export function getFarmBuildableCards(state: GameState, playerId: number): (HandCard & { kind: 'building' })[] {
  const player = getPlayer(state, playerId)
  return player.hand.filter(c =>
    c.kind === 'building' && (BUILDING_CARDS[c.name]?.tags.includes('farm') ?? false)
  ) as (HandCard & { kind: 'building' })[]
}

export function getDoubleBuildableFirstCards(state: GameState, playerId: number): (HandCard & { kind: 'building' })[] {
  const player = getPlayer(state, playerId)
  const buildings = player.hand.filter(c => c.kind === 'building') as (HandCard & { kind: 'building' })[]
  const costGroups: Record<number, (HandCard & { kind: 'building' })[]> = {}
  for (const c of buildings) {
    const cost = BUILDING_CARDS[c.name]?.cost ?? 0
    costGroups[cost] = [...(costGroups[cost] ?? []), c]
  }
  const validFirstCards: (HandCard & { kind: 'building' })[] = []
  for (const [costStr, cards] of Object.entries(costGroups)) {
    const cost = parseInt(costStr)
    if (cards.length >= 2 && player.hand.length - 2 >= cost) {
      validFirstCards.push(...cards)
    }
  }
  return validFirstCards
}

export function selectBuildTarget(state: GameState, targetCardId: string): GameState {
  const action = state.pendingAction
  if (!action || action.kind !== 'choose-build-target') return state
  const player = getPlayer(state, action.playerId)
  const card = player.hand.find(c => c.id === targetCardId)
  if (!card || card.kind !== 'building') return state
  const def = BUILDING_CARDS[card.name]!
  const cost = Math.max(0, def.cost - action.discount)
  if (player.hand.length - 1 < cost) return state
  return {
    ...state,
    pendingAction: {
      kind: 'choose-build-payment',
      playerId: action.playerId,
      targetId: card.id,
      targetName: card.name,
      cost,
      drawAfter: action.drawAfter,
      discount: action.discount,
      sourceName: action.sourceName,
    },
  }
}

export function selectDoubleFirst(state: GameState, cardId: string): GameState {
  const action = state.pendingAction
  if (!action || action.kind !== 'choose-double-first') return state
  const player = getPlayer(state, action.playerId)
  const card = player.hand.find(c => c.id === cardId)
  if (!card || card.kind !== 'building') return state
  const def = BUILDING_CARDS[card.name]!
  return {
    ...state,
    pendingAction: { kind: 'choose-double-second', playerId: action.playerId, firstCost: def.cost, firstId: card.id, sourceName: action.sourceName },
  }
}

export function selectDoubleSecond(state: GameState, cardId: string): GameState {
  const action = state.pendingAction
  if (!action || action.kind !== 'choose-double-second') return state
  const player = getPlayer(state, action.playerId)
  const card = player.hand.find(c => c.id === cardId)
  if (!card || card.kind !== 'building') return state
  const def = BUILDING_CARDS[card.name]!
  if (def.cost !== action.firstCost) return state
  if (card.id === action.firstId) return state
  return {
    ...state,
    pendingAction: { kind: 'choose-double-payment', playerId: action.playerId, firstId: action.firstId, secondId: card.id, cost: action.firstCost, firstCost: action.firstCost, sourceName: action.sourceName },
  }
}

export function cancelBuildChoice(state: GameState): GameState {
  const pa = state.pendingAction
  if (!pa) return state
  if (pa.kind !== 'choose-build-target' && pa.kind !== 'choose-farm-build' && pa.kind !== 'choose-double-first') return state
  const player = getPlayer(state, pa.playerId)
  let s = undoWorkerPlacement(state, pa.playerId, ['build', 'build-farm-free', 'build-double'])
  return addLog(s, `${player.name}: ${pa.sourceName ?? ''} → キャンセル`)
}

export function cancelBuildPayment(state: GameState): GameState {
  const action = state.pendingAction
  if (!action || action.kind !== 'choose-build-payment') return state
  return { ...state, pendingAction: { kind: 'choose-build-target', playerId: action.playerId, discount: action.discount, drawAfter: action.drawAfter, sourceName: action.sourceName } }
}

export function cancelDoubleSecond(state: GameState): GameState {
  const action = state.pendingAction
  if (!action || action.kind !== 'choose-double-second') return state
  return { ...state, pendingAction: { kind: 'choose-double-first', playerId: action.playerId, sourceName: action.sourceName } }
}

export function cancelDoublePayment(state: GameState): GameState {
  const action = state.pendingAction
  if (!action || action.kind !== 'choose-double-payment') return state
  return { ...state, pendingAction: { kind: 'choose-double-second', playerId: action.playerId, firstCost: action.firstCost, firstId: action.firstId, sourceName: action.sourceName } }
}
