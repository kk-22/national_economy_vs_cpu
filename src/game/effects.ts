import { getPlayer, addLog, drawCards, drawConsumption, shuffle, nextId, updatePlayer, workerCount, getMaxWorkers } from './primitives'
import { getBuildableCards, getFarmBuildableCards, getDoubleBuildableFirstCards } from './build'
import { cpuRevealPick, cpuDiscardDraw, cpuDiscardGain, cpuBuild, cpuBuildFarmFree, cpuBuildDouble } from './cpu'
import type { GameState, GameEffect, Worker, HandCard, BuildingCard, CpuStrategy } from './types'

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
        s = addLog(s, `${player.name} がスタートプレイヤーになりました`)
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
        pendingAction: { kind: 'choose-discard', playerId, count: effect.discard, gainAmount: -1, selected: [], drawCount: effect.draw },
      }
    }

    case 'build': {
      if (isCpu) return cpuBuild(state, playerId, effect.discount, effect.drawAfter, strategy)
      if (getBuildableCards(state, playerId, effect.discount).length === 0)
        return addLog(state, `${player.name} は建設できる建物がないためスキップ`)
      return { ...state, pendingAction: { kind: 'choose-build-target', playerId, discount: effect.discount, drawAfter: effect.drawAfter } }
    }

    case 'build-farm-free': {
      if (isCpu) return cpuBuildFarmFree(state, playerId, strategy)
      if (getFarmBuildableCards(state, playerId).length === 0)
        return addLog(state, `${player.name} は建設できる農場がないためスキップ`)
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
        pendingAction: { kind: 'choose-discard', playerId, count: effect.discard, gainAmount: effect.gain, selected: [] },
      }
    }

    case 'add-worker': {
      if (workerCount(player) >= getMaxWorkers(player)) return state
      let wId: string
      let s: GameState
      ;[s, wId] = nextId(state)
      const newWorker: Worker = { id: wId, playerId, isTraining: !effect.immediate, placedAt: null }
      s = updatePlayer(s, playerId, p => ({ ...p, workers: [...p.workers, newWorker] }))
      s = addLog(s, `${player.name} が労働者を${effect.immediate ? '即戦力で' : '研修中として'}雇用`)
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
      s = addLog(s, `${player.name} の労働者が${fillTo}人になりました（研修中）`)
      return s
    }

    case 'build-double': {
      if (isCpu) return cpuBuildDouble(state, playerId, strategy)
      if (getDoubleBuildableFirstCards(state, playerId).length === 0)
        return addLog(state, `${player.name} は同コストの建物ペアがないためスキップ`)
      return { ...state, pendingAction: { kind: 'choose-double-first', playerId } }
    }

    default: return state
  }
}
