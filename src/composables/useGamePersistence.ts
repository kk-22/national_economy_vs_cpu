import { toRaw } from 'vue'
import type { GameState } from '../game/types'

const SAVE_KEY = 'ne-game-save'

// localStorage への保存・読込のみを担当する。history のインスタンス管理（再代入）は
// 呼び出し元（useGame.ts）が行う ―― history は状況に応じて丸ごと差し替わるため、
// このcomposable自身には保持させない。
export function useGamePersistence() {
  function saveGameState(game: GameState | null, historyObj: unknown): void {
    if (!game) return
    try {
      const data = { game: toRaw(game), history: historyObj }
      localStorage.setItem(SAVE_KEY, JSON.stringify(data))
    } catch { /* quota超過などは無視 */ }
  }

  function hasSavedGame(): boolean {
    try {
      const raw = localStorage.getItem(SAVE_KEY)
      if (!raw) return false
      const data = JSON.parse(raw)
      return !!data?.game
    } catch { return false }
  }

  function loadSavedGame(): { game: GameState; historyObj: unknown } | null {
    try {
      const raw = localStorage.getItem(SAVE_KEY)
      if (!raw) return null
      const data = JSON.parse(raw)
      if (!data?.game) return null
      return { game: data.game as GameState, historyObj: data.history }
    } catch { return null }
  }

  function clearSavedGame(): void {
    localStorage.removeItem(SAVE_KEY)
  }

  return { saveGameState, hasSavedGame, loadSavedGame, clearSavedGame }
}
