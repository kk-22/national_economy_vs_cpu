import type { PlaySummary } from '../game/historyStats'

const SAVE_KEY = 'ne-play-history'

export interface PlayHistoryRecord {
  id: string
  summary: PlaySummary
}

function generateId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

export function usePlayHistory() {
  function loadPlayHistory(): PlayHistoryRecord[] {
    try {
      const raw = localStorage.getItem(SAVE_KEY)
      if (!raw) return []
      const data = JSON.parse(raw)
      return Array.isArray(data) ? data as PlayHistoryRecord[] : []
    } catch { return [] }
  }

  function appendPlayRecord(summary: PlaySummary): void {
    try {
      const records = loadPlayHistory()
      records.push({ id: generateId(), summary })
      localStorage.setItem(SAVE_KEY, JSON.stringify(records))
    } catch { /* quota超過などは無視 */ }
  }

  function deletePlayRecord(id: string): void {
    try {
      const records = loadPlayHistory().filter(r => r.id !== id)
      localStorage.setItem(SAVE_KEY, JSON.stringify(records))
    } catch { /* quota超過などは無視 */ }
  }

  return { loadPlayHistory, appendPlayRecord, deletePlayRecord }
}
