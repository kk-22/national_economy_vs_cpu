import { BUILDING_CARDS, MAX_WORKERS_PER_PLAYER } from './constants'
import { SeededRandom } from './random'
import type { GameState, Player, Worker, HandCard, BuildingCard } from './types'

// ---- ID generation ----

export function nextId(state: GameState): [GameState, string] {
  const id = `id-${state._nextId}`
  return [{ ...state, _nextId: state._nextId + 1 }, id]
}

export function genId(state: GameState, prefix = ''): [GameState, string] {
  const id = `${prefix}${state._nextId}`
  return [{ ...state, _nextId: state._nextId + 1 }, id]
}

// ---- RNG utilities ----

export function rngNext(state: GameState): [GameState, number] {
  const rng = new SeededRandom(state._rngState)
  const value = rng.next()
  return [{ ...state, _rngState: rng.getState() }, value]
}

// ---- Deck utilities ----

export function shuffle<T>(state: GameState, arr: T[]): [GameState, T[]] {
  const a = [...arr]
  let s = state
  for (let i = a.length - 1; i > 0; i--) {
    let r: number
    ;[s, r] = rngNext(s)
    const j = Math.floor(r * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return [s, a]
}

export function buildDeck(state: GameState): [GameState, BuildingCard[]] {
  const cards: BuildingCard[] = []
  let s = state
  for (const def of Object.values(BUILDING_CARDS)) {
    for (let i = 0; i < def.count; i++) {
      let id: string
      ;[s, id] = nextId(s)
      cards.push({ id, name: def.name })
    }
  }
  let deck: BuildingCard[]
  ;[s, deck] = shuffle(s, cards)
  return [s, deck]
}

export function makeConsumption(state: GameState): [GameState, HandCard] {
  let id: string
  let s: GameState
  ;[s, id] = nextId(state)
  return [s, { kind: 'consumption', id }]
}

// Draw n cards from deck; cycles discard if needed; uses consumption if still empty
export function drawCards(state: GameState, playerId: number, n: number): GameState {
  let s = state
  let drawn = 0

  while (drawn < n) {
    if (s.buildingDeck.length === 0) {
      if (s.discardPile.length === 0) {
        let card: HandCard
        ;[s, card] = makeConsumption(s)
        s = updatePlayer(s, playerId, p => ({ ...p, hand: [...p.hand, card] }))
        drawn++
        continue
      }
      let shuffled: BuildingCard[]
      ;[s, shuffled] = shuffle(s, s.discardPile)
      s = { ...s, buildingDeck: shuffled, discardPile: [] }
      s = addLog(s, '山札が切れたため捨て札を切り直しました')
    }
    const [card, ...rest] = s.buildingDeck
    s = { ...s, buildingDeck: rest }
    s = updatePlayer(s, playerId, p => ({ ...p, hand: [...p.hand, { kind: 'building' as const, ...card }] }))
    drawn++
  }
  return s
}

export function drawConsumption(state: GameState, playerId: number, n: number): GameState {
  let s = state
  for (let i = 0; i < n; i++) {
    let card: HandCard
    ;[s, card] = makeConsumption(s)
    s = updatePlayer(s, playerId, p => ({ ...p, hand: [...p.hand, card] }))
  }
  return s
}

// ---- Player utilities ----

export function updatePlayer(state: GameState, playerId: number, fn: (p: Player) => Player): GameState {
  return {
    ...state,
    players: state.players.map(p => p.id === playerId ? fn(p) : p),
  }
}

export function getPlayer(state: GameState, playerId: number): Player {
  return state.players.find(p => p.id === playerId)!
}

export function addLog(state: GameState, msg: string): GameState {
  return { ...state, log: [...state.log, msg] }
}

export function workerCount(player: Player): number {
  return player.workers.length
}

export function availableWorkers(player: Player): Worker[] {
  return player.workers.filter(w => !w.isTraining && w.placedAt === null)
}

export function getMaxWorkers(player: Player): number {
  let max = MAX_WORKERS_PER_PLAYER
  for (const b of player.ownedBuildings) {
    const effect = BUILDING_CARDS[b.name]?.effect
    if (effect?.kind === 'p-worker-limit') max += effect.n
  }
  return max
}
