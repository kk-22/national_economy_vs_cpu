/**
 * useGame.undo.test.ts
 * undo/redo の「人間の手番＋直後のCPU応答をまとめて1ブロックとして扱う」挙動のリグレッションテスト。
 * このブロックスキップロジック（useGame.ts の undo/redo）はgit history上で繰り返し修正が
 * 入っている最頻バグ源のため、最小限のシナリオでカバーする。
 */

import { describe, test, expect, beforeEach } from 'vitest'
import { useGame } from '../useGame'

// vitest環境は node のため localStorage が存在しない。useGamePersistence が
// 参照するので最小限のin-memory実装で代替する。
class MemoryStorage {
  private store = new Map<string, string>()
  getItem(key: string) { return this.store.get(key) ?? null }
  setItem(key: string, value: string) { this.store.set(key, value) }
  removeItem(key: string) { this.store.delete(key) }
}
;(globalThis as unknown as { localStorage: Storage }).localStorage = new MemoryStorage() as unknown as Storage

describe('useGame: undo/redo のCPUブロックスキップ', () => {
  beforeEach(() => {
    const g = useGame()
    g.startDebugGame(1, 'progress', 1)  // CPU1体、人間が先手（round 8開始）
  })

  test('人間の手番→CPU応答の後、1回のundoで人間の手番前まで戻る', () => {
    const g = useGame()
    expect(g.isHumanTurn.value).toBe(true)
    expect(g.game.value?.round).toBe(8)

    const sekisaijou = g.game.value!.publicWorkplaces.find(w => w.name === '採石場')!
    expect(sekisaijou.workerIds.length).toBe(0)

    g.clickPublicWorkplace(sekisaijou.id)
    expect(g.game.value?.pendingAction).toBeNull()
    expect(g.isHumanTurn.value).toBe(false)

    g.runCpuTurns()
    expect(g.isHumanTurn.value).toBe(true)
    expect(g.canUndo.value).toBe(true)

    g.undo()

    expect(g.canUndo.value).toBe(false)
    expect(g.isHumanTurn.value).toBe(true)
    expect(g.game.value?.round).toBe(8)
    const humanAfterUndo = g.game.value!.players.find(p => !p.isCpu)!
    expect(humanAfterUndo.workers.every(w => w.placedAt === null)).toBe(true)
    const wpAfterUndo = g.game.value!.publicWorkplaces.find(w => w.name === '採石場')!
    expect(wpAfterUndo.workerIds.length).toBe(0)
  })

  test('undo後にredoするとCPU応答まで含めて再現される', () => {
    const g = useGame()
    const sekisaijou = g.game.value!.publicWorkplaces.find(w => w.name === '採石場')!

    g.clickPublicWorkplace(sekisaijou.id)
    g.runCpuTurns()
    g.undo()
    expect(g.canRedo.value).toBe(true)

    g.redo()

    expect(g.canRedo.value).toBe(false)
    expect(g.isHumanTurn.value).toBe(true)
    const wpAfterRedo = g.game.value!.publicWorkplaces.find(w => w.name === '採石場')!
    expect(wpAfterRedo.workerIds.length).toBe(1)
    const human = g.game.value!.players.find(p => !p.isCpu)!
    expect(human.workers.filter(w => w.placedAt !== null).length).toBe(1)
  })
})
