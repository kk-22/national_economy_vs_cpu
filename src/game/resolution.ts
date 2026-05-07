import { getPlayer, addLog } from './primitives'
import { undoWorkerPlacement } from './build'
import type { GameState, BuildingCard } from './types'

export function toggleDiscardSelection(state: GameState, cardId: string): GameState {
  const action = state.pendingAction
  if (!action || action.kind !== 'choose-discard') return state
  const selected = action.selected.includes(cardId)
    ? action.selected.filter(id => id !== cardId)
    : [...action.selected, cardId]
  return { ...state, pendingAction: { ...action, selected } }
}

export function toggleHandLimitSelection(state: GameState, cardId: string): GameState {
  const pa = state.pendingAction
  if (!pa || pa.kind !== 'choose-hand-limit') return state
  const selected = pa.selected.includes(cardId)
    ? pa.selected.filter(id => id !== cardId)
    : [...pa.selected, cardId]
  return { ...state, pendingAction: { ...pa, selected } }
}

export function cancelDiscardChoice(state: GameState): GameState {
  const pa = state.pendingAction
  if (!pa || pa.kind !== 'choose-discard') return state
  const player = getPlayer(state, pa.playerId)
  let s = undoWorkerPlacement(state, pa.playerId, ['discard-gain', 'discard-draw'], pa.sourceId)
  return addLog(s, `${player.name}: ${pa.sourceName ?? ''} → キャンセル`)
}

export function cancelRevealedChoice(state: GameState): GameState {
  const pa = state.pendingAction
  if (!pa || pa.kind !== 'choose-from-revealed') return state
  const player = getPlayer(state, pa.playerId)
  const discarded = pa.revealed.filter(c => c.kind === 'building') as BuildingCard[]
  let s: GameState = { ...state, discardPile: [...state.discardPile, ...discarded] }
  s = undoWorkerPlacement(s, pa.playerId, ['reveal-pick'], pa.sourceId)
  return addLog(s, `${player.name}: ${pa.sourceName ?? ''} → キャンセル`)
}
