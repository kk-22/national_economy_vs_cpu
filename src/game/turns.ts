import { BUILDING_CARDS } from './constants'
import { getPlayer, addLog, updatePlayer, availableWorkers, drawCards, rngNext } from './primitives'
import { getAvailablePublicWorkplaces, getAvailableOwnedBuildings } from './availability'
import { constructBuilding } from './build'
import { applyEffect } from './effects'
import { processRoundEnd, startNextRound } from './round'
import type { GameState, BuildingCard } from './types'

// ---- Worker placement ----

export function placeWorkerOnPublic(state: GameState, playerId: number, workplaceId: string, forceHumanPath = false): GameState {
  const player = getPlayer(state, playerId)
  const workplace = state.publicWorkplaces.find(w => w.id === workplaceId)!
  const worker = availableWorkers(player)[0]
  if (!worker) return state

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

  s = applyEffect(s, playerId, workplace.effect, player.isCpu)
  if (s.pendingAction) return s

  return (!player.isCpu || forceHumanPath) ? afterHumanAction(s) : afterAction(s)
}

export function placeWorkerOnBuilding(state: GameState, playerId: number, buildingId: string, forceHumanPath = false): GameState {
  const player = getPlayer(state, playerId)
  const building = player.ownedBuildings.find(b => b.id === buildingId)!
  const def = BUILDING_CARDS[building.name]!
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

  return (!player.isCpu || forceHumanPath) ? afterHumanAction(s) : afterAction(s)
}

// ---- Turn sequencing ----

function afterAction(state: GameState): GameState {
  if (state.pendingAction) return state
  const allPlaced = state.players.every(p => p.workers.every(w => w.isTraining || w.placedAt !== null))
  if (allPlaced) return processRoundEnd(state)
  return advanceTurn(state)
}

function afterHumanAction(state: GameState): GameState {
  if (state.pendingAction) return state
  const allPlaced = state.players.every(p => p.workers.every(w => w.isTraining || w.placedAt !== null))
  if (allPlaced) return processRoundEnd(state, true)
  return advanceTurnNoCpu(state)
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

function advanceTurnNoCpu(state: GameState): GameState {
  const total = state.players.length
  let next = (state.currentPlayerIndex + 1) % total
  for (let checked = 0; checked < total; checked++) {
    const p = state.players[next]
    if (availableWorkers(p).length > 0) return { ...state, currentPlayerIndex: next }
    next = (next + 1) % total
  }
  return processRoundEnd(state, true)
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
      const allPlaced = s.players.every(p => p.workers.every(w => w.isTraining || w.placedAt !== null))
      if (allPlaced) return processRoundEnd(s)
      s = { ...s, currentPlayerIndex: (s.currentPlayerIndex + 1) % s.players.length }
      continue
    }

    s = cpuTakeTurn(s, current.id)
    if (s.phase === 'game-over') return s
    if (s.pendingAction) return s
  }
}

function cpuTakeTurn(state: GameState, playerId: number): GameState {
  const pubOptions = getAvailablePublicWorkplaces(state, playerId)
  const bldOptions = getAvailableOwnedBuildings(state, playerId)
  if (pubOptions.length === 0 && bldOptions.length === 0) return afterAction(state)

  let s = state
  let r: number
  ;[s, r] = rngNext(s)
  const usePub = pubOptions.length > 0 && (bldOptions.length === 0 || r < 0.5)
  if (usePub && pubOptions.length > 0) {
    let r2: number
    ;[s, r2] = rngNext(s)
    return placeWorkerOnPublic(s, playerId, pubOptions[Math.floor(r2 * pubOptions.length)].id)
  } else if (bldOptions.length > 0) {
    let r2: number
    ;[s, r2] = rngNext(s)
    return placeWorkerOnBuilding(s, playerId, bldOptions[Math.floor(r2 * bldOptions.length)].id)
  }
  return afterAction(s)
}

function cpuTakeTurnNoAuto(state: GameState, playerId: number): GameState {
  const pubOptions = getAvailablePublicWorkplaces(state, playerId)
  const bldOptions = getAvailableOwnedBuildings(state, playerId)
  if (pubOptions.length === 0 && bldOptions.length === 0) return afterHumanAction(state)

  let s = state
  let r: number
  ;[s, r] = rngNext(s)
  const usePub = pubOptions.length > 0 && (bldOptions.length === 0 || r < 0.5)
  if (usePub && pubOptions.length > 0) {
    let r2: number
    ;[s, r2] = rngNext(s)
    return placeWorkerOnPublic(s, playerId, pubOptions[Math.floor(r2 * pubOptions.length)].id, true)
  } else if (bldOptions.length > 0) {
    let r2: number
    ;[s, r2] = rngNext(s)
    return placeWorkerOnBuilding(s, playerId, bldOptions[Math.floor(r2 * bldOptions.length)].id, true)
  }
  return afterHumanAction(s)
}

export function cpuOneTurnStep(state: GameState): GameState {
  if (state.pendingAction) return state
  const current = state.players[state.currentPlayerIndex]
  if (!current?.isCpu) return state
  const avail = availableWorkers(current)
  if (avail.length === 0) return advanceTurnNoCpu(state)
  return cpuTakeTurnNoAuto(state, current.id)
}

export function skipEmptyPlayerTurn(state: GameState): GameState {
  const current = state.players[state.currentPlayerIndex]
  if (current?.isCpu) return state
  if (state.pendingAction) return state
  if (availableWorkers(current).length > 0) return state
  return afterHumanAction(state)
}

// ---- Confirm actions (call afterHumanAction or startNextRound) ----

export function selectFarmBuildTarget(state: GameState, targetCardId: string): GameState {
  const action = state.pendingAction
  if (!action || action.kind !== 'choose-farm-build') return state
  const player = getPlayer(state, action.playerId)
  const card = player.hand.find(c => c.id === targetCardId)
  if (!card || card.kind !== 'building') return state
  const def = BUILDING_CARDS[card.name]!
  if (!def.tags.includes('farm')) return state
  let s: GameState
  ;[s] = constructBuilding(state, action.playerId, card.id, [], 0)
  s = { ...s, pendingAction: null }
  return afterHumanAction(s)
}

export function confirmBuildPayment(state: GameState, paymentIds: string[]): GameState {
  const action = state.pendingAction
  if (!action || action.kind !== 'choose-build-payment') return state
  if (paymentIds.length !== action.cost) return state
  let s: GameState
  ;[s] = constructBuilding(state, action.playerId, action.targetId, paymentIds, action.drawAfter)
  s = { ...s, pendingAction: null }
  return afterHumanAction(s)
}

export function confirmDoublePayment(state: GameState, paymentIds: string[]): GameState {
  const action = state.pendingAction
  if (!action || action.kind !== 'choose-double-payment') return state
  if (paymentIds.length !== action.cost) return state
  let s = state
  ;[s] = constructBuilding(s, action.playerId, action.firstId, paymentIds, 0)
  ;[s] = constructBuilding(s, action.playerId, action.secondId, [], 0)
  s = { ...s, pendingAction: null }
  return afterHumanAction(s)
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
    s = addLog(s, `${player.name} がカードを${action.count}枚捨てました`)
  }

  s = { ...s, pendingAction: null }
  return afterHumanAction(s)
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
  return afterHumanAction(s)
}

export function pickRevealedCard(state: GameState, cardId: string): GameState {
  const action = state.pendingAction
  if (!action || action.kind !== 'choose-from-revealed') return state

  const picked = action.revealed.find(c => c.id === cardId)
  if (!picked) return state

  const others = action.revealed.filter(c => c.id !== cardId)
  const discarded = others.filter(c => c.kind === 'building') as BuildingCard[]

  let s = updatePlayer(state, action.playerId, p => ({ ...p, hand: [...p.hand, picked] }))
  s = { ...s, discardPile: [...s.discardPile, ...discarded], pendingAction: null }
  s = addLog(s, `${getPlayer(s, action.playerId).name} が公開カードから ${picked.kind === 'building' ? (picked as any).name : '消費財'} を引きました`)

  return afterHumanAction(s)
}

export function confirmHandLimitDiscard(state: GameState): GameState {
  const pa = state.pendingAction
  if (!pa || pa.kind !== 'choose-hand-limit') return state
  if (pa.selected.length !== pa.count) return state

  const player = getPlayer(state, pa.playerId)
  const removed = player.hand.filter(c => pa.selected.includes(c.id))
  const discardedBuildings = removed.filter(c => c.kind === 'building') as BuildingCard[]

  let s = updatePlayer(state, pa.playerId, p => ({
    ...p,
    hand: p.hand.filter(c => !pa.selected.includes(c.id)),
  }))
  s = { ...s, discardPile: [...s.discardPile, ...discardedBuildings], pendingAction: null }
  s = addLog(s, `${player.name} が手札を${pa.limit}枚に整理しました`)

  return startNextRound(s, pa.noCpu)
}
