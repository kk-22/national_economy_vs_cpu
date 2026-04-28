import { BUILDING_CARDS } from './constants'
import { rngNext, shuffle, updatePlayer, getPlayer, drawCards } from './primitives'
import { constructBuilding } from './build'
import type { GameState, HandCard, BuildingCard } from './types'

export function cpuRevealPick(state: GameState, playerId: number, n: number): GameState {
  const revealed: HandCard[] = []
  let s = state
  for (let i = 0; i < n; i++) {
    if (s.buildingDeck.length === 0) {
      if (s.discardPile.length > 0) {
        let shuffled: BuildingCard[]
        ;[s, shuffled] = shuffle(s, s.discardPile)
        s = { ...s, buildingDeck: shuffled, discardPile: [] }
      } else break
    }
    const [card, ...rest] = s.buildingDeck
    s = { ...s, buildingDeck: rest }
    revealed.push({ kind: 'building', ...card })
  }
  if (revealed.length === 0) return s
  let r: number
  ;[s, r] = rngNext(s)
  const pick = revealed[Math.floor(r * revealed.length)]
  const others = revealed.filter(c => c.id !== pick.id)
  const discarded = others.filter(c => c.kind === 'building') as BuildingCard[]
  s = updatePlayer(s, playerId, p => ({ ...p, hand: [...p.hand, pick] }))
  s = { ...s, discardPile: [...s.discardPile, ...discarded] }
  return s
}

export function cpuDiscardDraw(state: GameState, playerId: number, discard: number, draw: number): GameState {
  const player = getPlayer(state, playerId)
  const toDiscard = player.hand.slice(0, discard)
  const discarded = toDiscard.filter(c => c.kind === 'building') as BuildingCard[]
  let s = updatePlayer(state, playerId, p => ({ ...p, hand: p.hand.slice(discard) }))
  s = { ...s, discardPile: [...s.discardPile, ...discarded] }
  return drawCards(s, playerId, draw)
}

export function cpuDiscardGain(state: GameState, playerId: number, discard: number, gain: number): GameState {
  const player = getPlayer(state, playerId)
  const toDiscard = player.hand.slice(0, discard)
  const discarded = toDiscard.filter(c => c.kind === 'building') as BuildingCard[]
  let s = updatePlayer(state, playerId, p => ({ ...p, hand: p.hand.slice(discard) }))
  s = { ...s, discardPile: [...s.discardPile, ...discarded] }
  s = { ...s, household: s.household - gain }
  return updatePlayer(s, playerId, p => ({ ...p, money: p.money + gain }))
}

export function cpuBuild(state: GameState, playerId: number, discount: number, drawAfter: number): GameState {
  const player = getPlayer(state, playerId)
  const buildable = player.hand.filter(c => {
    if (c.kind !== 'building') return false
    const def = BUILDING_CARDS[c.name]!
    const cost = Math.max(0, def.cost - discount)
    return player.hand.length - 1 >= cost
  }) as (BuildingCard & { kind: 'building' })[]

  if (buildable.length === 0) return state

  let s = state
  let r: number
  ;[s, r] = rngNext(s)
  const target = buildable[Math.floor(r * buildable.length)]
  const def = BUILDING_CARDS[target.name]!
  const cost = Math.max(0, def.cost - discount)

  const payment = player.hand
    .filter(c => c.id !== target.id)
    .slice(0, cost)
    .map(c => c.id)

  ;[s] = constructBuilding(s, playerId, target.id, payment, drawAfter)
  return s
}

export function cpuBuildFarmFree(state: GameState, playerId: number): GameState {
  const player = getPlayer(state, playerId)
  const farmCards = player.hand.filter(c => {
    if (c.kind !== 'building') return false
    return BUILDING_CARDS[c.name]?.tags.includes('farm') ?? false
  })
  if (farmCards.length === 0) return state
  let s = state
  let r: number
  ;[s, r] = rngNext(s)
  const target = farmCards[Math.floor(r * farmCards.length)]
  ;[s] = constructBuilding(s, playerId, target.id, [], 0)
  return s
}

export function cpuBuildDouble(state: GameState, playerId: number): GameState {
  const player = getPlayer(state, playerId)
  const buildings = player.hand.filter(c => c.kind === 'building') as (BuildingCard & { kind: 'building' })[]

  const costGroups: Record<number, typeof buildings> = {}
  for (const c of buildings) {
    const cost = BUILDING_CARDS[c.name]?.cost ?? 0
    costGroups[cost] = [...(costGroups[cost] ?? []), c]
  }
  const validCosts = Object.entries(costGroups).filter(([, cards]) => cards.length >= 2)
  if (validCosts.length === 0) return state

  let s = state
  let r: number
  ;[s, r] = rngNext(s)
  const [, sameCostCards] = validCosts[Math.floor(r * validCosts.length)]
  const first = sameCostCards[0]
  const second = sameCostCards[1]
  const cost = BUILDING_CARDS[first.name]?.cost ?? 0

  const payment = buildings.filter(c => c.id !== first.id && c.id !== second.id).slice(0, cost).map(c => c.id)
  ;[s] = constructBuilding(s, playerId, first.id, payment, 0)
  ;[s] = constructBuilding(s, playerId, second.id, [], 0)
  return s
}
