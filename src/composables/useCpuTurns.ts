import { availableWorkers } from '../game/primitives'
import { cpuOneTurnStep, skipEmptyPlayerTurn } from '../game/turns'
import { processRoundEnd } from '../game/round'
import type { GameState } from '../game/types'
import type { HistoryEntry } from '../game/history'

interface CpuTurnsDeps {
  state: { game: GameState | null }
  pushHistoryEntry: (entry: HistoryEntry) => void
}

// CPUの手番進行（バッチ実行・1ステップ実行・スタック時の自動スキップ・遅延ラウンド終了）を担当する。
export function useCpuTurns({ state, pushHistoryEntry }: CpuTurnsDeps) {
  // 安全策: プレイヤーのターンなのにワーカーが0のとき自動スキップ
  function autoAdvanceIfStuck() {
    if (!state.game) return
    state.game = skipEmptyPlayerTurn(state.game)
  }

  // バッチ実行（スキップモード用）— 1ステップずつ history に記録する
  function runCpuTurns() {
    if (!state.game || state.game.phase !== 'placement') return
    if (state.game.pendingAction) return
    const firstCurrent = state.game.players[state.game.currentPlayerIndex]
    if (!firstCurrent?.isCpu) return

    let maxSteps = 500  // 安全上限
    while (maxSteps-- > 0) {
      if (!state.game || state.game.phase !== 'placement' || state.game.pendingAction) break
      const curr = state.game.players[state.game.currentPlayerIndex]
      if (!curr?.isCpu) break

      // ワーカーを置くステップのみ history に記録（turn advance は記録しない）
      const hadWorkers = availableWorkers(curr).length > 0
      if (hadWorkers) {
        const entry: HistoryEntry = { playerId: curr.id, targetId: '__cpu__', targetName: curr.name, timestamp: Date.now() }
        pushHistoryEntry(entry)
        const { state: next, target } = cpuOneTurnStep(state.game)
        if (next === state.game) break  // 変化なし（安全策）
        if (target) {
          entry.cpuTargetId = target.id
          entry.cpuTargetType = target.type
        }
        state.game = next
      } else {
        const { state: next } = cpuOneTurnStep(state.game)
        if (next === state.game) break
        state.game = next
      }
    }
  }

  // 1ステップ実行（アニメーションあり）
  function cpuStepAction() {
    if (!state.game || state.game.phase !== 'placement') return
    if (state.game.pendingAction) return  // 保留アクション中は実行しない
    const current = state.game.players[state.game.currentPlayerIndex]
    if (!current?.isCpu) return
    const hadWorkers = availableWorkers(current).length > 0
    if (hadWorkers) {
      const entry: HistoryEntry = { playerId: current.id, targetId: '__cpu__', targetName: current.name, timestamp: Date.now() }
      pushHistoryEntry(entry)
      // deferRoundEnd=true: Vue層のアニメーション完了後に triggerRoundEnd() でラウンド終了処理を行うため
      const { state: next, target } = cpuOneTurnStep(state.game, true)
      if (target) {
        entry.cpuTargetId = target.id
        entry.cpuTargetType = target.type
      }
      state.game = next
    } else {
      const { state: next } = cpuOneTurnStep(state.game)
      if (next !== state.game) state.game = next
    }
  }

  function triggerRoundEnd() {
    if (!state.game?._pendingRoundEnd) return
    state.game = processRoundEnd({ ...state.game, _pendingRoundEnd: undefined }, true)
  }

  return { autoAdvanceIfStuck, runCpuTurns, cpuStepAction, triggerRoundEnd }
}
