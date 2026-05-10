import type { GameState } from './types'

export interface CardRef {
  id: string
  name: string
}

export interface HistoryEntry {
  playerId: number
  targetId: string           // 配置先ID（一般職場 or 所有建物）。CPU は '__cpu__'
  targetName: string
  builtCard?: CardRef
  secondBuiltCard?: CardRef
  paymentCards?: CardRef[]
  discardedCards?: CardRef[]
  pickedCard?: CardRef
  handLimitDiscarded?: string[]  // 手札上限超過で捨てたカードID
  soldBuildingIds?: string[]     // 賃金不足で売却した建物ID
  timestamp: number
}

export class GameHistory {
  readonly initialSeed: number
  private _initialState: GameState | null = null
  readonly actionLog: HistoryEntry[] = []
  private _redoLog: HistoryEntry[] = []

  constructor(seed: number) {
    this.initialSeed = seed
  }

  setInitialState(state: GameState): void {
    this._initialState = state
  }

  get initialState(): GameState | null { return this._initialState }

  push(entry: HistoryEntry): void {
    this.actionLog.push(entry)
    this._redoLog = []
  }

  peekLastEntry(): HistoryEntry | null {
    return this.actionLog[this.actionLog.length - 1] ?? null
  }

  popEntry(addToRedo: boolean): HistoryEntry | null {
    if (this.actionLog.length === 0) return null
    const entry = this.actionLog.pop()!
    if (addToRedo) this._redoLog.unshift(entry)
    return entry
  }

  peekNextRedo(): HistoryEntry | null {
    return this._redoLog[0] ?? null
  }

  pushFromRedo(): HistoryEntry | null {
    if (this._redoLog.length === 0) return null
    const entry = this._redoLog.shift()!
    this.actionLog.push(entry)
    return entry
  }

  clearRedo(): void {
    this._redoLog = []
  }

  get canUndo(): boolean { return this.actionLog.length > 0 && this._initialState !== null }
  get canRedo(): boolean { return this._redoLog.length > 0 }

  clear(): void {
    this._initialState = null
    this.actionLog.length = 0
    this._redoLog = []
  }

  toObject(): object {
    return {
      initialSeed: this.initialSeed,
      initialState: this._initialState,
      actionLog: this.actionLog,
      redoLog: this._redoLog,
    }
  }

  static fromObject(data: unknown): GameHistory {
    const d = data as Record<string, unknown>
    const h = new GameHistory(d.initialSeed as number)
    if (d.initialState) h._initialState = d.initialState as import('./types').GameState
    h.actionLog.push(...((d.actionLog as HistoryEntry[]) ?? []))
    h._redoLog = (d.redoLog as HistoryEntry[]) ?? []
    return h
  }
}
