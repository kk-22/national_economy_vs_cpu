import type { GameState, Player, Worker, HandCard, OwnedBuilding, PublicWorkplace, GameEffect } from '../types'

// ---- ID counter (テスト内でユニークなIDを生成) ----

let _counter = 1
export function resetIds(): void { _counter = 1 }
function uid(prefix: string): string { return `${prefix}-${_counter++}` }

// ---- カード生成 ----

export function makeBuildingCard(name: string): HandCard & { kind: 'building' } {
  return { kind: 'building', id: uid('card'), name }
}

export function makeConsumptionCard(): HandCard & { kind: 'consumption' } {
  return { kind: 'consumption', id: uid('con') }
}

export function makeOwnedBuilding(name: string): OwnedBuilding {
  return { id: uid('bld'), name, workerHereId: null }
}

// ---- PublicWorkplace生成 ----

export function makePublicWorkplace(name: string, effect: GameEffect, overrides: Partial<PublicWorkplace> = {}): PublicWorkplace {
  return {
    id: uid('wp'),
    name,
    effect,
    allowMultiple: false,
    workerIds: [],
    ...overrides,
  }
}

// ---- Worker生成 ----

export function makeWorker(playerId: number, overrides: Partial<Worker> = {}): Worker {
  return {
    id: uid('w'),
    playerId,
    isTraining: false,
    placedAt: null,
    ...overrides,
  }
}

// ---- Player生成 ----
// デフォルト: CPU・greedy・手札なし・ワーカー2人（どちらも配置可能）

export function makePlayer(overrides: Partial<Player> = {}): Player {
  const id = overrides.id ?? 0
  const baseWorkers = [makeWorker(id), makeWorker(id)]
  return {
    id,
    name: `CPU${id}`,
    isCpu: true,
    cpuStrategy: 'greedy',
    money: 20,
    hand: [],
    ownedBuildings: [],
    workers: baseWorkers,
    unpaidWages: 0,
    ...overrides,
    // workersだけはoverridesで上書き可能にするため、overridesにworkersがあれば使う
    // （上の...overridesで既に上書きされるので追記不要）
  }
}

// ---- State変化の検査ヘルパー ----

/** before→after でどの一般職場にワーカーが置かれたか（名前を返す） */
export function usedPublicWorkplace(before: GameState, after: GameState): string | null {
  for (const wp of after.publicWorkplaces) {
    const prev = before.publicWorkplaces.find(w => w.id === wp.id)
    if (prev && wp.workerIds.length > prev.workerIds.length) return wp.name
  }
  return null
}

/** before→after で新たに建設された建物の名前を返す */
export function builtBuilding(before: GameState, after: GameState, playerId: number): string | null {
  const prevIds = new Set(before.players.find(p => p.id === playerId)!.ownedBuildings.map(b => b.id))
  const newB = after.players.find(p => p.id === playerId)!.ownedBuildings.find(b => !prevIds.has(b.id))
  return newB?.name ?? null
}

/** before→after で自分の建物にワーカーを置いた建物の名前を返す */
export function usedOwnedBuilding(before: GameState, after: GameState, playerId: number): string | null {
  const prevBuildings = before.players.find(p => p.id === playerId)!.ownedBuildings
  const afterBuildings = after.players.find(p => p.id === playerId)!.ownedBuildings
  for (const b of afterBuildings) {
    const prev = prevBuildings.find(pb => pb.id === b.id)
    if (prev && prev.workerHereId === null && b.workerHereId !== null) return b.name
  }
  return null
}

// ---- GameState生成 ----

export function makeState(players: Player[], overrides: Partial<GameState> = {}): GameState {
  return {
    round: 1,
    currentPlayerIndex: 0,
    startPlayerIndex: 0,
    players,
    publicWorkplaces: [],
    buildingDeck: [],
    discardPile: [],
    household: 50,
    phase: 'placement',
    pendingAction: null,
    log: [],
    _nextId: 2000,
    _rngSeed: 42,
    _rngState: 42,
    ...overrides,
  }
}
