import { BUILDING_CARDS } from './constants'
import { rngNext, shuffle, updatePlayer, getPlayer, drawCards } from './primitives'
import { constructBuilding } from './build'
import type { GameState, HandCard, BuildingCard, CpuStrategy } from './types'

export const MCTS_SIMULATIONS = 10

// ---- 捨て札ソート（greedy/disruptive 共通: 消費財→低value建物の順） ----

function sortedDiscardIds(hand: HandCard[], count: number): string[] {
  const sorted = [...hand].sort((a, b) => {
    if (a.kind === 'consumption' && b.kind !== 'consumption') return -1
    if (b.kind === 'consumption' && a.kind !== 'consumption') return 1
    if (a.kind === 'building' && b.kind === 'building') {
      return (BUILDING_CARDS[a.name]?.assetValue ?? 0) - (BUILDING_CARDS[b.name]?.assetValue ?? 0)
    }
    return 0
  })
  return sorted.slice(0, count).map(c => c.id)
}

// ---- reveal-pick ----

export function cpuRevealPick(state: GameState, playerId: number, n: number, strategy: CpuStrategy = 'random'): GameState {
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

  let pick: HandCard
  if (strategy === 'greedy') {
    // assetValue 最大のカードを選ぶ
    pick = revealed.reduce((best, c) => {
      if (c.kind !== 'building') return best
      if (best.kind !== 'building') return c
      return (BUILDING_CARDS[c.name]?.assetValue ?? 0) >= (BUILDING_CARDS[best.name]?.assetValue ?? 0) ? c : best
    })
  } else {
    let r: number
    ;[s, r] = rngNext(s)
    pick = revealed[Math.floor(r * revealed.length)]
  }

  const others = revealed.filter(c => c.id !== pick.id)
  const discarded = others.filter(c => c.kind === 'building') as BuildingCard[]
  s = updatePlayer(s, playerId, p => ({ ...p, hand: [...p.hand, pick] }))
  s = { ...s, discardPile: [...s.discardPile, ...discarded] }
  return s
}

// ---- discard-draw ----

export function cpuDiscardDraw(state: GameState, playerId: number, discard: number, draw: number, strategy: CpuStrategy = 'random'): GameState {
  const player = getPlayer(state, playerId)
  const ids = (strategy === 'greedy' || strategy === 'disruptive')
    ? sortedDiscardIds(player.hand, discard)
    : player.hand.slice(0, discard).map(c => c.id)
  const discardSet = new Set(ids)
  const discarded = player.hand.filter(c => discardSet.has(c.id) && c.kind === 'building') as BuildingCard[]
  let s = updatePlayer(state, playerId, p => ({ ...p, hand: p.hand.filter(c => !discardSet.has(c.id)) }))
  s = { ...s, discardPile: [...s.discardPile, ...discarded] }
  return drawCards(s, playerId, draw)
}

// ---- discard-gain ----

export function cpuDiscardGain(state: GameState, playerId: number, discard: number, gain: number, strategy: CpuStrategy = 'random'): GameState {
  const player = getPlayer(state, playerId)
  const ids = (strategy === 'greedy' || strategy === 'disruptive')
    ? sortedDiscardIds(player.hand, discard)
    : player.hand.slice(0, discard).map(c => c.id)
  const discardSet = new Set(ids)
  const discarded = player.hand.filter(c => discardSet.has(c.id) && c.kind === 'building') as BuildingCard[]
  let s = updatePlayer(state, playerId, p => ({ ...p, hand: p.hand.filter(c => !discardSet.has(c.id)) }))
  s = { ...s, discardPile: [...s.discardPile, ...discarded] }
  s = { ...s, household: s.household - gain }
  return updatePlayer(s, playerId, p => ({ ...p, money: p.money + gain }))
}

// ---- build ----

export function cpuBuild(state: GameState, playerId: number, discount: number, drawAfter: number, strategy: CpuStrategy = 'random'): GameState {
  const player = getPlayer(state, playerId)
  let buildable = player.hand.filter(c => {
    if (c.kind !== 'building') return false
    const def = BUILDING_CARDS[c.name]!
    const cost = Math.max(0, def.cost - discount)
    return player.hand.length - 1 >= cost
  }) as (BuildingCard & { kind: 'building' })[]

  if (buildable.length === 0) return state

  if (strategy === 'greedy') {
    const availableAfter = player.workers.filter(w => !w.isTraining && w.placedAt === null).length
    // 建てて即売り損パターンを除外
    buildable = buildable.filter(c => {
      const def = BUILDING_CARDS[c.name]!
      if (def.effect.kind.startsWith('p-')) {
        // パッシブ効果: R8以降で得点があれば建設対象
        return state.round >= 8 && def.assetValue > 0
      }
      // アクティブ効果: 使えるワーカーあり、または売却しても採算が取れる
      if (availableAfter >= 1) return true
      const cardCost = Math.max(0, def.cost - discount) + 1
      return def.assetValue > cardCost * 6
    })
    if (buildable.length === 0) return state
  }

  let target: BuildingCard & { kind: 'building' }
  let s = state
  if (strategy === 'greedy') {
    // ラウンド8-9は残りラウンドが少なくコスト効果より得点価値が重要
    if (state.round >= 8) {
      target = buildable.reduce((best, c) =>
        (BUILDING_CARDS[c.name]?.assetValue ?? 0) >= (BUILDING_CARDS[best.name]?.assetValue ?? 0) ? c : best
      )
    } else {
      target = buildable.reduce((best, c) =>
        (BUILDING_CARDS[c.name]?.cost ?? 0) >= (BUILDING_CARDS[best.name]?.cost ?? 0) ? c : best
      )
    }
  } else if (strategy === 'disruptive') {
    target = buildable.reduce((best, c) =>
      (BUILDING_CARDS[c.name]?.cost ?? 0) <= (BUILDING_CARDS[best.name]?.cost ?? 0) ? c : best
    )
  } else {
    let r: number
    ;[s, r] = rngNext(s)
    target = buildable[Math.floor(r * buildable.length)]
  }

  const def = BUILDING_CARDS[target.name]!
  const cost = Math.max(0, def.cost - discount)
  const payment = player.hand.filter(c => c.id !== target.id).slice(0, cost).map(c => c.id)
  ;[s] = constructBuilding(s, playerId, target.id, payment, drawAfter)
  return s
}

// ---- build-farm-free ----

export function cpuBuildFarmFree(state: GameState, playerId: number, strategy: CpuStrategy = 'random'): GameState {
  const player = getPlayer(state, playerId)
  const farmCards = player.hand.filter(c => {
    if (c.kind !== 'building') return false
    return BUILDING_CARDS[c.name]?.tags.includes('farm') ?? false
  }) as (BuildingCard & { kind: 'building' })[]
  if (farmCards.length === 0) return state

  let target: BuildingCard & { kind: 'building' }
  let s = state
  if (strategy === 'greedy') {
    target = farmCards.reduce((best, c) =>
      (BUILDING_CARDS[c.name]?.assetValue ?? 0) >= (BUILDING_CARDS[best.name]?.assetValue ?? 0) ? c : best
    )
  } else {
    let r: number
    ;[s, r] = rngNext(s)
    target = farmCards[Math.floor(r * farmCards.length)]
  }
  ;[s] = constructBuilding(s, playerId, target.id, [], 0)
  return s
}

// ---- build-double ----

export function cpuBuildDouble(state: GameState, playerId: number, strategy: CpuStrategy = 'random'): GameState {
  const player = getPlayer(state, playerId)
  const buildings = player.hand.filter(c => c.kind === 'building') as (BuildingCard & { kind: 'building' })[]

  const costGroups: Record<number, typeof buildings> = {}
  for (const c of buildings) {
    const cost = BUILDING_CARDS[c.name]?.cost ?? 0
    costGroups[cost] = [...(costGroups[cost] ?? []), c]
  }
  const validCosts = Object.entries(costGroups).filter(([costStr, cards]) => {
    if (cards.length < 2) return false
    const cost = parseInt(costStr)
    return buildings.length - 2 >= cost
  })
  if (validCosts.length === 0) return state

  let chosenEntry: [string, typeof buildings]
  let s = state
  if (strategy === 'greedy') {
    chosenEntry = validCosts.reduce((best, entry) => parseInt(entry[0]) >= parseInt(best[0]) ? entry : best)
  } else if (strategy === 'disruptive') {
    chosenEntry = validCosts.reduce((best, entry) => parseInt(entry[0]) <= parseInt(best[0]) ? entry : best)
  } else {
    let r: number
    ;[s, r] = rngNext(s)
    chosenEntry = validCosts[Math.floor(r * validCosts.length)]
  }

  const [, sameCostCards] = chosenEntry
  const first = sameCostCards[0]
  const second = sameCostCards[1]
  const cost = BUILDING_CARDS[first.name]?.cost ?? 0
  const payment = buildings.filter(c => c.id !== first.id && c.id !== second.id).slice(0, cost).map(c => c.id)
  ;[s] = constructBuilding(s, playerId, first.id, payment, 0)
  ;[s] = constructBuilding(s, playerId, second.id, [], 0)
  return s
}
