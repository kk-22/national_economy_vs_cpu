import { getPlayer, updatePlayer, addLog, genId, drawCards, ALL_BUILDING_CARDS, buildActionLog } from './primitives'
import type { GameState, HandCard, BuildingCard, OwnedBuilding } from './types'

/** 建設する建物の条件付きコスト割引を計算する */
export function getConstructionDiscount(state: GameState, playerId: number, cardName: string): number {
  const def = ALL_BUILDING_CARDS[cardName]
  const cd = def?.constructionDiscount
  if (!cd) return 0
  const player = getPlayer(state, playerId)
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
      const def = ALL_BUILDING_CARDS[b.name]
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
    const def = ALL_BUILDING_CARDS[c.name]
    const selfDiscount = getConstructionDiscount(state, playerId, c.name)
    const cost = Math.max(0, def.cost - discount - selfDiscount)
    return player.hand.length - 1 >= cost
  }) as (HandCard & { kind: 'building' })[]
}

export function getFarmBuildableCards(state: GameState, playerId: number): (HandCard & { kind: 'building' })[] {
  const player = getPlayer(state, playerId)
  return player.hand.filter(c =>
    c.kind === 'building' && (ALL_BUILDING_CARDS[c.name]?.tags.includes('farm') ?? false)
  ) as (HandCard & { kind: 'building' })[]
}

export function getDoubleBuildableFirstCards(state: GameState, playerId: number): (HandCard & { kind: 'building' })[] {
  const player = getPlayer(state, playerId)
  const buildings = player.hand.filter(c => c.kind === 'building') as (HandCard & { kind: 'building' })[]
  const costGroups: Record<number, (HandCard & { kind: 'building' })[]> = {}
  for (const c of buildings) {
    const cost = ALL_BUILDING_CARDS[c.name]?.cost ?? 0
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
  const def = ALL_BUILDING_CARDS[card.name]!
  const selfDiscount = getConstructionDiscount(state, action.playerId, card.name)
  const cost = Math.max(0, def.cost - action.discount - selfDiscount)
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
      sourceId: action.sourceId,
    },
  }
}

export function selectDoubleFirst(state: GameState, cardId: string): GameState {
  const action = state.pendingAction
  if (!action || action.kind !== 'choose-double-first') return state
  const player = getPlayer(state, action.playerId)
  const card = player.hand.find(c => c.id === cardId)
  if (!card || card.kind !== 'building') return state
  const def = ALL_BUILDING_CARDS[card.name]!
  return {
    ...state,
    pendingAction: { kind: 'choose-double-second', playerId: action.playerId, firstCost: def.cost, firstId: card.id, sourceName: action.sourceName, sourceId: action.sourceId },
  }
}

export function selectDoubleSecond(state: GameState, cardId: string): GameState {
  const action = state.pendingAction
  if (!action || action.kind !== 'choose-double-second') return state
  const player = getPlayer(state, action.playerId)
  const card = player.hand.find(c => c.id === cardId)
  if (!card || card.kind !== 'building') return state
  const def = ALL_BUILDING_CARDS[card.name]!
  if (def.cost !== action.firstCost) return state
  if (card.id === action.firstId) return state
  return {
    ...state,
    pendingAction: { kind: 'choose-double-payment', playerId: action.playerId, firstId: action.firstId, secondId: card.id, cost: action.firstCost, firstCost: action.firstCost, sourceName: action.sourceName, sourceId: action.sourceId },
  }
}

export function cancelBuildChoice(state: GameState): GameState {
  const pa = state.pendingAction
  if (!pa) return state
  if (pa.kind !== 'choose-build-target' && pa.kind !== 'choose-farm-build' && pa.kind !== 'choose-double-first') return state
  const player = getPlayer(state, pa.playerId)
  let s = undoWorkerPlacement(state, pa.playerId, ['build', 'build-farm-free', 'build-double'], pa.sourceId)
  return addLog(s, `${player.name}: ${pa.sourceName ?? ''} → キャンセル`)
}

export function cancelBuildPayment(state: GameState): GameState {
  const action = state.pendingAction
  if (!action || action.kind !== 'choose-build-payment') return state
  return { ...state, pendingAction: { kind: 'choose-build-target', playerId: action.playerId, discount: action.discount, drawAfter: action.drawAfter, sourceName: action.sourceName, sourceId: action.sourceId } }
}

export function cancelDoubleSecond(state: GameState): GameState {
  const action = state.pendingAction
  if (!action || action.kind !== 'choose-double-second') return state
  return { ...state, pendingAction: { kind: 'choose-double-first', playerId: action.playerId, sourceName: action.sourceName, sourceId: action.sourceId } }
}

export function cancelDoublePayment(state: GameState): GameState {
  const action = state.pendingAction
  if (!action || action.kind !== 'choose-double-payment') return state
  return { ...state, pendingAction: { kind: 'choose-double-first', playerId: action.playerId, sourceName: action.sourceName, sourceId: action.sourceId } }
}

// ---- メセナ専用ビルド関数 ----

// 売却禁止建物（canSell:false）のみを対象とする建設候補
export function getNoSellBuildableCards(state: GameState, playerId: number): (HandCard & { kind: 'building' })[] {
  const player = getPlayer(state, playerId)
  return player.hand.filter(c => {
    if (c.kind !== 'building') return false
    const def = ALL_BUILDING_CARDS[c.name]
    if (!def || def.canSell) return false
    const selfDiscount = getConstructionDiscount(state, playerId, c.name)
    const cost = Math.max(0, def.cost - selfDiscount)
    return player.hand.length - 1 >= cost
  }) as (HandCard & { kind: 'building' })[]
}

// 資産価値がmaxAsset以下の建物（無料建設対象）
export function getFreeBuildableCards(state: GameState, playerId: number, maxAsset: number): (HandCard & { kind: 'building' })[] {
  const player = getPlayer(state, playerId)
  return player.hand.filter(c => {
    if (c.kind !== 'building') return false
    const def = ALL_BUILDING_CARDS[c.name]
    if (!def) return false
    return def.assetValue <= maxAsset
  }) as (HandCard & { kind: 'building' })[]
}

// 地球建設: 1棟目選択
export function selectBuildTwoFirst(state: GameState, cardId: string): GameState {
  const action = state.pendingAction
  if (!action || action.kind !== 'choose-build-two-first') return state
  const player = getPlayer(state, action.playerId)
  const card = player.hand.find(c => c.id === cardId)
  if (!card || card.kind !== 'building') return state
  const def = ALL_BUILDING_CARDS[card.name]!
  const buildings = player.hand.filter(c => c.kind === 'building')
  if (buildings.length < 2) return state
  // 割引を適用したコストで記録（0未満にはならない）
  const discount = getConstructionDiscount(state, action.playerId, card.name)
  const firstCost = Math.max(0, def.cost - discount)
  return {
    ...state,
    pendingAction: { kind: 'choose-build-two-second', playerId: action.playerId, firstId: card.id, firstCost, sourceName: action.sourceName, sourceId: action.sourceId },
  }
}

// 地球建設: 2棟目選択
export function selectBuildTwoSecond(state: GameState, cardId: string): GameState {
  const action = state.pendingAction
  if (!action || action.kind !== 'choose-build-two-second') return state
  if (cardId === action.firstId) return state
  const player = getPlayer(state, action.playerId)
  const card = player.hand.find(c => c.id === cardId)
  if (!card || card.kind !== 'building') return state
  const def = ALL_BUILDING_CARDS[card.name]!
  // 割引を適用した合計コストで判定（0未満にはならない）
  const discount = getConstructionDiscount(state, action.playerId, card.name)
  const secondCost = Math.max(0, def.cost - discount)
  const totalCost = action.firstCost + secondCost
  // 手札から2棟を除いた残りが合計コスト以上必要
  if (player.hand.length - 2 < totalCost) return state
  return {
    ...state,
    pendingAction: { kind: 'choose-build-two-payment', playerId: action.playerId, firstId: action.firstId, secondId: card.id, totalCost, sourceName: action.sourceName, sourceId: action.sourceId },
  }
}

// 地球建設: 支払い確定
export function confirmBuildTwoPayment(state: GameState, paymentIds: string[]): GameState {
  const action = state.pendingAction
  if (!action || action.kind !== 'choose-build-two-payment') return state
  if (paymentIds.length !== action.totalCost) return state
  const beforePlayer = getPlayer(state, action.playerId)
  let s = state
  ;[s] = constructBuilding(s, action.playerId, action.firstId, paymentIds, 0)
  ;[s] = constructBuilding(s, action.playerId, action.secondId, [], 0)
  // 建設後手札0枚なら3枚ドロー
  const afterPlayer = getPlayer(s, action.playerId)
  if (afterPlayer.hand.length === 0) s = drawCards(s, action.playerId, 3)
  s = { ...s, pendingAction: null }
  const afterPlayer2 = getPlayer(s, action.playerId)
  s = addLog(s, buildActionLog(action.sourceName ?? '', 'build-two', beforePlayer, afterPlayer2, state.startPlayerIndex, s.startPlayerIndex))
  return s
}

// プレハブ工務店: 資産価値maxAsset以下の建物を無料建設
export function confirmFreeBuild(state: GameState, cardId: string): GameState {
  const action = state.pendingAction
  if (!action || action.kind !== 'choose-free-build') return state
  const beforePlayer = getPlayer(state, action.playerId)
  const card = beforePlayer.hand.find(c => c.id === cardId)
  if (!card || card.kind !== 'building') return state
  const def = ALL_BUILDING_CARDS[card.name]
  if (!def || def.assetValue > action.maxAsset) return state
  let s: GameState
  ;[s] = constructBuilding(state, action.playerId, card.id, [], 0)
  s = { ...s, pendingAction: null }
  const afterPlayer = getPlayer(s, action.playerId)
  s = addLog(s, buildActionLog(action.sourceName ?? '', 'build-free-if-cheap', beforePlayer, afterPlayer, state.startPlayerIndex, s.startPlayerIndex))
  return s
}

// 建築会社: 売却禁止建物を建設コスト払いで建設し、N枚ドロー
export function selectNoSellBuildTarget(state: GameState, cardId: string): GameState {
  const action = state.pendingAction
  if (!action || action.kind !== 'choose-no-sell-build') return state
  const player = getPlayer(state, action.playerId)
  const card = player.hand.find(c => c.id === cardId)
  if (!card || card.kind !== 'building') return state
  const def = ALL_BUILDING_CARDS[card.name]
  if (!def || def.canSell) return state
  const selfDiscount = getConstructionDiscount(state, action.playerId, card.name)
  const cost = Math.max(0, def.cost - selfDiscount)
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
      discount: 0,
      sourceName: action.sourceName,
      sourceId: action.sourceId,
    },
  }
}

