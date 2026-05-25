import { getPlayer, drawCards, drawConsumption, shuffle, nextId, updatePlayer, workerCount, getMaxWorkers, addLog } from './primitives'
import { getBuildableCards, getFarmBuildableCards, getDoubleBuildableFirstCards, getNoSellBuildableCards, getFreeBuildableCards } from './build'
import { cpuRevealPick, cpuDiscardDraw, cpuDiscardGain, cpuBuild, cpuBuildFarmFree, cpuBuildDouble, cpuBuildNoSell, cpuBuildFree, cpuBuildTwo } from './cpu'
import type { GameState, GameEffect, Worker, HandCard, BuildingCard, CpuStrategy } from './types'

function preSelectConsumptions(hand: HandCard[], count: number): string[] {
  return hand.filter(c => c.kind === 'consumption').slice(0, count).map(c => c.id)
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
        pendingAction: { kind: 'choose-discard', playerId, count: effect.discard, gainAmount: -1, selected: preSelectConsumptions(player.hand, effect.discard - 1), drawCount: effect.draw },
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
        pendingAction: { kind: 'choose-discard', playerId, count: effect.discard, gainAmount: effect.gain, selected: preSelectConsumptions(player.hand, effect.discard - 1) },
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
        pendingAction: { kind: 'choose-discard', playerId, count: effect.discard, gainAmount: effect.gain, selected: preSelectConsumptions(player.hand, effect.discard - 1) },
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
      if (isCpu) return cpuBuildFree(state, playerId, effect.maxCost, strategy)
      if (getFreeBuildableCards(state, playerId, effect.maxCost).length === 0) return state
      return { ...state, pendingAction: { kind: 'choose-free-build', playerId, maxCost: effect.maxCost } }
    }

    case 'build-two': {
      if (isCpu) return cpuBuildTwo(state, playerId, strategy)
      if (player.hand.filter(c => c.kind === 'building').length < 2) return state
      return { ...state, pendingAction: { kind: 'choose-build-two-first', playerId } }
    }

    case 'draw-consumption-hold': {
      // 消費財をN枚引いて醸造所の上に置く（次ラウンド開始時に手札に加える）
      const brewBuilding = player.ownedBuildings.find(b => b.name === '醸造所' && b.workerHereId !== null)
      if (!brewBuilding) return state
      return updatePlayer(state, playerId, p => ({
        ...p,
        ownedBuildings: p.ownedBuildings.map(b =>
          b.id === brewBuilding.id ? { ...b, storedConsumption: (b.storedConsumption ?? 0) + effect.n } : b
        ),
      }))
    }

    case 'discard-draw-min-hand': {
      if (player.hand.length <= effect.minHand) return state
      if (isCpu) return cpuDiscardDraw(state, playerId, effect.discard, effect.draw, strategy)
      return {
        ...state,
        pendingAction: { kind: 'choose-discard', playerId, count: effect.discard, gainAmount: -1, selected: preSelectConsumptions(player.hand, effect.discard - 1), drawCount: effect.draw },
      }
    }

    case 'draw-with-build-discount': {
      // N枚ドロー。工業団地の場合は建設コスト割引（availability ではなく CPU build 判定側で使用）
      return drawCards(state, playerId, effect.n)
    }

    case 'discard-gain-household-min': {
      if (state.household < effect.minHousehold) return state
      if (isCpu) return cpuDiscardGain(state, playerId, effect.discard, effect.gain, strategy)
      return {
        ...state,
        pendingAction: { kind: 'choose-discard', playerId, count: effect.discard, gainAmount: effect.gain, selected: preSelectConsumptions(player.hand, effect.discard - 1) },
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

    default: return state
  }
}
