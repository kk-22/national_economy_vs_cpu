import { toRaw } from 'vue'
import type { GameState } from '../game/types'

const SAVE_KEY = 'ne-game-save'
const SAVE_DEBOUNCE_MS = 400

// localStorage への保存・読込のみを担当する。history のインスタンス管理（再代入）は
// 呼び出し元（useGame.ts）が行う ―― history は状況に応じて丸ごと差し替わるため、
// このcomposable自身には保持させない。
export function useGamePersistence() {
  let saveTimer: ReturnType<typeof setTimeout> | null = null

  function writeGameState(game: GameState, historyObj: unknown): void {
    try {
      const data = { game: toRaw(game), history: historyObj }
      localStorage.setItem(SAVE_KEY, JSON.stringify(data))
    } catch { /* quota超過などは無視 */ }
  }

  // 連続する手番（CPU連打など）でのlocalStorage書き込み頻度を抑えるためdebounceする
  function saveGameState(game: GameState | null, historyObj: unknown): void {
    if (!game) return
    if (saveTimer) clearTimeout(saveTimer)
    saveTimer = setTimeout(() => writeGameState(game, historyObj), SAVE_DEBOUNCE_MS)
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
