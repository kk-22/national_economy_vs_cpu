import { ALL_BUILDING_CARDS } from './primitives'
import { availableWorkers, workerCount, getMaxWorkers, getPlayer } from './primitives'
import { getConstructionDiscount } from './build'
import type { GameState, Player, PublicWorkplace, OwnedBuilding, GameEffect, BuildingCardDef } from './types'

// 手札に「discount割引後のコストを払って建設できる」建物が1枚でもあるか判定する
// （filter で対象建物をさらに絞り込める。例: build-no-sell は canSell:false のみ対象）
function hasAffordableBuilding(
  player: Player,
  state: GameState | undefined,
  discount: number,
  filter?: (def: BuildingCardDef) => boolean,
): boolean {
  return player.hand.some(c => {
    if (c.kind !== 'building') return false
    const def = ALL_BUILDING_CARDS[c.name]
    if (!def) return false
    if (filter && !filter(def)) return false
    const selfDiscount = state ? getConstructionDiscount(state, player.id, c.name) : 0
    const cost = Math.max(0, def.cost - discount - selfDiscount)
    return player.hand.length - 1 >= cost
  })
}

function canUseEffect(effect: GameEffect, player: Player, household = Infinity, state?: GameState): boolean {
  switch (effect.kind) {
    case 'gain-supply':     return household >= effect.n
    case 'discard-draw':    return player.hand.length >= effect.discard
    case 'discard-gain':    return player.hand.length >= effect.discard && household >= effect.gain
    case 'add-worker':      return workerCount(player) < getMaxWorkers(player)
    case 'fill-workers':    return workerCount(player) < Math.min(effect.target, getMaxWorkers(player))
    case 'build':           return hasAffordableBuilding(player, state, effect.discount)
    case 'build-farm-free': return player.hand.some(c =>
      c.kind === 'building' && (ALL_BUILDING_CARDS[c.name]?.tags.includes('farm') ?? false)
    )
    case 'build-double': {
      const buildings = player.hand.filter(c => c.kind === 'building')
      const costGroups: Record<number, number> = {}
      for (const c of buildings) {
        if (c.kind !== 'building') continue
        const cost = ALL_BUILDING_CARDS[c.name]?.cost ?? 0
        costGroups[cost] = (costGroups[cost] ?? 0) + 1
      }
      return Object.entries(costGroups).some(([costStr, cnt]) => {
        if (cnt < 2) return false
        const cost = parseInt(costStr)
        return player.hand.length - 2 >= cost
      })
    }
    case 'draw-consumption-hold': return !state || state.round < 9
    case 'draw-consumption-to': return player.hand.length < effect.target
    case 'reveal-pick':     return true
    // --- メセナ専用 ---
    case 'draw-consumption-by-hand': return player.hand.length < 3  // 手札3枚以上は配置不可
    case 'discard-gain-household':   return player.hand.length >= effect.discard && household >= effect.minHousehold
    case 'draw-if-mine': {
      // 自コマが「鉱山」に配置済みの場合のみ可
      if (!state) return true
      return state.publicWorkplaces.some(wp => wp.name === '鉱山' && wp.workerIds.some(wId => player.workers.some(w => w.id === wId)))
    }
    case 'gain-household':           return household >= effect.minHousehold
    case 'gain-per-consumption': {
      const consCount = player.hand.filter(c => c.kind === 'consumption').length
      return consCount > 0 && household >= consCount * effect.perCard
    }
    case 'discard-draw-min-hand':    return player.hand.length >= effect.minHand  // minHand枚未満は不可（minHand枚以上必要）
    case 'discard-gain-household-min': return player.hand.length >= effect.discard && household >= effect.minHousehold
    case 'build-no-sell':            return hasAffordableBuilding(player, state, 0, def => !def.canSell)
    case 'build-free-if-cheap':      return player.hand.some(c =>
      c.kind === 'building' && (ALL_BUILDING_CARDS[c.name]?.assetValue ?? Infinity) <= effect.maxAsset
    )
    case 'build-two': {
      const buildings = player.hand.filter(c => c.kind === 'building')
      if (buildings.length < 2) return false
      // 支払い可能なペアが1つ以上存在するか確認
      return buildings.some((c1, i) =>
        buildings.slice(i + 1).some(c2 => {
          if (c1.kind !== 'building' || c2.kind !== 'building') return false
          const d1 = state ? getConstructionDiscount(state, player.id, c1.name) : 0
          const d2 = state ? getConstructionDiscount(state, player.id, c2.name) : 0
          const totalCost = Math.max(0, (ALL_BUILDING_CARDS[c1.name]?.cost ?? 0) - d1) + Math.max(0, (ALL_BUILDING_CARDS[c2.name]?.cost ?? 0) - d2)
          return player.hand.length - 2 >= totalCost
        })
      )
    }
    case 'build-gain-vp':            return hasAffordableBuilding(player, state, effect.discount)
    // --- グローリー専用 ---
    case 'draw-consumption-or-discard-draw': return true
    case 'build-then-draw-consumption': return hasAffordableBuilding(player, state, effect.discount)
    case 'draw-consumption-odd-even': return true
    case 'build-draw-if-empty': return hasAffordableBuilding(player, state, effect.discount)
    case 'gain-household-by-workers': {
      // 配置後に他の未配置コマが残るかどうかで実際の獲得額を予測する（effects.ts と一致させる）
      const willHaveOtherKoma = availableWorkers(player).length > 1
      const predictedGain = willHaveOtherKoma ? effect.withWorker : effect.withoutWorker
      return household >= predictedGain
    }
    case 'gain-household-if-hand': {
      const predictedGain = player.hand.length === effect.exactHand ? effect.gain : effect.otherwise
      return household >= predictedGain
    }
    case 'build-consumption-double':  return player.hand.some(c => {
      if (c.kind !== 'building') return false
      const def = ALL_BUILDING_CARDS[c.name]
      if (!def) return false
      const selfDiscount = state ? getConstructionDiscount(state, player.id, c.name) : 0
      const cost = Math.max(0, def.cost - selfDiscount)
      const rest = player.hand.filter(h => h.id !== c.id)
      const buildingSlots = rest.filter(h => h.kind === 'building').length
      const consumptionSlots = rest.filter(h => h.kind === 'consumption').length * 2
      return buildingSlots + consumptionSlots >= cost
    })
    case 'draw-gain-household': return household >= effect.gain
    case 'build-free-any':      return player.hand.some(c => c.kind === 'building')
    default:                    return true
  }
}

function canUseWorkplace(effect: GameEffect, currentWorkers: number, allowMultiple: boolean, player: Player, household: number, state: GameState): boolean {
  if (currentWorkers > 0 && !allowMultiple) return false
  return canUseEffect(effect, player, household, state)
}


export function getAvailableOwnedBuildings(state: GameState, playerId: number): OwnedBuilding[] {
  const player = getPlayer(state, playerId)
  const freeKoma = availableWorkers(player).length
  if (freeKoma === 0) return []
  return player.ownedBuildings.filter(b => {
    const def = ALL_BUILDING_CARDS[b.name]
    if (!def || !def.isWorkplace) return false
    if (b.workerHereId !== null) return false
    if (def.requiresDoubleWorker && freeKoma < 2) return false
    return canUseEffect(def.effect, player, state.household, state)
  })
}

export function getAvailablePublicWorkplaces(state: GameState, playerId: number): PublicWorkplace[] {
  const player = getPlayer(state, playerId)
  const freeKoma = availableWorkers(player).length
  if (freeKoma === 0) return []
  return state.publicWorkplaces.filter(wp => {
    const def = ALL_BUILDING_CARDS[wp.name]
    if (def?.requiresDoubleWorker && freeKoma < 2) return false
    return canUseWorkplace(wp.effect, wp.workerIds.length, wp.allowMultiple, player, state.household, state)
  })
}
