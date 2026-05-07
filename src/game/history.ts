import type { GameState } from './types'

export interface CardRef {
  id: string
  name: string
}

export interface HistoryEntry {
  playerId: number           // 0=プレイヤー, 1〜3=CPU
  targetId: string           // 配置先ID（公共施設 or 所有建物）
  targetName: string         // 配置先名
  builtCard?: CardRef        // 建設したカード
  secondBuiltCard?: CardRef  // 2棟目（二胡市建設）
  paymentCards?: CardRef[]   // コストで払ったカード
  discardedCards?: CardRef[] // 捨てたカード
  pickedCard?: CardRef       // 選んだカード（設計事務所）
  timestamp: number          // ミリ秒
}

export class GameHistory {
  readonly initialSeed: number
  private snapshots: GameState[] = []
  private futureSnapshots: GameState[] = []
  readonly actionLog: HistoryEntry[] = []
  private futureLog: HistoryEntry[] = []

  constructor(seed: number) {
    this.initialSeed = seed
  }

  push(preState: GameState, entry: HistoryEntry): void {
    this.snapshots.push(preState)
    this.actionLog.push(entry)
    this.futureSnapshots = []
    this.futureLog = []
  }

  undo(currentState: GameState): GameState | null {
    if (this.snapshots.length === 0) return null
    if (!currentState.pendingAction) {
      this.futureSnapshots.unshift(currentState)
      this.futureLog.unshift(this.actionLog.pop()!)
    } else {
      this.futureSnapshots = []
      this.futureLog = []
      this.actionLog.pop()
    }
    return this.snapshots.pop()!
  }

  redo(currentState: GameState): GameState | null {
    if (this.futureSnapshots.length === 0) return null
    this.snapshots.push(currentState)
    this.actionLog.push(this.futureLog.shift()!)
    return this.futureSnapshots.shift()!
  }

  get canUndo(): boolean { return this.snapshots.length > 0 }
  get canRedo(): boolean { return this.futureSnapshots.length > 0 }

  clear(): void {
    this.snapshots = []
    this.futureSnapshots = []
    this.actionLog.length = 0
    this.futureLog = []
  }

  toJSON(): string {
    return JSON.stringify({ initialSeed: this.initialSeed, actionLog: this.actionLog })
  }

  static fromJSON(json: string): GameHistory {
    const d = JSON.parse(json)
    const h = new GameHistory(d.initialSeed)
    h.actionLog.push(...d.actionLog)
    return h
  }
}
