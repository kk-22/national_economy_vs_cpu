import { getPlayer, drawCards, drawConsumption, shuffle, nextId, updatePlayer, workerCount, getMaxWorkers, addLog, availableWorkers, ALL_BUILDING_CARDS } from './primitives'
import { FREE_BUILD_ANY_LIMIT } from './constants'
import { getBuildableCards, getFarmBuildableCards, getDoubleBuildableFirstCards, getNoSellBuildableCards, getFreeBuildableCards, getBuildableCardsConsumptionDouble, getConstructionDiscount } from './build'
import { cpuRevealPick, cpuDiscardDraw, cpuDiscardGain, cpuBuild, cpuBuildFarmFree, cpuBuildDouble, cpuBuildNoSell, cpuBuildFree, cpuBuildTwo } from './cpu'
import type { GameState, GameEffect, Worker, HandCard, BuildingCard, OwnedBuilding, CpuStrategy } from './types'

// 消費財を手札に持つことで直接利益を得る効果
const CONSUMPTION_VALUE_EFFECT_KINDS = new Set([
  'p-per-consumption',          // 農協: 手札消費財枚数×勝利点
  'gain-per-consumption',       // 観光牧場: 手札消費財枚数×収入
  'p-if-consumption-in-hand-min', // 収穫祭: 手札消費財が規定枚数以上で終了ボーナス
  'build-consumption-double',   // モダニズム建設: 建設コスト支払い時に消費財1枚=2コスト
])

// 自分の場に消費財を有効活用できる建物があるか
export function hasConsumptionValueBuilding(ownedBuildings: OwnedBuilding[]): boolean {
  return ownedBuildings.some(b => CONSUMPTION_VALUE_EFFECT_KINDS.has(ALL_BUILDING_CARDS[b.name]?.effect.kind ?? ''))
}

// round.ts の手札上限処理でも使用する
export function preSelectConsumptions(hand: HandCard[], count: number, series: string, ownedBuildings: OwnedBuilding[] = []): string[] {
  // 消費財を有効活用できる建物がある場合はデフォルト選択しない
  if (hasConsumptionValueBuilding(ownedBuildings)) return []
  const consumptions = hand.filter(c => c.kind === 'consumption')
  // メセナシリーズでは消費財を最低1枚残す
  const maxAutoSelect = series === 'mecenat'
    ? Math.max(0, Math.min(count, consumptions.length - 1))
    : count
  return consumptions.slice(0, maxAutoSelect).map(c => c.id)
}

export function applyEffect(state: GameState, playerId: number, effect: GameEffect, isCpu: boolean, strategy: CpuStrategy = 'random'): GameState {
  const player = getPlayer(state, playerId)

  switch (effect.kind) {
    case 'none': return state

    case 'draw':
      return drawCards(state, playerId, effect.n)

    case 'draw-become-start': {
      let s = drawCards(state, playerId, 1)
      if (s.startPlayerIndex !== playerId) {
        s = { ...s, startPlayerIndex: playerId }
      }
      return s
    }

    case 'draw-consumption':
      return drawConsumption(state, playerId, effect.n)

    case 'slash-burn':
      return drawConsumption(state, playerId, 5)

    case 'gain-supply': {
      let s = { ...state, household: state.household - effect.n }
      s = updatePlayer(s, playerId, p => ({ ...p, money: p.money + effect.n }))
      return s
    }

    case 'reveal-pick': {
      if (isCpu) return cpuRevealPick(state, playerId, effect.n, strategy)
      const revealed: HandCard[] = []
      let s = state
      for (let i = 0; i < effect.n; i++) {
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
      return { ...s, pendingAction: { kind: 'choose-from-revealed', playerId, revealed } }
    }

    case 'discard-draw': {
      if (isCpu) return cpuDiscardDraw(state, playerId, effect.discard, effect.draw, strategy)
      return {
        ...state,
        pendingAction: { kind: 'choose-discard', playerId, count: effect.discard, gainAmount: -1, selected: preSelectConsumptions(player.hand, effect.discard - 1, state.series, player.ownedBuildings), drawCount: effect.draw },
      }
    }

    case 'build': {
      if (isCpu) return cpuBuild(state, playerId, effect.discount, effect.drawAfter, strategy)
      if (getBuildableCards(state, playerId, effect.discount).length === 0) return state
      return { ...state, pendingAction: { kind: 'choose-build-target', playerId, discount: effect.discount, drawAfter: effect.drawAfter } }
    }

    case 'build-farm-free': {
      if (isCpu) return cpuBuildFarmFree(state, playerId, strategy)
      if (getFarmBuildableCards(state, playerId).length === 0) return state
      return { ...state, pendingAction: { kind: 'choose-farm-build', playerId } }
    }

    case 'draw-consumption-to': {
      const current = player.hand.length
      const need = Math.max(0, effect.target - current)
      return drawConsumption(state, playerId, need)
    }

    case 'draw-if-empty': {
      const n = player.hand.length === 0 ? effect.empty : effect.normal
      return drawCards(state, playerId, n)
    }

    case 'discard-gain': {
      if (isCpu) return cpuDiscardGain(state, playerId, effect.discard, effect.gain, strategy)
      return {
        ...state,
        pendingAction: { kind: 'choose-discard', playerId, count: effect.discard, gainAmount: effect.gain, selected: preSelectConsumptions(player.hand, effect.discard - 1, state.series, player.ownedBuildings) },
      }
    }

    case 'add-worker': {
      if (workerCount(player) >= getMaxWorkers(player)) return state
      let wId: string
      let s: GameState
      ;[s, wId] = nextId(state)
      const newWorker: Worker = { id: wId, playerId, isTraining: !effect.immediate, placedAt: null }
      s = updatePlayer(s, playerId, p => ({ ...p, workers: [...p.workers, newWorker] }))
      return s
    }

    case 'fill-workers': {
      const maxW = getMaxWorkers(player)
      const fillTo = Math.min(effect.target, maxW)
      const current = workerCount(player)
      if (current >= fillTo) return state
      let s = state
      for (let i = current; i < fillTo; i++) {
        if (workerCount(getPlayer(s, playerId)) >= maxW) break
        let wId: string
        ;[s, wId] = nextId(s)
        s = updatePlayer(s, playerId, p => ({
          ...p,
          workers: [...p.workers, { id: wId, playerId, isTraining: true, placedAt: null }],
        }))
      }
      return s
    }

    case 'build-double': {
      if (isCpu) return cpuBuildDouble(state, playerId, strategy)
      if (getDoubleBuildableFirstCards(state, playerId).length === 0) return state
      return { ...state, pendingAction: { kind: 'choose-double-first', playerId } }
    }

    // --- メセナ専用 ---

    case 'draw-consumption-by-hand': {
      const handCount = player.hand.length
      if (handCount >= 3) return state  // 手札3枚以上は使用不可（availability で弾くが念のため）
      const n = handCount === 0 ? 3 : handCount === 1 ? 2 : 1
      return drawConsumption(state, playerId, n)
    }

    case 'discard-gain-household': {
      if (isCpu) return cpuDiscardGain(state, playerId, effect.discard, effect.gain, strategy)
      return {
        ...state,
        pendingAction: { kind: 'choose-discard', playerId, count: effect.discard, gainAmount: effect.gain, selected: preSelectConsumptions(player.hand, effect.discard - 1, state.series, player.ownedBuildings) },
      }
    }

    case 'draw-if-mine': {
      // 自コマが鉱山に配置済みの場合のみ建物をN枚引く（availability で弾いているが念のため確認）
      const isAtMine = state.publicWorkplaces.some(wp => wp.name === '鉱山' && wp.workerIds.some(wId => player.workers.some(w => w.id === wId)))
      if (!isAtMine) return state
      return drawCards(state, playerId, effect.n)
    }

    case 'build-gain-vp': {
      const buildable = getBuildableCards(state, playerId, effect.discount)
      if (buildable.length === 0) return state
      if (isCpu) {
        let s = cpuBuild(state, playerId, effect.discount, effect.drawAfter, strategy)
        // 建設できた場合のみ勝利点を加算
        const built = getPlayer(s, playerId).ownedBuildings.length > player.ownedBuildings.length
        if (built) s = updatePlayer(s, playerId, p => ({ ...p, victoryPoints: p.victoryPoints + 1 }))
        return s
      }
      return { ...state, pendingAction: { kind: 'choose-build-target', playerId, discount: effect.discount, drawAfter: effect.drawAfter } }
    }

    case 'draw-gain-vp': {
      let s = effect.drawType === 'consumption'
        ? drawConsumption(state, playerId, effect.n)
        : drawCards(state, playerId, effect.n)
      s = updatePlayer(s, playerId, p => ({ ...p, victoryPoints: p.victoryPoints + 1 }))
      s = addLog(s, `${player.name} が勝利点カードを取得（計${getPlayer(s, playerId).victoryPoints}枚）`)
      return s
    }

    case 'draw-consumption-if-have': {
      const hasConsumption = player.hand.some(c => c.kind === 'consumption')
      const n = hasConsumption ? effect.withConsumption : effect.without
      return drawConsumption(state, playerId, n)
    }

    case 'gain-per-consumption': {
      const consCount = player.hand.filter(c => c.kind === 'consumption').length
      const gain = consCount * effect.perCard
      if (gain <= 0 || state.household < gain) return state
      let s = { ...state, household: state.household - gain }
      return updatePlayer(s, playerId, p => ({ ...p, money: p.money + gain }))
    }

    case 'gain-household': {
      if (state.household < effect.minHousehold) return state
      let s = { ...state, household: state.household - effect.take + (effect.take - effect.net) }
      return updatePlayer(s, playerId, p => ({ ...p, money: p.money + effect.net }))
    }

    case 'build-free-if-cheap': {
      if (isCpu) return cpuBuildFree(state, playerId, effect.maxAsset, strategy)
      if (getFreeBuildableCards(state, playerId, effect.maxAsset).length === 0) return state
      return { ...state, pendingAction: { kind: 'choose-free-build', playerId, maxAsset: effect.maxAsset } }
    }

    case 'build-two': {
      if (isCpu) return cpuBuildTwo(state, playerId, strategy)
      const buildings = player.hand.filter(c => c.kind === 'building')
      if (buildings.length < 2) return state
      // 支払い可能なペアが存在しない場合は何もしない
      const hasPair = buildings.some((c1, i) =>
        buildings.slice(i + 1).some(c2 => {
          if (c1.kind !== 'building' || c2.kind !== 'building') return false
          const d1 = getConstructionDiscount(state, playerId, c1.name)
          const d2 = getConstructionDiscount(state, playerId, c2.name)
          const totalCost = Math.max(0, (ALL_BUILDING_CARDS[c1.name]?.cost ?? 0) - d1) + Math.max(0, (ALL_BUILDING_CARDS[c2.name]?.cost ?? 0) - d2)
          return player.hand.length - 2 >= totalCost
        })
      )
      if (!hasPair) return state
      return { ...state, pendingAction: { kind: 'choose-build-two-first', playerId } }
    }

    case 'draw-consumption-hold': {
      // 消費財をN枚引いて次ラウンド開始時に手札に加える
      const brewBuilding = player.ownedBuildings.find(b => b.name === '醸造所' && b.workerHereId !== null)
      if (brewBuilding) {
        // 自分の所有建物の醸造所
        return updatePlayer(state, playerId, p => ({
          ...p,
          ownedBuildings: p.ownedBuildings.map(b =>
            b.id === brewBuilding.id ? { ...b, storedConsumption: (b.storedConsumption ?? 0) + effect.n } : b
          ),
        }))
      }
      // 一般職場（売却済み）の醸造所: プレイヤーに直接保留
      return updatePlayer(state, playerId, p => ({
        ...p,
        pendingConsumption: (p.pendingConsumption ?? 0) + effect.n,
      }))
    }

    case 'discard-draw-min-hand': {
      if (player.hand.length < effect.minHand) return state  // minHand枚未満は不可（availability.tsと一致させること）
      if (isCpu) return cpuDiscardDraw(state, playerId, effect.discard, effect.draw, strategy)
      return {
        ...state,
        pendingAction: { kind: 'choose-discard', playerId, count: effect.discard, gainAmount: -1, selected: preSelectConsumptions(player.hand, effect.discard - 1, state.series, player.ownedBuildings), drawCount: effect.draw },
      }
    }

    case 'draw-with-build-discount': {
      // N枚ドロー。建設割引は constructionDiscount で定義（建設時に getConstructionDiscount で計算）
      return drawCards(state, playerId, effect.n)
    }

    case 'discard-gain-household-min': {
      if (state.household < effect.minHousehold) return state
      if (isCpu) return cpuDiscardGain(state, playerId, effect.discard, effect.gain, strategy)
      return {
        ...state,
        pendingAction: { kind: 'choose-discard', playerId, count: effect.discard, gainAmount: effect.gain, selected: preSelectConsumptions(player.hand, effect.discard - 1, state.series, player.ownedBuildings) },
      }
    }

    case 'build-no-sell': {
      if (isCpu) return cpuBuildNoSell(state, playerId, effect.drawAfter, strategy)
      if (getNoSellBuildableCards(state, playerId).length === 0) return state
      return { ...state, pendingAction: { kind: 'choose-no-sell-build', playerId, drawAfter: effect.drawAfter } }
    }

    // 終了時効果はラウンド終了の calculateScores で処理するため実行時は何もしない
    case 'p-if-empty-hand':
    case 'p-vp-double':
    case 'p-if-own-n-buildings':
    case 'p-if-tag-n':
    case 'p-if-no-sell-n':
    case 'p-vp-build-discount':
      return state

    // --- グローリー専用 ---

    // on-build-gain-vp / on-build-gain-automaton は constructBuilding 内で処理
    case 'on-build-gain-vp':
    case 'on-build-gain-automaton':
      return state

    case 'draw-consumption-or-discard-draw': {
      if (isCpu) {
        // CPU: 手札が少なければ消費財引き、多ければ消費財を直接捨てて建物引き
        const consCount = player.hand.filter(c => c.kind === 'consumption').length
        if (player.hand.length < 4 || consCount < effect.n) {
          return drawConsumption(state, playerId, effect.n)
        }
        const toDiscard = player.hand.filter(c => c.kind === 'consumption').slice(0, effect.n)
        const toDiscardIds = new Set(toDiscard.map(c => c.id))
        let s = updatePlayer(state, playerId, p => ({ ...p, hand: p.hand.filter(c => !toDiscardIds.has(c.id)) }))
        return drawCards(s, playerId, effect.n + 1)
      }
      return { ...state, pendingAction: { kind: 'choose-consumption-or-discard', playerId, n: effect.n } }
    }

    case 'build-then-draw-consumption': {
      const buildable = getBuildableCards(state, playerId, effect.discount)
      if (buildable.length === 0) return state
      if (isCpu) {
        const beforeLen = player.ownedBuildings.length
        let s = cpuBuild(state, playerId, effect.discount, 0, strategy)
        const built = getPlayer(s, playerId).ownedBuildings.length > beforeLen
        if (built) s = drawConsumption(s, playerId, effect.consumption)
        return s
      }
      return {
        ...state,
        pendingAction: {
          kind: 'choose-build-target',
          playerId,
          discount: effect.discount,
          drawAfter: 0,
          consumptionAfter: effect.consumption,
        },
      }
    }

    case 'draw-consumption-odd-even': {
      const handCount = player.hand.length
      const n = handCount % 2 === 0 ? effect.even : effect.odd
      return drawConsumption(state, playerId, n)
    }

    case 'build-draw-if-empty': {
      const buildable = getBuildableCards(state, playerId, effect.discount)
      if (buildable.length === 0) return state
      if (isCpu) {
        const beforeLen = player.ownedBuildings.length
        let s = cpuBuild(state, playerId, effect.discount, 0, strategy)
        const built = getPlayer(s, playerId).ownedBuildings.length > beforeLen
        if (built && getPlayer(s, playerId).hand.length === 0) s = drawCards(s, playerId, effect.drawAfterEmpty)
        return s
      }
      return {
        ...state,
        pendingAction: {
          kind: 'choose-build-target',
          playerId,
          discount: effect.discount,
          drawAfter: 0,
          drawAfterEmpty: effect.drawAfterEmpty,
        },
      }
    }

    case 'gain-household-by-workers': {
      // このコマは既に配置済みの状態で呼ばれるため、他に未配置のコマが残っているかで判定する
      const hasOtherKoma = availableWorkers(player).length > 0
      const gain = hasOtherKoma ? effect.withWorker : effect.withoutWorker
      if (state.household < gain) return state
      let s = { ...state, household: state.household - gain }
      return updatePlayer(s, playerId, p => ({ ...p, money: p.money + gain }))
    }

    case 'gain-household-if-hand': {
      const gain = player.hand.length === effect.exactHand ? effect.gain : effect.otherwise
      if (state.household < gain) return state
      let s = { ...state, household: state.household - gain }
      return updatePlayer(s, playerId, p => ({ ...p, money: p.money + gain }))
    }

    case 'build-consumption-double': {
      const buildable = getBuildableCardsConsumptionDouble(state, playerId)
      if (buildable.length === 0) return state
      if (isCpu) {
        // CPU は通常のビルド（消費財最適化なし）
        return cpuBuild(state, playerId, 0, 0, strategy)
      }
      return {
        ...state,
        pendingAction: {
          kind: 'choose-build-target',
          playerId,
          discount: 0,
          drawAfter: 0,
          consumptionDouble: true,
        },
      }
    }

    case 'draw-gain-household': {
      let s = drawCards(state, playerId, effect.n)
      if (s.household < effect.gain) return s
      s = { ...s, household: s.household - effect.gain }
      return updatePlayer(s, playerId, p => ({ ...p, money: p.money + effect.gain }))
    }

    case 'build-free-any': {
      if (isCpu) return cpuBuildFree(state, playerId, FREE_BUILD_ANY_LIMIT, strategy)
      if (getFreeBuildableCards(state, playerId, FREE_BUILD_ANY_LIMIT).length === 0) return state
      return { ...state, pendingAction: { kind: 'choose-free-build', playerId, maxAsset: FREE_BUILD_ANY_LIMIT } }
    }

    // 恒久効果・終了時効果は他の箇所で処理するため実行時は何もしない
    case 'p-hand-limit':
    case 'p-worker-limit':
    case 'p-forgive-wages':
    case 'p-per-building':
    case 'p-per-consumption':
    case 'p-per-worker':
    case 'p-per-no-sell':
    case 'p-per-factory':
    case 'p-if-tag-asset-min':
    case 'p-if-has-both-tags':
    case 'p-if-vp-min':
    case 'p-if-workers-min':
    case 'p-if-consumption-in-hand-min':
    case 'p-if-only-no-sell':
      return state

    default: {
      const _exhaustive: never = effect
      return _exhaustive
    }
  }
}
