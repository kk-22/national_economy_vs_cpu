import type { GameState } from './types'
import type { HistoryEntry } from './history'
import { availableWorkers } from './primitives'
import { cpuOneTurnStep, placeWorkerOnPublic, placeWorkerOnBuilding,
  selectFarmBuildTarget, confirmBuildPayment, confirmDoublePayment,
  confirmDiscard, confirmDiscardDraw, pickRevealedCard, confirmHandLimitDiscard } from './turns'
import { selectBuildTarget, selectDoubleFirst, selectDoubleSecond } from './build'
import { confirmSellBuildings } from './round'

// pending action をエントリの記録済み選択で自動解決する
function resolvePending(state: GameState, entry: HistoryEntry): GameState {
  let s = state
  let guard = 20
  while (s.pendingAction && guard-- > 0) {
    const pa = s.pendingAction
    switch (pa.kind) {
      case 'choose-build-target': {
        if (!entry.builtCard) return s
        s = selectBuildTarget(s, entry.builtCard.id)
        break
      }
      case 'choose-build-payment': {
        const ids = entry.paymentCards?.map(c => c.id) ?? []
        s = confirmBuildPayment(s, ids)
        break
      }
      case 'choose-farm-build': {
        if (!entry.builtCard) return s
        s = selectFarmBuildTarget(s, entry.builtCard.id)
        break
      }
      case 'choose-double-first': {
        if (!entry.builtCard) return s
        s = selectDoubleFirst(s, entry.builtCard.id)
        break
      }
      case 'choose-double-second': {
        if (!entry.secondBuiltCard) return s
        s = selectDoubleSecond(s, entry.secondBuiltCard.id)
        break
      }
      case 'choose-double-payment': {
        const ids = entry.paymentCards?.map(c => c.id) ?? []
        s = confirmDoublePayment(s, ids)
        break
      }
      case 'choose-discard': {
        const ids = entry.discardedCards?.map(c => c.id) ?? []
        s = { ...s, pendingAction: { ...pa, selected: ids } }
        if (pa.gainAmount === -1) {
          s = confirmDiscardDraw(s, pa.drawCount ?? 4)
        } else {
          s = confirmDiscard(s)
        }
        break
      }
      case 'choose-from-revealed': {
        if (!entry.pickedCard) return s
        s = pickRevealedCard(s, entry.pickedCard.id)
        break
      }
      default:
        return s
    }
  }
  return s
}

// CPU エントリ 1件分を再実行（advance ステップを含む）
function replayCpuEntry(state: GameState): GameState {
  let s = state
  let guard = 200
  while (guard-- > 0) {
    if (s.phase !== 'placement' || s.pendingAction) break
    const curr = s.players[s.currentPlayerIndex]
    if (!curr?.isCpu) break
    const hadWorkers = availableWorkers(curr).length > 0
    s = cpuOneTurnStep(s)
    if (hadWorkers) break  // 1回の配置完了
  }
  return s
}

// 人間エントリ 1件分を再実行
function replayHumanEntry(state: GameState, entry: HistoryEntry): GameState {
  const player = state.players.find(p => p.id === entry.playerId)
  if (!player) return state

  const isOwnedBuilding = player.ownedBuildings.some(b => b.id === entry.targetId)
  let s: GameState
  if (isOwnedBuilding) {
    s = placeWorkerOnBuilding(state, entry.playerId, entry.targetId)
  } else {
    s = placeWorkerOnPublic(state, entry.playerId, entry.targetId)
  }
  return resolvePending(s, entry)
}

// initialState から actionLog の全エントリを順に再実行して状態を返す
export function replayToIndex(initialState: GameState, actionLog: HistoryEntry[]): GameState {
  let s = initialState
  for (const entry of actionLog) {
    if (entry.targetId === '__cpu__') {
      s = replayCpuEntry(s)
    } else if (entry.targetId === '__hand-limit__') {
      if (s.pendingAction?.kind === 'choose-hand-limit') {
        const pa = s.pendingAction
        const ids = entry.handLimitDiscarded ?? []
        s = { ...s, pendingAction: { ...pa, selected: ids } }
        s = confirmHandLimitDiscard(s)
      }
    } else if (entry.targetId === '__sell__') {
      if (s.pendingAction?.kind === 'choose-sell-buildings') {
        s = confirmSellBuildings(s, entry.soldBuildingIds ?? [])
      }
    } else {
      s = replayHumanEntry(s, entry)
    }
  }
  return s
}
