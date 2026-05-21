import { BUILDING_CARDS, ROUND_CARDS } from './constants'
import { makeSeed } from './random'
import { nextId, genId, buildDeck, drawCards, drawConsumption, rngNext, updatePlayer, addLog } from './primitives'
import { flipRoundCard } from './round'
import type { GameState, GameConfig, Player, BuildingCard } from './types'

export function createGame(config: GameConfig): GameState {
  const playerCount = config.cpuOnly ? config.cpuCount : 1 + config.cpuCount
  const seed = config.seed ?? makeSeed()

  let state: GameState = {
    round: 1,
    currentPlayerIndex: 0,
    startPlayerIndex: 0,
    players: [],
    publicWorkplaces: [],
    buildingDeck: [],
    discardPile: [],
    household: 0,
    phase: 'placement',
    pendingAction: null,
    log: [],
    _nextId: 0,
    _rngSeed: seed,
    _rngState: seed,
  }

  let deck: BuildingCard[]
  ;[state, deck] = buildDeck(state)
  state = { ...state, buildingDeck: deck }

  const players: Player[] = []
  let cpuIndex = 0
  for (let i = 0; i < playerCount; i++) {
    const isCpu = config.cpuOnly ? true : i > 0
    const name = isCpu ? `CPU ${config.cpuOnly ? i + 1 : i}` : config.humanName

    let w1Id: string, w2Id: string
    ;[state, w1Id] = nextId(state)
    ;[state, w2Id] = nextId(state)

    const cpuStrategy = isCpu ? (config.cpuStrategies?.[cpuIndex] ?? 'random') : 'random'
    if (isCpu) cpuIndex++

    players.push({
      id: i,
      name,
      isCpu,
      cpuStrategy,
      money: 0,  // 手番順決定後に再割り当て
      hand: [],
      ownedBuildings: [],
      workers: [
        { id: w1Id, playerId: i, isTraining: false, placedAt: null },
        { id: w2Id, playerId: i, isTraining: false, placedAt: null },
      ],
      unpaidWages: 0,
    })
  }
  state = { ...state, players }

  for (const p of state.players) {
    state = drawCards(state, p.id, 3)
  }

  const rawOrder = config.playerOrder ?? 1
  let startIdx: number
  if (rawOrder === 0) {
    let r: number
    ;[state, r] = rngNext(state)
    startIdx = Math.floor(r * playerCount)
  } else {
    const n = Math.min(rawOrder, playerCount)
    startIdx = (playerCount - (n - 1)) % playerCount
  }
  state = { ...state, currentPlayerIndex: startIdx, startPlayerIndex: startIdx }

  // 手番順（startIdx 起点）に応じて初期所持金を配る：1手目 $5、2手目 $6、…
  state = {
    ...state,
    players: state.players.map((p, i) => {
      const turnPosition = (i - startIdx + playerCount) % playerCount
      return { ...p, money: 5 + turnPosition }
    }),
  }

  state = flipRoundCard(state, 1, playerCount)
  state = addLog(state, 'ゲーム開始！')

  return state
}

export function createDebugGame(cpuCount: number = 3): GameState {
  const cpuN = Math.min(Math.max(1, cpuCount), 3)
  const playerCount = 1 + cpuN
  const playerNames = ['プレイヤー', 'CPU 1', 'CPU 2', 'CPU 3']
  const seed = makeSeed()

  let state: GameState = {
    round: 8,
    currentPlayerIndex: 0,
    startPlayerIndex: 0,
    players: [],
    publicWorkplaces: [],
    buildingDeck: [],
    discardPile: [],
    household: 40,
    phase: 'placement',
    pendingAction: null,
    log: ['【デバッグ】ラウンド8スタート'],
    _nextId: 0,
    _rngSeed: seed,
    _rngState: seed,
  }

  let deck: BuildingCard[]
  ;[state, deck] = buildDeck(state)
  state = { ...state, buildingDeck: deck }

  const players: Player[] = []
  for (let i = 0; i < playerCount; i++) {
    const isCpu = i > 0
    let w1: string, w2: string, w3: string
    ;[state, w1] = nextId(state)
    ;[state, w2] = nextId(state)
    ;[state, w3] = nextId(state)
    players.push({
      id: i,
      name: playerNames[i],
      isCpu,
      cpuStrategy: 'random' as const,
      money: 20,
      hand: [],
      ownedBuildings: [],
      workers: [
        { id: w1, playerId: i, isTraining: false, placedAt: null },
        { id: w2, playerId: i, isTraining: false, placedAt: null },
        { id: w3, playerId: i, isTraining: false, placedAt: null },
      ],
      unpaidWages: 0,
    })
  }
  state = { ...state, players }

  for (const p of state.players) {
    for (const def of Object.values(BUILDING_CARDS)) {
      let bId: string
      ;[state, bId] = genId(state, 'b-')
      state = updatePlayer(state, p.id, pl => ({
        ...pl,
        ownedBuildings: [...pl.ownedBuildings, { id: bId, name: def.name, workerHereId: null }],
      }))
    }
  }

  for (const p of state.players) {
    state = drawCards(state, p.id, 10)
    state = drawConsumption(state, p.id, 3)
  }

  const seen = new Set<string>()
  for (const rc of ROUND_CARDS.slice(0, 8)) {
    for (const wp of rc.workplaces) {
      if (!seen.has(wp.name)) {
        seen.add(wp.name)
        let wpId: string
        ;[state, wpId] = genId(state, 'wp-dbg-')
        const allowMultiple = typeof wp.allowMultiple === 'function' ? wp.allowMultiple(playerCount) : wp.allowMultiple
        state = {
          ...state,
          publicWorkplaces: [...state.publicWorkplaces, {
            id: wpId,
            kind: 'round' as const,
            name: wp.name,
            effect: wp.effect,
            allowMultiple,
            workerIds: [],
          }],
        }
      }
    }
  }

  const canSellDefs = Object.values(BUILDING_CARDS)
    .filter(d => d.canSell)
    .sort((a, b) => a.cost - b.cost || a.name.localeCompare(b.name))
  for (const def of canSellDefs) {
    let wpId: string
    ;[state, wpId] = genId(state, 'wp-dbg-bld-')
    state = {
      ...state,
      publicWorkplaces: [...state.publicWorkplaces, {
        id: wpId,
        kind: 'sold' as const,
        name: def.name,
        effect: def.effect,
        allowMultiple: false,
        workerIds: [],
      }],
    }
  }

  return state
}
