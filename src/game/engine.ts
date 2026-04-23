import { BUILDING_CARDS, ROUND_CARDS, MAX_WORKERS_PER_PLAYER } from './constants'
import type {
  GameState, GameConfig, Player, Worker, HandCard, BuildingCard,
  OwnedBuilding, PublicWorkplace, GameEffect, ScoreResult
} from './types'

// ---- ID generation ----

function nextId(state: GameState): [GameState, string] {
  const id = `id-${state._nextId}`
  return [{ ...state, _nextId: state._nextId + 1 }, id]
}

function genId(state: GameState, prefix = ''): [GameState, string] {
  const id = `${prefix}${state._nextId}`
  return [{ ...state, _nextId: state._nextId + 1 }, id]
}

// ---- Deck utilities ----

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

function buildDeck(state: GameState): [GameState, BuildingCard[]] {
  const cards: BuildingCard[] = []
  let s = state
  for (const def of Object.values(BUILDING_CARDS)) {
    for (let i = 0; i < def.count; i++) {
      let id: string
      ;[s, id] = nextId(s)
      cards.push({ id, name: def.name })
    }
  }
  return [s, shuffle(cards)]
}

function makeConsumption(state: GameState): [GameState, HandCard] {
  let id: string
  let s: GameState
  ;[s, id] = nextId(state)
  return [s, { kind: 'consumption', id }]
}

// Draw n cards from deck; cycles discard if needed; uses consumption if still empty
function drawCards(state: GameState, playerId: number, n: number): GameState {
  let s = state
  let drawn = 0

  while (drawn < n) {
    if (s.buildingDeck.length === 0) {
      if (s.discardPile.length === 0) {
        // Give consumption cards
        let card: HandCard
        ;[s, card] = makeConsumption(s)
        s = updatePlayer(s, playerId, p => ({ ...p, hand: [...p.hand, card] }))
        drawn++
        continue
      }
      s = { ...s, buildingDeck: shuffle(s.discardPile), discardPile: [] }
      s = addLog(s, '山札が切れたため捨て札を切り直しました')
    }
    const [card, ...rest] = s.buildingDeck
    s = { ...s, buildingDeck: rest }
    s = updatePlayer(s, playerId, p => ({ ...p, hand: [...p.hand, { kind: 'building' as const, ...card }] }))
    drawn++
  }
  return s
}

function drawConsumption(state: GameState, playerId: number, n: number): GameState {
  let s = state
  for (let i = 0; i < n; i++) {
    let card: HandCard
    ;[s, card] = makeConsumption(s)
    s = updatePlayer(s, playerId, p => ({ ...p, hand: [...p.hand, card] }))
  }
  return s
}

// ---- Player utilities ----

function updatePlayer(state: GameState, playerId: number, fn: (p: Player) => Player): GameState {
  return {
    ...state,
    players: state.players.map(p => p.id === playerId ? fn(p) : p),
  }
}

function getPlayer(state: GameState, playerId: number): Player {
  return state.players.find(p => p.id === playerId)!
}

function addLog(state: GameState, msg: string): GameState {
  return { ...state, log: [...state.log, msg] }
}

// Count all workers (including training)
function workerCount(player: Player): number {
  return player.workers.length
}

// Count unplaced, non-training workers
function availableWorkers(player: Player): Worker[] {
  return player.workers.filter(w => !w.isTraining && w.placedAt === null)
}

// ---- Game initialization ----

export function createGame(config: GameConfig): GameState {
  const playerCount = config.cpuOnly ? config.cpuCount : 1 + config.cpuCount

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
  }

  // Build deck
  let deck: BuildingCard[]
  ;[state, deck] = buildDeck(state)
  state = { ...state, buildingDeck: deck }

  // Create players
  const players: Player[] = []
  for (let i = 0; i < playerCount; i++) {
    const isCpu = config.cpuOnly ? true : i > 0
    const name = isCpu ? `CPU ${config.cpuOnly ? i + 1 : i}` : config.humanName

    // Create 2 initial workers
    let w1Id: string, w2Id: string
    ;[state, w1Id] = nextId(state)
    ;[state, w2Id] = nextId(state)

    players.push({
      id: i,
      name,
      isCpu,
      money: 5 + i,  // $5, $6, $7, $8
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

  // Deal 3 cards to each player
  for (const p of state.players) {
    state = drawCards(state, p.id, 3)
  }

  // Flip round 1 card and add workplaces
  state = flipRoundCard(state, 1, playerCount)
  state = addLog(state, 'ゲーム開始！')

  // Let CPU players take their turns if CPU goes first
  state = processCpuTurns(state)

  return state
}

function flipRoundCard(state: GameState, round: number, playerCount: number): GameState {
  const roundCard = ROUND_CARDS[round - 1]
  let s = state
  const newWorkplaces: PublicWorkplace[] = []

  for (const wp of roundCard.workplaces) {
    const count = wp.count(playerCount)
    for (let i = 0; i < count; i++) {
      let id: string
      ;[s, id] = genId(s, `wp-`)
      newWorkplaces.push({
        id,
        name: wp.name,
        effect: wp.effect,
        allowMultiple: wp.allowMultiple,
        workerIds: [],
      })
    }
  }

  return { ...s, publicWorkplaces: [...s.publicWorkplaces, ...newWorkplaces] }
}

// ---- Workplace availability ----

export function getAvailablePublicWorkplaces(state: GameState, playerId: number): PublicWorkplace[] {
  const player = getPlayer(state, playerId)
  if (availableWorkers(player).length === 0) return []
  return state.publicWorkplaces.filter(wp => canUseWorkplace(wp.effect, wp.workerIds.length, wp.allowMultiple, player, state.household))
}

export function getAvailableOwnedBuildings(state: GameState, playerId: number): OwnedBuilding[] {
  const player = getPlayer(state, playerId)
  if (availableWorkers(player).length === 0) return []
  return player.ownedBuildings.filter(b => {
    const def = BUILDING_CARDS[b.name]
    if (!def || !def.isWorkplace) return false
    if (b.workerHereId !== null) return false  // already occupied
    return canUseEffect(def.effect, player)
  })
}

function canUseWorkplace(effect: GameEffect, currentWorkers: number, allowMultiple: boolean, player: Player, household: number): boolean {
  if (currentWorkers > 0 && !allowMultiple) return false
  return canUseEffect(effect, player, household)
}

function canUseEffect(effect: GameEffect, player: Player, household = Infinity): boolean {
  switch (effect.kind) {
    case 'gain-supply':     return household >= effect.n
    case 'discard-draw':    return player.hand.length >= effect.discard
    case 'discard-gain':    return player.hand.length >= effect.discard && household >= effect.gain
    case 'add-worker':      return workerCount(player) < MAX_WORKERS_PER_PLAYER
    case 'fill-workers':    return workerCount(player) < effect.target
    case 'build':           return player.hand.some(c => {
      if (c.kind !== 'building') return false
      const def = BUILDING_CARDS[c.name]
      const cost = Math.max(0, def.cost - effect.discount)
      return player.hand.length - 1 >= cost
    })
    case 'build-farm-free': return player.hand.some(c =>
      c.kind === 'building' && (BUILDING_CARDS[c.name]?.tags.includes('farm') ?? false)
    )
    case 'build-double': {
      const buildings = player.hand.filter(c => c.kind === 'building')
      const costGroups: Record<number, number> = {}
      for (const c of buildings) {
        if (c.kind !== 'building') continue
        const cost = BUILDING_CARDS[c.name]?.cost ?? 0
        costGroups[cost] = (costGroups[cost] ?? 0) + 1
      }
      return Object.entries(costGroups).some(([costStr, cnt]) => {
        if (cnt < 2) return false
        const cost = parseInt(costStr)
        // Need 2 target cards + cost payment cards from the rest
        return player.hand.length - 2 >= cost
      })
    }
    case 'draw-consumption-to': return player.hand.length < effect.target
    case 'reveal-pick':     return state_deck_has_cards_placeholder()
    default:                return true
  }
}

// Placeholder - will be checked with actual state in placeWorker
function state_deck_has_cards_placeholder(): boolean { return true }

// ---- Worker placement ----

export function placeWorkerOnPublic(state: GameState, playerId: number, workplaceId: string): GameState {
  const player = getPlayer(state, playerId)
  const workplace = state.publicWorkplaces.find(w => w.id === workplaceId)!
  if (!canUseWorkplace(workplace.effect, workplace.workerIds.length, workplace.allowMultiple, player, state.household)) return state
  const worker = availableWorkers(player)[0]
  if (!worker) return state

  // Mark worker as placed
  let s = updatePlayer(state, playerId, p => ({
    ...p,
    workers: p.workers.map(w => w.id === worker.id ? { ...w, placedAt: workplaceId } : w),
  }))
  s = {
    ...s,
    publicWorkplaces: s.publicWorkplaces.map(wp =>
      wp.id === workplaceId ? { ...wp, workerIds: [...wp.workerIds, worker.id] } : wp
    ),
  }
  s = addLog(s, `${player.name} が ${workplace.name} に労働者を配置`)

  // Apply effect
  s = applyEffect(s, playerId, workplace.effect, player.isCpu)
  if (s.pendingAction) return s

  return afterAction(s)
}

export function placeWorkerOnBuilding(state: GameState, playerId: number, buildingId: string): GameState {
  const player = getPlayer(state, playerId)
  const building = player.ownedBuildings.find(b => b.id === buildingId)!
  const def = BUILDING_CARDS[building.name]!
  if (!def || !def.isWorkplace || building.workerHereId !== null) return state
  if (!canUseEffect(def.effect, player, state.household)) return state
  const worker = availableWorkers(player)[0]
  if (!worker) return state

  let s = updatePlayer(state, playerId, p => ({
    ...p,
    workers: p.workers.map(w => w.id === worker.id ? { ...w, placedAt: buildingId } : w),
    ownedBuildings: p.ownedBuildings.map(b => b.id === buildingId ? { ...b, workerHereId: worker.id } : b),
  }))
  s = addLog(s, `${player.name} が ${building.name} に労働者を配置`)

  s = applyEffect(s, playerId, def.effect, player.isCpu)
  if (s.pendingAction) return s

  return afterAction(s)
}

// ---- Effect application ----

function applyEffect(state: GameState, playerId: number, effect: GameEffect, isCpu: boolean): GameState {
  const player = getPlayer(state, playerId)

  switch (effect.kind) {
    case 'none': return state

    case 'draw':
      return drawCards(state, playerId, effect.n)

    case 'draw-become-start': {
      let s = drawCards(state, playerId, 1)
      if (s.startPlayerIndex !== playerId) {
        s = { ...s, startPlayerIndex: playerId }
        s = addLog(s, `${player.name} がスタートプレイヤーになりました`)
      }
      return s
    }

    case 'draw-consumption':
      return drawConsumption(state, playerId, effect.n)

    case 'slash-burn':
      return drawConsumption(state, playerId, 5)

    case 'gain-supply': {
      let s = { ...state, household: state.household - effect.n }
      s = updatePlayer(s, playerId, p => ({ ...p, money: p.money + effect.n }))
      return s
    }

    case 'reveal-pick': {
      if (isCpu) return cpuRevealPick(state, playerId, effect.n)
      const revealed: HandCard[] = []
      let s = state
      for (let i = 0; i < effect.n; i++) {
        if (s.buildingDeck.length === 0) {
          if (s.discardPile.length > 0) {
            s = { ...s, buildingDeck: shuffle(s.discardPile), discardPile: [] }
          } else break
        }
        const [card, ...rest] = s.buildingDeck
        s = { ...s, buildingDeck: rest }
        revealed.push({ kind: 'building', ...card })
      }
      if (revealed.length === 0) return s
      return { ...s, pendingAction: { kind: 'choose-from-revealed', playerId, revealed } }
    }

    case 'discard-draw': {
      if (isCpu) return cpuDiscardDraw(state, playerId, effect.discard, effect.draw)
      return {
        ...state,
        pendingAction: { kind: 'choose-discard', playerId, count: effect.discard, gainAmount: -1, selected: [], drawCount: effect.draw },
      }
    }

    case 'build': {
      if (isCpu) return cpuBuild(state, playerId, effect.discount, effect.drawAfter)
      if (getBuildableCards(state, playerId, effect.discount).length === 0)
        return addLog(state, `${player.name} は建設できる建物がないためスキップ`)
      return { ...state, pendingAction: { kind: 'choose-build-target', playerId, discount: effect.discount, drawAfter: effect.drawAfter } }
    }

    case 'build-farm-free': {
      if (isCpu) return cpuBuildFarmFree(state, playerId)
      if (getFarmBuildableCards(state, playerId).length === 0)
        return addLog(state, `${player.name} は建設できる農場がないためスキップ`)
      return { ...state, pendingAction: { kind: 'choose-farm-build', playerId } }
    }

    case 'draw-consumption-to': {
      const current = player.hand.length
      const need = Math.max(0, effect.target - current)
      return drawConsumption(state, playerId, need)
    }

    case 'draw-if-empty': {
      const n = player.hand.length === 0 ? effect.empty : effect.normal
      return drawCards(state, playerId, n)
    }

    case 'discard-gain': {
      if (isCpu) return cpuDiscardGain(state, playerId, effect.discard, effect.gain)
      return {
        ...state,
        pendingAction: { kind: 'choose-discard', playerId, count: effect.discard, gainAmount: effect.gain, selected: [] },
      }
    }

    case 'add-worker': {
      if (workerCount(player) >= MAX_WORKERS_PER_PLAYER) return state
      let wId: string
      let s: GameState
      ;[s, wId] = nextId(state)
      const newWorker: Worker = { id: wId, playerId, isTraining: !effect.immediate, placedAt: null }
      s = updatePlayer(s, playerId, p => ({ ...p, workers: [...p.workers, newWorker] }))
      s = addLog(s, `${player.name} が労働者を${effect.immediate ? '即戦力で' : '研修中として'}雇用`)
      return s
    }

    case 'fill-workers': {
      const current = workerCount(player)
      if (current >= effect.target) return state
      let s = state
      for (let i = current; i < effect.target; i++) {
        if (workerCount(getPlayer(s, playerId)) >= MAX_WORKERS_PER_PLAYER) break
        let wId: string
        ;[s, wId] = nextId(s)
        s = updatePlayer(s, playerId, p => ({
          ...p,
          workers: [...p.workers, { id: wId, playerId, isTraining: true, placedAt: null }],
        }))
      }
      s = addLog(s, `${player.name} の労働者が${effect.target}人になりました（研修中）`)
      return s
    }

    case 'build-double': {
      if (isCpu) return cpuBuildDouble(state, playerId)
      if (getDoubleBuildableFirstCards(state, playerId).length === 0)
        return addLog(state, `${player.name} は同コストの建物ペアがないためスキップ`)
      return { ...state, pendingAction: { kind: 'choose-double-first', playerId } }
    }

    default: return state
  }
}

// ---- Build resolution (human) ----

export function getBuildableCards(state: GameState, playerId: number, discount: number): (HandCard & { kind: 'building' })[] {
  const player = getPlayer(state, playerId)
  return player.hand.filter(c => {
    if (c.kind !== 'building') return false
    const def = BUILDING_CARDS[c.name]
    const cost = Math.max(0, def.cost - discount)
    return player.hand.length - 1 >= cost
  }) as (HandCard & { kind: 'building' })[]
}

export function getFarmBuildableCards(state: GameState, playerId: number): (HandCard & { kind: 'building' })[] {
  const player = getPlayer(state, playerId)
  return player.hand.filter(c =>
    c.kind === 'building' && (BUILDING_CARDS[c.name]?.tags.includes('farm') ?? false)
  ) as (HandCard & { kind: 'building' })[]
}

export function getDoubleBuildableFirstCards(state: GameState, playerId: number): (HandCard & { kind: 'building' })[] {
  const player = getPlayer(state, playerId)
  const buildings = player.hand.filter(c => c.kind === 'building') as (HandCard & { kind: 'building' })[]
  const costGroups: Record<number, (HandCard & { kind: 'building' })[]> = {}
  for (const c of buildings) {
    const cost = BUILDING_CARDS[c.name]?.cost ?? 0
    costGroups[cost] = [...(costGroups[cost] ?? []), c]
  }
  const validFirstCards: (HandCard & { kind: 'building' })[] = []
  for (const [costStr, cards] of Object.entries(costGroups)) {
    const cost = parseInt(costStr)
    if (cards.length >= 2 && player.hand.length - 2 >= cost) {
      validFirstCards.push(...cards)
    }
  }
  return validFirstCards
}

export function selectBuildTarget(state: GameState, targetCardId: string): GameState {
  const action = state.pendingAction
  if (!action || action.kind !== 'choose-build-target') return state
  const player = getPlayer(state, action.playerId)
  const card = player.hand.find(c => c.id === targetCardId)
  if (!card || card.kind !== 'building') return state
  const def = BUILDING_CARDS[card.name]!
  const cost = Math.max(0, def.cost - action.discount)
  if (player.hand.length - 1 < cost) return state  // not enough payment cards
  return {
    ...state,
    pendingAction: {
      kind: 'choose-build-payment',
      playerId: action.playerId,
      targetId: card.id,
      targetName: card.name,
      cost,
      drawAfter: action.drawAfter,
      discount: action.discount,
    },
  }
}

function undoWorkerPlacement(state: GameState, playerId: number, effectKinds: string[]): GameState {
  const player = getPlayer(state, playerId)
  const effectSet = new Set(effectKinds)

  const matchingIds = new Set<string>()
  for (const wp of state.publicWorkplaces) {
    if (effectSet.has(wp.effect.kind)) matchingIds.add(wp.id)
  }
  for (const b of player.ownedBuildings) {
    const def = BUILDING_CARDS[b.name]
    if (def && effectSet.has(def.effect.kind)) matchingIds.add(b.id)
  }

  const placedWorker = player.workers.find(w => w.placedAt !== null && matchingIds.has(w.placedAt!))
  if (!placedWorker || placedWorker.placedAt === null) return { ...state, pendingAction: null }

  const targetId = placedWorker.placedAt
  let s: GameState = {
    ...state,
    publicWorkplaces: state.publicWorkplaces.map(wp =>
      wp.id === targetId ? { ...wp, workerIds: wp.workerIds.filter(id => id !== placedWorker.id) } : wp
    ),
  }
  s = updatePlayer(s, playerId, p => ({
    ...p,
    workers: p.workers.map(w => w.id === placedWorker.id ? { ...w, placedAt: null } : w),
    ownedBuildings: p.ownedBuildings.map(b => b.id === targetId ? { ...b, workerHereId: null } : b),
  }))
  return { ...s, pendingAction: null }
}

export function cancelDiscardChoice(state: GameState): GameState {
  const pa = state.pendingAction
  if (!pa || pa.kind !== 'choose-discard') return state
  let s = undoWorkerPlacement(state, pa.playerId, ['discard-gain', 'discard-draw'])
  return addLog(s, `${getPlayer(state, pa.playerId).name} がアクションをキャンセル`)
}

export function cancelRevealedChoice(state: GameState): GameState {
  const pa = state.pendingAction
  if (!pa || pa.kind !== 'choose-from-revealed') return state
  // Put revealed cards into discard pile
  const discarded = pa.revealed.filter(c => c.kind === 'building') as BuildingCard[]
  let s: GameState = { ...state, discardPile: [...state.discardPile, ...discarded] }
  s = undoWorkerPlacement(s, pa.playerId, ['reveal-pick'])
  return addLog(s, `${getPlayer(state, pa.playerId).name} がアクションをキャンセル`)
}

export function cancelBuildChoice(state: GameState): GameState {
  const pa = state.pendingAction
  if (!pa) return state
  if (pa.kind !== 'choose-build-target' && pa.kind !== 'choose-farm-build' && pa.kind !== 'choose-double-first') return state
  let s = undoWorkerPlacement(state, pa.playerId, ['build', 'build-farm-free', 'build-double'])
  return addLog(s, `${getPlayer(state, pa.playerId).name} が建設をキャンセル`)
}

export function cancelBuildPayment(state: GameState): GameState {
  const action = state.pendingAction
  if (!action || action.kind !== 'choose-build-payment') return state
  return { ...state, pendingAction: { kind: 'choose-build-target', playerId: action.playerId, discount: action.discount, drawAfter: action.drawAfter } }
}

export function selectFarmBuildTarget(state: GameState, targetCardId: string): GameState {
  const action = state.pendingAction
  if (!action || action.kind !== 'choose-farm-build') return state
  const player = getPlayer(state, action.playerId)
  const card = player.hand.find(c => c.id === targetCardId)
  if (!card || card.kind !== 'building') return state
  const def = BUILDING_CARDS[card.name]!
  if (!def.tags.includes('farm')) return state
  // Build for free
  let s: GameState
  ;[s] = constructBuilding(state, action.playerId, card.id, [], 0)
  s = { ...s, pendingAction: null }
  return afterAction(s)
}

export function confirmBuildPayment(state: GameState, paymentIds: string[]): GameState {
  const action = state.pendingAction
  if (!action || action.kind !== 'choose-build-payment') return state
  if (paymentIds.length !== action.cost) return state

  let s: GameState
  ;[s] = constructBuilding(state, action.playerId, action.targetId, paymentIds, action.drawAfter)
  s = { ...s, pendingAction: null }
  return afterAction(s)
}

export function selectDoubleFirst(state: GameState, cardId: string): GameState {
  const action = state.pendingAction
  if (!action || action.kind !== 'choose-double-first') return state
  const player = getPlayer(state, action.playerId)
  const card = player.hand.find(c => c.id === cardId)
  if (!card || card.kind !== 'building') return state
  const def = BUILDING_CARDS[card.name]!
  return {
    ...state,
    pendingAction: { kind: 'choose-double-second', playerId: action.playerId, firstCost: def.cost, firstId: card.id },
  }
}

export function selectDoubleSecond(state: GameState, cardId: string): GameState {
  const action = state.pendingAction
  if (!action || action.kind !== 'choose-double-second') return state
  const player = getPlayer(state, action.playerId)
  const card = player.hand.find(c => c.id === cardId)
  if (!card || card.kind !== 'building') return state
  const def = BUILDING_CARDS[card.name]!
  if (def.cost !== action.firstCost) return state  // must be same cost
  if (card.id === action.firstId) return state     // must be different card
  // Payment = firstCost cards (pay once)
  return {
    ...state,
    pendingAction: { kind: 'choose-double-payment', playerId: action.playerId, firstId: action.firstId, secondId: card.id, cost: action.firstCost, firstCost: action.firstCost },
  }
}

export function cancelDoubleSecond(state: GameState): GameState {
  const action = state.pendingAction
  if (!action || action.kind !== 'choose-double-second') return state
  return { ...state, pendingAction: { kind: 'choose-double-first', playerId: action.playerId } }
}

export function cancelDoublePayment(state: GameState): GameState {
  const action = state.pendingAction
  if (!action || action.kind !== 'choose-double-payment') return state
  return { ...state, pendingAction: { kind: 'choose-double-second', playerId: action.playerId, firstCost: action.firstCost, firstId: action.firstId } }
}

export function confirmDoublePayment(state: GameState, paymentIds: string[]): GameState {
  const action = state.pendingAction
  if (!action || action.kind !== 'choose-double-payment') return state
  if (paymentIds.length !== action.cost) return state

  let s = state
  ;[s] = constructBuilding(s, action.playerId, action.firstId, paymentIds, 0)
  // Second building is free (already paid)
  ;[s] = constructBuilding(s, action.playerId, action.secondId, [], 0)
  s = { ...s, pendingAction: null }
  return afterAction(s)
}

function constructBuilding(state: GameState, playerId: number, cardId: string, paymentIds: string[], drawAfter: number): [GameState] {
  let s = state
  const player = getPlayer(s, playerId)
  const card = player.hand.find(c => c.id === cardId) as BuildingCard & { kind: 'building' }

  // Remove building card and payment cards from hand
  const toRemove = new Set([cardId, ...paymentIds])
  const removed = player.hand.filter(c => toRemove.has(c.id))
  const buildingCards = removed.filter(c => c.kind === 'building') as BuildingCard[]

  s = updatePlayer(s, playerId, p => ({ ...p, hand: p.hand.filter(c => !toRemove.has(c.id)) }))

  // Discarded buildings → discard pile (all payment cards that are buildings)
  const discardedBuildings = buildingCards.filter(c => c.id !== cardId)
  s = { ...s, discardPile: [...s.discardPile, ...discardedBuildings] }

  // Add to owned buildings
  let bId: string
  ;[s, bId] = genId(s, 'b-')
  const owned: OwnedBuilding = { id: bId, name: card.name, workerHereId: null }
  s = updatePlayer(s, playerId, p => ({ ...p, ownedBuildings: [...p.ownedBuildings, owned] }))
  s = addLog(s, `${getPlayer(s, playerId).name} が ${card.name} を建設`)

  if (drawAfter > 0) s = drawCards(s, playerId, drawAfter)

  return [s]
}

// ---- Discard resolution (human) ----

export function toggleDiscardSelection(state: GameState, cardId: string): GameState {
  const action = state.pendingAction
  if (!action || action.kind !== 'choose-discard') return state
  const selected = action.selected.includes(cardId)
    ? action.selected.filter(id => id !== cardId)
    : [...action.selected, cardId]
  return { ...state, pendingAction: { ...action, selected } }
}

export function confirmDiscard(state: GameState): GameState {
  const action = state.pendingAction
  if (!action || action.kind !== 'choose-discard') return state
  if (action.selected.length !== action.count) return state

  const player = getPlayer(state, action.playerId)
  const removed = player.hand.filter(c => action.selected.includes(c.id))
  const discarded = removed.filter(c => c.kind === 'building') as BuildingCard[]

  let s = updatePlayer(state, action.playerId, p => ({
    ...p,
    hand: p.hand.filter(c => !action.selected.includes(c.id)),
  }))
  s = { ...s, discardPile: [...s.discardPile, ...discarded] }

  if (action.gainAmount > 0) {
    s = { ...s, household: s.household - action.gainAmount }
    s = updatePlayer(s, action.playerId, p => ({ ...p, money: p.money + action.gainAmount }))
    s = addLog(s, `${player.name} がカードを${action.count}枚捨てて $${action.gainAmount} 獲得`)
  } else {
    // discard-draw case: draw cards equal to what was expected
    // gainAmount === -1 means draw after discard
    s = addLog(s, `${player.name} がカードを${action.count}枚捨てました`)
  }

  s = { ...s, pendingAction: null }
  return afterAction(s)
}

export function confirmDiscardDraw(state: GameState, drawCount: number): GameState {
  const action = state.pendingAction
  if (!action || action.kind !== 'choose-discard') return state
  if (action.selected.length !== action.count) return state

  const player = getPlayer(state, action.playerId)
  const removed = player.hand.filter(c => action.selected.includes(c.id))
  const discarded = removed.filter(c => c.kind === 'building') as BuildingCard[]

  let s = updatePlayer(state, action.playerId, p => ({
    ...p,
    hand: p.hand.filter(c => !action.selected.includes(c.id)),
  }))
  s = { ...s, discardPile: [...s.discardPile, ...discarded] }
  s = drawCards(s, action.playerId, drawCount)
  s = addLog(s, `${player.name} がカードを${action.count}枚捨てて${drawCount}枚引きました`)

  s = { ...s, pendingAction: null }
  return afterAction(s)
}

// ---- Reveal-pick resolution (human) ----

export function pickRevealedCard(state: GameState, cardId: string): GameState {
  const action = state.pendingAction
  if (!action || action.kind !== 'choose-from-revealed') return state

  const picked = action.revealed.find(c => c.id === cardId)
  if (!picked) return state

  // Discard the rest (buildings only)
  const others = action.revealed.filter(c => c.id !== cardId)
  const discarded = others.filter(c => c.kind === 'building') as BuildingCard[]

  let s = updatePlayer(state, action.playerId, p => ({ ...p, hand: [...p.hand, picked] }))
  s = { ...s, discardPile: [...s.discardPile, ...discarded], pendingAction: null }
  s = addLog(s, `${getPlayer(s, action.playerId).name} が公開カードから ${picked.kind === 'building' ? picked.name : '消費財'} を引きました`)

  return afterAction(s)
}

// ---- CPU AI ----

function cpuRevealPick(state: GameState, playerId: number, n: number): GameState {
  const revealed: HandCard[] = []
  let s = state
  for (let i = 0; i < n; i++) {
    if (s.buildingDeck.length === 0) {
      if (s.discardPile.length > 0) s = { ...s, buildingDeck: shuffle(s.discardPile), discardPile: [] }
      else break
    }
    const [card, ...rest] = s.buildingDeck
    s = { ...s, buildingDeck: rest }
    revealed.push({ kind: 'building', ...card })
  }
  if (revealed.length === 0) return s
  const pick = revealed[Math.floor(Math.random() * revealed.length)]
  const others = revealed.filter(c => c.id !== pick.id)
  const discarded = others.filter(c => c.kind === 'building') as BuildingCard[]
  s = updatePlayer(s, playerId, p => ({ ...p, hand: [...p.hand, pick] }))
  s = { ...s, discardPile: [...s.discardPile, ...discarded] }
  return s
}

function cpuDiscardDraw(state: GameState, playerId: number, discard: number, draw: number): GameState {
  const player = getPlayer(state, playerId)
  const toDiscard = player.hand.slice(0, discard)
  const discarded = toDiscard.filter(c => c.kind === 'building') as BuildingCard[]
  let s = updatePlayer(state, playerId, p => ({ ...p, hand: p.hand.slice(discard) }))
  s = { ...s, discardPile: [...s.discardPile, ...discarded] }
  return drawCards(s, playerId, draw)
}

function cpuDiscardGain(state: GameState, playerId: number, discard: number, gain: number): GameState {
  const player = getPlayer(state, playerId)
  const toDiscard = player.hand.slice(0, discard)
  const discarded = toDiscard.filter(c => c.kind === 'building') as BuildingCard[]
  let s = updatePlayer(state, playerId, p => ({ ...p, hand: p.hand.slice(discard) }))
  s = { ...s, discardPile: [...s.discardPile, ...discarded] }
  s = { ...s, household: s.household - gain }
  return updatePlayer(s, playerId, p => ({ ...p, money: p.money + gain }))
}

function cpuBuild(state: GameState, playerId: number, discount: number, drawAfter: number): GameState {
  const player = getPlayer(state, playerId)
  const buildable = player.hand.filter(c => {
    if (c.kind !== 'building') return false
    const def = BUILDING_CARDS[c.name]!
    const cost = Math.max(0, def.cost - discount)
    return player.hand.length - 1 >= cost
  }) as (BuildingCard & { kind: 'building' })[]

  if (buildable.length === 0) return state

  const target = buildable[Math.floor(Math.random() * buildable.length)]
  const def = BUILDING_CARDS[target.name]!
  const cost = Math.max(0, def.cost - discount)

  const payment = player.hand
    .filter(c => c.id !== target.id)
    .slice(0, cost)
    .map(c => c.id)

  let s: GameState
  ;[s] = constructBuilding(state, playerId, target.id, payment, drawAfter)
  return s
}

function cpuBuildFarmFree(state: GameState, playerId: number): GameState {
  const player = getPlayer(state, playerId)
  const farmCards = player.hand.filter(c => {
    if (c.kind !== 'building') return false
    return BUILDING_CARDS[c.name]?.tags.includes('farm') ?? false
  })
  if (farmCards.length === 0) return state
  const target = farmCards[Math.floor(Math.random() * farmCards.length)]
  let s: GameState
  ;[s] = constructBuilding(state, playerId, target.id, [], 0)
  return s
}

function cpuBuildDouble(state: GameState, playerId: number): GameState {
  const player = getPlayer(state, playerId)
  const buildings = player.hand.filter(c => c.kind === 'building') as (BuildingCard & { kind: 'building' })[]

  // Find a cost that appears at least twice
  const costGroups: Record<number, typeof buildings> = {}
  for (const c of buildings) {
    const cost = BUILDING_CARDS[c.name]?.cost ?? 0
    costGroups[cost] = [...(costGroups[cost] ?? []), c]
  }
  const validCosts = Object.entries(costGroups).filter(([, cards]) => cards.length >= 2)
  if (validCosts.length === 0) return state

  const [, sameCostCards] = validCosts[Math.floor(Math.random() * validCosts.length)]
  const first = sameCostCards[0]
  const second = sameCostCards[1]
  const cost = BUILDING_CARDS[first.name]?.cost ?? 0

  const payment = buildings.filter(c => c.id !== first.id && c.id !== second.id).slice(0, cost).map(c => c.id)
  let s = state
  ;[s] = constructBuilding(s, playerId, first.id, payment, 0)
  ;[s] = constructBuilding(s, playerId, second.id, [], 0)
  return s
}

// ---- Turn management ----

function afterAction(state: GameState): GameState {
  if (state.pendingAction) return state

  // Check if all workers placed
  const allPlaced = state.players.every(p =>
    p.workers.every(w => w.isTraining || w.placedAt !== null)
  )

  if (allPlaced) return processRoundEnd(state)

  return advanceTurn(state)
}

function advanceTurn(state: GameState): GameState {
  const total = state.players.length
  let next = (state.currentPlayerIndex + 1) % total
  for (let checked = 0; checked < total; checked++) {
    const p = state.players[next]
    if (availableWorkers(p).length > 0) {
      let s = { ...state, currentPlayerIndex: next }
      if (p.isCpu) s = processCpuTurns(s)
      return s
    }
    next = (next + 1) % total
  }
  return processRoundEnd(state)
}

export function processCpuTurns(state: GameState): GameState {
  let s = state
  while (true) {
    const current = s.players[s.currentPlayerIndex]
    if (!current.isCpu) return s
    if (s.phase === 'game-over') return s
    if (s.pendingAction) return s

    const avail = availableWorkers(current)
    if (avail.length === 0) {
      // No workers left, advance
      const allPlaced = s.players.every(p => p.workers.every(w => w.isTraining || w.placedAt !== null))
      if (allPlaced) return processRoundEnd(s)
      s = { ...s, currentPlayerIndex: (s.currentPlayerIndex + 1) % s.players.length }
      continue
    }

    s = cpuTakeTurn(s, current.id)
    if (s.phase === 'game-over') return s
    if (s.pendingAction) return s  // shouldn't happen for CPU
  }
}

function cpuTakeTurn(state: GameState, playerId: number): GameState {
  const pubOptions = getAvailablePublicWorkplaces(state, playerId)
  const bldOptions = getAvailableOwnedBuildings(state, playerId)

  if (pubOptions.length === 0 && bldOptions.length === 0) {
    // Skip - no valid moves
    return afterAction(state)
  }

  const usePub = pubOptions.length > 0 && (bldOptions.length === 0 || Math.random() < 0.5)
  if (usePub && pubOptions.length > 0) {
    const wp = pubOptions[Math.floor(Math.random() * pubOptions.length)]
    return placeWorkerOnPublic(state, playerId, wp.id)
  } else if (bldOptions.length > 0) {
    const b = bldOptions[Math.floor(Math.random() * bldOptions.length)]
    return placeWorkerOnBuilding(state, playerId, b.id)
  }
  return afterAction(state)
}

// ---- Round end ----

function processRoundEnd(state: GameState): GameState {
  let s = addLog(state, `--- ラウンド ${state.round} 終了 ---`)
  const wage = ROUND_CARDS[state.round - 1].wage

  // Pay wages for each player
  for (const player of s.players) {
    const totalWage = player.workers.length * wage
    s = addLog(s, `${player.name}: 賃金 $${totalWage} (労働者${player.workers.length}人 × $${wage})`)

    let remaining = totalWage
    let playerMoney = getPlayer(s, player.id).money

    if (playerMoney >= remaining) {
      s = updatePlayer(s, player.id, p => ({ ...p, money: p.money - remaining }))
      s = { ...s, household: s.household + remaining }
    } else {
      // Try to sell buildings
      remaining -= playerMoney
      s = updatePlayer(s, player.id, p => ({ ...p, money: 0 }))
      s = { ...s, household: s.household + playerMoney }

      // Sell buildings until enough
      const sellable = getPlayer(s, player.id).ownedBuildings
        .filter(b => BUILDING_CARDS[b.name]?.canSell)
        .sort((a, b) => (BUILDING_CARDS[b.name]?.assetValue ?? 0) - (BUILDING_CARDS[a.name]?.assetValue ?? 0))

      for (const b of sellable) {
        if (remaining <= 0) break
        const def = BUILDING_CARDS[b.name]!
        // Check: is selling this building enough (don't oversell)
        const value = def.assetValue
        if (value <= remaining || sellable.filter(sb => sb.id !== b.id).reduce((sum, sb) => sum + (BUILDING_CARDS[sb.name]?.assetValue ?? 0), 0) < remaining) {
          // Sell this building: money comes from サプライ (infinite external bank)
          s = updatePlayer(s, player.id, p => ({
            ...p,
            money: p.money + value,
            ownedBuildings: p.ownedBuildings.filter(ob => ob.id !== b.id),
          }))
          // Add to public workplaces if it's a workplace
          if (def.isWorkplace) {
            let wpId: string
            ;[s, wpId] = genId(s, 'wp-sold-')
            const wp: PublicWorkplace = { id: wpId, name: b.name, effect: def.effect, allowMultiple: false, workerIds: [] }
            s = { ...s, publicWorkplaces: [...s.publicWorkplaces, wp] }
          }
          s = addLog(s, `${player.name} が ${b.name} を $${value} で売却`)
          remaining -= value
          const newMoney = getPlayer(s, player.id).money
          if (newMoney >= remaining) {
            s = updatePlayer(s, player.id, p => ({ ...p, money: p.money - remaining }))
            s = { ...s, household: s.household + remaining }
            remaining = 0
          } else {
            remaining -= newMoney
            s = updatePlayer(s, player.id, p => ({ ...p, money: 0 }))
            s = { ...s, household: s.household + newMoney }
          }
        }
      }

      // Still can't pay → unpaid wages
      if (remaining > 0) {
        s = updatePlayer(s, player.id, p => ({ ...p, unpaidWages: p.unpaidWages + remaining }))
        s = addLog(s, `${player.name} が未払い賃金 ${remaining} 枚受け取り`)
      }
    }
  }

  // Check game over
  if (s.round >= 9) {
    s = { ...s, phase: 'game-over' }
    s = addLog(s, '=== ゲーム終了 ===')
    return s
  }

  // Advance round
  const nextRound = s.round + 1
  const playerCount = s.players.length

  // Burn 焼畑 that had a worker placed this round
  for (const player of s.players) {
    const burnBuilding = player.ownedBuildings.find(b => b.name === '焼畑' && b.workerHereId !== null)
    if (burnBuilding) {
      s = updatePlayer(s, player.id, p => ({
        ...p,
        ownedBuildings: p.ownedBuildings.filter(ob => ob.id !== burnBuilding.id),
      }))
      s = addLog(s, `${player.name} の焼畑が消滅しました`)
    }
  }

  // Reset workers
  s = {
    ...s,
    players: s.players.map(p => ({
      ...p,
      workers: p.workers.map(w => ({ ...w, isTraining: false, placedAt: null })),
    })),
    publicWorkplaces: s.publicWorkplaces.map(wp => ({ ...wp, workerIds: [] })),
  }

  // Also reset owned buildings' workers
  s = {
    ...s,
    players: s.players.map(p => ({
      ...p,
      ownedBuildings: p.ownedBuildings.map(b => ({ ...b, workerHereId: null })),
    })),
  }

  s = { ...s, round: nextRound }
  s = flipRoundCard(s, nextRound, playerCount)
  s = addLog(s, `--- ラウンド ${nextRound} 開始 (賃金 $${ROUND_CARDS[nextRound - 1].wage}) ---`)

  // Set start player
  s = { ...s, currentPlayerIndex: s.startPlayerIndex }

  // Let CPUs go
  s = processCpuTurns(s)
  return s
}

// ---- Scoring ----

export function calculateScores(state: GameState): ScoreResult[] {
  return state.players.map(player => {
    const buildingValue = player.ownedBuildings.reduce((sum, b) => sum + (BUILDING_CARDS[b.name]?.assetValue ?? 0), 0)

    let bonuses = 0
    for (const b of player.ownedBuildings) {
      const effect = BUILDING_CARDS[b.name]?.effect
      if (!effect) continue
      switch (effect.kind) {
        case 'p-per-building':
          bonuses += effect.pts * player.ownedBuildings.length
          break
        case 'p-per-consumption':
          bonuses += effect.pts * player.hand.filter(c => c.kind === 'consumption').length
          break
        case 'p-per-worker':
          bonuses += effect.pts * player.workers.length
          break
        case 'p-per-factory':
          bonuses += effect.pts * player.ownedBuildings.filter(ob => BUILDING_CARDS[ob.name]?.tags.includes('factory')).length
          break
        case 'p-per-no-sell':
          bonuses += effect.pts * player.ownedBuildings.filter(ob => !BUILDING_CARDS[ob.name]?.canSell).length
          break
      }
    }

    // 法律事務所: forgive up to 5 unpaid wages
    const hasForgive = player.ownedBuildings.some(b => BUILDING_CARDS[b.name]?.effect.kind === 'p-forgive-wages')
    const forgivenWages = hasForgive ? Math.min(player.unpaidWages, 5) : 0
    const unpaidPenalty = (player.unpaidWages - forgivenWages) * 3

    return {
      playerId: player.id,
      buildingValue,
      money: player.money,
      unpaidPenalty,
      bonuses,
      total: buildingValue + player.money + bonuses - unpaidPenalty,
    }
  })
}

// ---- Debug game ----

export function createDebugGame(cpuCount: number = 3): GameState {
  // デバッグは常にプレイヤー1人 + CPU（最大3人）
  const cpuN = Math.min(Math.max(1, cpuCount), 3)
  const playerCount = 1 + cpuN
  const playerNames = ['プレイヤー', 'CPU 1', 'CPU 2', 'CPU 3']

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
  }

  let deck: BuildingCard[]
  ;[state, deck] = buildDeck(state)
  state = { ...state, buildingDeck: deck }

  // Create players with 3 workers each
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

  // Give each player one of every building type
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

  // Deal each player 10 building cards + 3 consumption cards
  for (const p of state.players) {
    state = drawCards(state, p.id, 10)
    state = drawConsumption(state, p.id, 3)
  }

  // Public workplaces: all unique workplaces from all round cards (rounds 1-9)
  const seen = new Set<string>()
  for (const rc of ROUND_CARDS.slice(0, 8)) {
    for (const wp of rc.workplaces) {
      if (!seen.has(wp.name)) {
        seen.add(wp.name)
        let wpId: string
        ;[state, wpId] = genId(state, 'wp-dbg-')
        state = {
          ...state,
          publicWorkplaces: [...state.publicWorkplaces, {
            id: wpId,
            name: wp.name,
            effect: wp.effect,
            allowMultiple: wp.allowMultiple,
            workerIds: [],
          }],
        }
      }
    }
  }

  // Add all canSell buildings (売却可能) as public workplaces
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
        name: def.name,
        effect: def.effect,
        allowMultiple: false,
        workerIds: [],
      }],
    }
  }

  return state
}
