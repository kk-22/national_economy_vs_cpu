import { ROUND_CARDS } from './constants'
import { rngNext, shuffle, updatePlayer, getPlayer, drawCards, ALL_BUILDING_CARDS } from './primitives'
import { constructBuilding, getConstructionDiscount } from './build'
import type { GameState, HandCard, BuildingCard, CpuStrategy } from './types'

export const MCTS_SIMULATIONS = 10

// greedy CPU が全ラウンドを通じて建設しない建物
// 珈琲店: gain-supply 効果が household 依存で弱い
// 倉庫・社宅: パッシブ効果だが得点貢献が低く投資効率が悪い
export const GREEDY_BUILD_EXCLUDED = new Set(['珈琲店', '倉庫', '社宅'])

/** state なしで player から建設コスト割引を計算（cpu-scoring.ts 用） */
export function getConstructionDiscountForPlayer(player: { ownedBuildings: { name: string }[]; victoryPoints: number }, cardName: string): number {
  const cd = ALL_BUILDING_CARDS[cardName]?.constructionDiscount
  if (!cd) return 0
  if (cd.condition === 'own-tag') {
    return player.ownedBuildings.some(b => ALL_BUILDING_CARDS[b.name]?.tags.includes(cd.tag)) ? cd.discount : 0
  }
  if (cd.condition === 'own-vp-min') {
    return player.victoryPoints >= cd.minVp ? cd.discount : 0
  }
  if (cd.condition === 'per-owned-tag') {
    const count = player.ownedBuildings.filter(b => ALL_BUILDING_CARDS[b.name]?.tags.includes(cd.tag)).length
    return count * cd.discountPerTag
  }
  return 0
}

// ---- 捨て札ソート（greedy/disruptive 共通: 消費財→低value建物の順） ----

function sortedDiscardIds(hand: HandCard[], count: number): string[] {
  const sorted = [...hand].sort((a, b) => {
    if (a.kind === 'consumption' && b.kind !== 'consumption') return -1
    if (b.kind === 'consumption' && a.kind !== 'consumption') return 1
    if (a.kind === 'building' && b.kind === 'building') {
      return (ALL_BUILDING_CARDS[a.name]?.assetValue ?? 0) - (ALL_BUILDING_CARDS[b.name]?.assetValue ?? 0)
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
  if (strategy === 'greedy' || strategy === 'beam') {
    // assetValue 最大のカードを選ぶ
    pick = revealed.reduce((best, c) => {
      if (c.kind !== 'building') return best
      if (best.kind !== 'building') return c
      return (ALL_BUILDING_CARDS[c.name]?.assetValue ?? 0) >= (ALL_BUILDING_CARDS[best.name]?.assetValue ?? 0) ? c : best
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
  const ids = (strategy === 'greedy' || strategy === 'beam' || strategy === 'disruptive')
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
  const ids = (strategy === 'greedy' || strategy === 'beam' || strategy === 'disruptive')
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
    const def = ALL_BUILDING_CARDS[c.name]!
    const selfDiscount = getConstructionDiscount(state, playerId, c.name)
    const cost = Math.max(0, def.cost - discount - selfDiscount)
    return player.hand.length - 1 >= cost
  }) as (BuildingCard & { kind: 'building' })[]

  if (buildable.length === 0) return state

  if (strategy === 'greedy' || strategy === 'beam') {
    const availableAfter = player.workers.filter(w => !w.isTraining && w.placedAt === null).length
    // 建てて即売り損パターンを除外、7ラウンド以下は配置不可建物（職場でない建物）を建てない
    buildable = buildable.filter(c => {
      if (GREEDY_BUILD_EXCLUDED.has(c.name)) return false
      const def = ALL_BUILDING_CARDS[c.name]!
      if (def.effect.kind.startsWith('p-')) {
        // パッシブ効果: R8以降で得点があれば建設対象
        return state.round >= 8 && def.assetValue > 0
      }
      // 7ラウンド以下は職場として使えない建物（倉庫など）を建設対象から除外
      if (state.round <= 7 && !def.isWorkplace) return false
      if (availableAfter >= 1) {
        const selfDiscount = getConstructionDiscount(state, playerId, c.name)
        const remainingHand = player.hand.length - 1 - Math.max(0, def.cost - discount - selfDiscount)
        if (def.effect.kind === 'build' && remainingHand + drawAfter < 2) return false
        return true
      }
      // availableAfter === 0: Fix 1 - money が賃金以上なら建設OK
      const expectedWageCpu = player.workers.length * (ROUND_CARDS[state.round - 1]?.wage ?? 0)
      if (player.money >= expectedWageCpu) return true
      const cardCost = Math.max(0, def.cost - discount) + 1
      return def.assetValue > cardCost * 6
    })
    if (buildable.length === 0) return state
  }

  let target: BuildingCard & { kind: 'building' }
  let s = state
  if (strategy === 'greedy' || strategy === 'beam') {
    // ラウンド8-9は残りラウンドが少なくコスト効果より得点価値が重要
    if (state.round >= 8) {
      target = buildable.reduce((best, c) =>
        (ALL_BUILDING_CARDS[c.name]?.assetValue ?? 0) >= (ALL_BUILDING_CARDS[best.name]?.assetValue ?? 0) ? c : best
      )
    } else {
      target = buildable.reduce((best, c) =>
        (ALL_BUILDING_CARDS[c.name]?.cost ?? 0) >= (ALL_BUILDING_CARDS[best.name]?.cost ?? 0) ? c : best
      )
    }
  } else if (strategy === 'disruptive') {
    target = buildable.reduce((best, c) => {
      const cc = ALL_BUILDING_CARDS[c.name]?.cost ?? 0
      const bc = ALL_BUILDING_CARDS[best.name]?.cost ?? 0
      if (cc !== bc) return cc < bc ? c : best
      return (ALL_BUILDING_CARDS[c.name]?.assetValue ?? 0) <= (ALL_BUILDING_CARDS[best.name]?.assetValue ?? 0) ? c : best
    })
  } else {
    let r: number
    ;[s, r] = rngNext(s)
    target = buildable[Math.floor(r * buildable.length)]
  }

  const def = ALL_BUILDING_CARDS[target.name]!
  const selfDiscount = getConstructionDiscount(state, playerId, target.name)
  const cost = Math.max(0, def.cost - discount - selfDiscount)
  const payment = player.hand.filter(c => c.id !== target.id).slice(0, cost).map(c => c.id)
  ;[s] = constructBuilding(s, playerId, target.id, payment, drawAfter)
  return s
}

// ---- build-farm-free ----

export function cpuBuildFarmFree(state: GameState, playerId: number, strategy: CpuStrategy = 'random'): GameState {
  const player = getPlayer(state, playerId)
  const farmCards = player.hand.filter(c => {
    if (c.kind !== 'building') return false
    return ALL_BUILDING_CARDS[c.name]?.tags.includes('farm') ?? false
  }) as (BuildingCard & { kind: 'building' })[]
  if (farmCards.length === 0) return state

  let target: BuildingCard & { kind: 'building' }
  let s = state
  if (strategy === 'greedy' || strategy === 'beam') {
    target = farmCards.reduce((best, c) =>
      (ALL_BUILDING_CARDS[c.name]?.assetValue ?? 0) >= (ALL_BUILDING_CARDS[best.name]?.assetValue ?? 0) ? c : best
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
    const cost = ALL_BUILDING_CARDS[c.name]?.cost ?? 0
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
  if (strategy === 'greedy' || strategy === 'beam') {
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
  const cost = ALL_BUILDING_CARDS[first.name]?.cost ?? 0
  const payment = buildings.filter(c => c.id !== first.id && c.id !== second.id).slice(0, cost).map(c => c.id)
  ;[s] = constructBuilding(s, playerId, first.id, payment, 0)
  ;[s] = constructBuilding(s, playerId, second.id, [], 0)
  return s
}

// ---- メセナ専用 CPU 関数 ----

// 建築会社: 売却禁止建物を建設コスト払いで建設し、N枚ドロー
export function cpuBuildNoSell(state: GameState, playerId: number, drawAfter: number, strategy: CpuStrategy = 'random'): GameState {
  const player = getPlayer(state, playerId)
  const buildable = player.hand.filter(c => {
    if (c.kind !== 'building') return false
    const def = ALL_BUILDING_CARDS[c.name]
    if (!def || def.canSell) return false
    const selfDiscount = getConstructionDiscount(state, playerId, c.name)
    const cost = Math.max(0, def.cost - selfDiscount)
    return player.hand.length - 1 >= cost
  }) as (BuildingCard & { kind: 'building' })[]
  if (buildable.length === 0) return state

  let target: BuildingCard & { kind: 'building' }
  let s = state
  if (strategy === 'greedy' || strategy === 'beam') {
    target = buildable.reduce((best, c) =>
      (ALL_BUILDING_CARDS[c.name]?.assetValue ?? 0) >= (ALL_BUILDING_CARDS[best.name]?.assetValue ?? 0) ? c : best
    )
  } else {
    let r: number
    ;[s, r] = rngNext(s)
    target = buildable[Math.floor(r * buildable.length)]
  }
  const def = ALL_BUILDING_CARDS[target.name]!
  const selfDiscount = getConstructionDiscount(state, playerId, target.name)
  const cost = Math.max(0, def.cost - selfDiscount)
  const payment = player.hand.filter(c => c.id !== target.id).slice(0, cost).map(c => c.id)
  ;[s] = constructBuilding(s, playerId, target.id, payment, drawAfter)
  return s
}

// プレハブ工務店: 資産価値maxAsset以下の建物を無料建設
export function cpuBuildFree(state: GameState, playerId: number, maxAsset: number, strategy: CpuStrategy = 'random'): GameState {
  const player = getPlayer(state, playerId)
  const buildable = player.hand.filter(c =>
    c.kind === 'building' && (ALL_BUILDING_CARDS[c.name]?.assetValue ?? Infinity) <= maxAsset
  ) as (BuildingCard & { kind: 'building' })[]
  if (buildable.length === 0) return state

  let target: BuildingCard & { kind: 'building' }
  let s = state
  if (strategy === 'greedy' || strategy === 'beam') {
    target = buildable.reduce((best, c) =>
      (ALL_BUILDING_CARDS[c.name]?.assetValue ?? 0) >= (ALL_BUILDING_CARDS[best.name]?.assetValue ?? 0) ? c : best
    )
  } else {
    let r: number
    ;[s, r] = rngNext(s)
    target = buildable[Math.floor(r * buildable.length)]
  }
  ;[s] = constructBuilding(s, playerId, target.id, [], 0)
  return s
}

// 地球建設: 2棟同時建設（合計コスト払い、建設後手札0なら3枚ドロー）
export function cpuBuildTwo(state: GameState, playerId: number, strategy: CpuStrategy = 'random'): GameState {
  const player = getPlayer(state, playerId)
  const buildings = player.hand.filter(c => c.kind === 'building') as (BuildingCard & { kind: 'building' })[]
  if (buildings.length < 2) return state

  let first: BuildingCard & { kind: 'building' }
  let second: BuildingCard & { kind: 'building' }
  let s = state

  if (strategy === 'greedy' || strategy === 'beam') {
    // assetValue最大の2枚を選ぶ（合計コストが払えるか確認、割引を考慮）
    const sorted = [...buildings].sort((a, b) => (ALL_BUILDING_CARDS[b.name]?.assetValue ?? 0) - (ALL_BUILDING_CARDS[a.name]?.assetValue ?? 0))
    // 支払い可能な組み合わせを探す
    let found = false
    for (let i = 0; i < sorted.length && !found; i++) {
      for (let j = i + 1; j < sorted.length && !found; j++) {
        const c1 = sorted[i], c2 = sorted[j]
        const d1 = getConstructionDiscount(state, playerId, c1.name)
        const d2 = getConstructionDiscount(state, playerId, c2.name)
        const totalCost = Math.max(0, (ALL_BUILDING_CARDS[c1.name]?.cost ?? 0) - d1) + Math.max(0, (ALL_BUILDING_CARDS[c2.name]?.cost ?? 0) - d2)
        if (buildings.length - 2 >= totalCost) {
          first = c1; second = c2; found = true
        }
      }
    }
    if (!found) return state
  } else {
    let r1: number, r2: number
    ;[s, r1] = rngNext(s)
    ;[s, r2] = rngNext(s)
    const i1 = Math.floor(r1 * buildings.length)
    let i2 = Math.floor(r2 * (buildings.length - 1))
    if (i2 >= i1) i2++
    first = buildings[i1]
    second = buildings[i2]
    const d1 = getConstructionDiscount(state, playerId, first.name)
    const d2 = getConstructionDiscount(state, playerId, second.name)
    const totalCost = Math.max(0, (ALL_BUILDING_CARDS[first.name]?.cost ?? 0) - d1) + Math.max(0, (ALL_BUILDING_CARDS[second.name]?.cost ?? 0) - d2)
    if (buildings.length - 2 < totalCost) return state
  }
  const d1Final = getConstructionDiscount(s, playerId, first!.name)
  const d2Final = getConstructionDiscount(s, playerId, second!.name)
  const totalCost = Math.max(0, (ALL_BUILDING_CARDS[first!.name]?.cost ?? 0) - d1Final) + Math.max(0, (ALL_BUILDING_CARDS[second!.name]?.cost ?? 0) - d2Final)
  const payment = player.hand.filter(c => c.id !== first!.id && c.id !== second!.id).slice(0, totalCost).map(c => c.id)
  ;[s] = constructBuilding(s, playerId, first!.id, payment, 0)
  ;[s] = constructBuilding(s, playerId, second!.id, [], 0)
  // 建設後手札0枚なら3枚ドロー
  if (getPlayer(s, playerId).hand.length === 0) s = drawCards(s, playerId, 3)
  return s
}
