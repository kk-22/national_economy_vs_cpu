import { getPlayer, addLog, updatePlayer, availableWorkers, drawCards, buildActionLog, ALL_BUILDING_CARDS } from './primitives'
import { constructBuilding, selectBuildTwoFirst, selectBuildTwoSecond, confirmBuildTwoPayment, confirmFreeBuild, selectNoSellBuildTarget, getConstructionDiscount } from './build'
import { applyEffect } from './effects'
import { processRoundEnd, resolveAfterHandLimit } from './round'
import { cpuTakeTurnGreedy, cpuTakeTurnGreedyNoAuto } from './cpu-strategy-greedy'
import { cpuTakeTurnBeam, cpuTakeTurnBeamNoAuto } from './cpu-strategy-beam'
import { cpuTakeTurnMCTS, cpuTakeTurnMCTSNoAuto } from './cpu-strategy-mcts'
import { cpuTakeTurnDisruptive, cpuTakeTurnDisruptiveNoAuto } from './cpu-strategy-disruptive'
import { cpuTakeTurnRandom, cpuTakeTurnRandomNoAuto } from './cpu-strategy-random'
import type { GameState, BuildingCard, Player } from './types'

function computeDrewAfterBuildTwo(beforeState: GameState, beforePlayer: Player, afterPlayer: Player): boolean {
  const newBuildings = afterPlayer.ownedBuildings.filter(b => !beforePlayer.ownedBuildings.some(ob => ob.id === b.id))
  if (newBuildings.length !== 2) return false
  const d1 = getConstructionDiscount(beforeState, beforePlayer.id, newBuildings[0].name)
  const d2 = getConstructionDiscount(beforeState, beforePlayer.id, newBuildings[1].name)
  const totalCost = Math.max(0, (ALL_BUILDING_CARDS[newBuildings[0].name]?.cost ?? 0) - d1)
                  + Math.max(0, (ALL_BUILDING_CARDS[newBuildings[1].name]?.cost ?? 0) - d2)
  return beforePlayer.hand.length - 2 - totalCost === 0
}

// CPU NoAuto ターンで選択した配置先を一時保持（replay 高速化用）
let _lastCpuNoAutoTarget: { id: string; type: 'pub' | 'bld' } | null = null

export function consumeLastCpuNoAutoTarget(): { id: string; type: 'pub' | 'bld' } | null {
  const t = _lastCpuNoAutoTarget
  _lastCpuNoAutoTarget = null
  return t
}

export function setLastCpuNoAutoTarget(target: { id: string; type: 'pub' | 'bld' } | null): void {
  _lastCpuNoAutoTarget = target
}

// ---- Worker placement ----

export function placeWorkerOnPublic(state: GameState, playerId: number, workplaceId: string, forceHumanPath = false): GameState {
  const player = getPlayer(state, playerId)
  const workplace = state.publicWorkplaces.find(w => w.id === workplaceId)!
  const worker = availableWorkers(player)[0]
  if (!worker) return state

  const beforePlayer = player
  const beforeSP = state.startPlayerIndex
  const beforeDiscardPile = state.discardPile

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

  s = applyEffect(s, playerId, workplace.effect, player.isCpu, player.cpuStrategy)

  if (s.pendingAction) {
    const pa = s.pendingAction
    const needsSourceId = (pa.kind === 'choose-build-target' || pa.kind === 'choose-farm-build' || pa.kind === 'choose-double-first' || pa.kind === 'choose-discard' || pa.kind === 'choose-from-revealed' || pa.kind === 'choose-build-two-first' || pa.kind === 'choose-free-build' || pa.kind === 'choose-no-sell-build')
    const withSource = needsSourceId
      ? { ...pa, sourceName: workplace.name, sourceId: workplaceId }
      : { ...pa, sourceName: workplace.name }
    s = { ...s, pendingAction: withSource }
    return s
  }

  const afterPlayer = getPlayer(s, playerId)
  let revealPickInfo: { picked: string; discarded: string[] } | undefined
  if (workplace.effect.kind === 'reveal-pick') {
    const pickedCard = afterPlayer.hand.find(c => c.kind === 'building' && !beforePlayer.hand.some(b => b.id === c.id)) as (typeof afterPlayer.hand[number] & { kind: 'building' }) | undefined
    const newDiscarded = s.discardPile.filter(c => !beforeDiscardPile.some(b => b.id === c.id))
    revealPickInfo = { picked: pickedCard?.name ?? '不明', discarded: newDiscarded.map(c => c.name) }
  }
  const drewAfterBuildTwoPub = workplace.effect.kind === 'build-two'
    ? computeDrewAfterBuildTwo(state, beforePlayer, afterPlayer)
    : undefined
  s = addLog(s, buildActionLog(workplace.name, workplace.effect.kind, beforePlayer, afterPlayer, beforeSP, s.startPlayerIndex, revealPickInfo, drewAfterBuildTwoPub))

  return (!player.isCpu || forceHumanPath) ? afterHumanAction(s) : afterAction(s)
}

export function placeWorkerOnBuilding(state: GameState, playerId: number, buildingId: string, forceHumanPath = false): GameState {
  const player = getPlayer(state, playerId)
  const building = player.ownedBuildings.find(b => b.id === buildingId)!
  const def = ALL_BUILDING_CARDS[building.name]!
  const worker = availableWorkers(player)[0]
  if (!worker) return state

  const beforePlayer = player
  const beforeSP = state.startPlayerIndex
  const beforeDiscardPile = state.discardPile

  let s = updatePlayer(state, playerId, p => ({
    ...p,
    workers: p.workers.map(w => w.id === worker.id ? { ...w, placedAt: buildingId } : w),
    ownedBuildings: p.ownedBuildings.map(b => b.id === buildingId ? { ...b, workerHereId: worker.id } : b),
  }))

  s = applyEffect(s, playerId, def.effect, player.isCpu, player.cpuStrategy)

  if (s.pendingAction) {
    const pa = s.pendingAction
    const needsSourceId = (pa.kind === 'choose-build-target' || pa.kind === 'choose-farm-build' || pa.kind === 'choose-double-first' || pa.kind === 'choose-discard' || pa.kind === 'choose-from-revealed' || pa.kind === 'choose-build-two-first' || pa.kind === 'choose-free-build' || pa.kind === 'choose-no-sell-build')
    const withSource = needsSourceId
      ? { ...pa, sourceName: building.name, sourceId: buildingId }
      : { ...pa, sourceName: building.name }
    s = { ...s, pendingAction: withSource }
    return s
  }

  const afterPlayer = getPlayer(s, playerId)
  let revealPickInfo: { picked: string; discarded: string[] } | undefined
  if (def.effect.kind === 'reveal-pick') {
    const pickedCard = afterPlayer.hand.find(c => c.kind === 'building' && !beforePlayer.hand.some(b => b.id === c.id)) as (typeof afterPlayer.hand[number] & { kind: 'building' }) | undefined
    const newDiscarded = s.discardPile.filter(c => !beforeDiscardPile.some(b => b.id === c.id))
    revealPickInfo = { picked: pickedCard?.name ?? '不明', discarded: newDiscarded.map(c => c.name) }
  }
  const drewAfterBuildTwoBld = def.effect.kind === 'build-two'
    ? computeDrewAfterBuildTwo(state, beforePlayer, afterPlayer)
    : undefined
  s = addLog(s, buildActionLog(building.name, def.effect.kind, beforePlayer, afterPlayer, beforeSP, s.startPlayerIndex, revealPickInfo, drewAfterBuildTwoBld))

  return (!player.isCpu || forceHumanPath) ? afterHumanAction(s) : afterAction(s)
}

// ---- Turn sequencing ----

// Vue層のアニメーション待ちのため、ラウンド終了を_pendingRoundEndフラグで遅延させるか否か
let _deferRoundEnd = false
export function setDeferRoundEnd(v: boolean) { _deferRoundEnd = v }

export function afterAction(state: GameState): GameState {
  if (state.pendingAction) return state
  const allPlaced = state.players.every(p => p.workers.every(w => w.isTraining || w.placedAt !== null))
  if (allPlaced) return processRoundEnd(state)
  return advanceTurn(state)
}

export function afterHumanAction(state: GameState): GameState {
  if (state.pendingAction) return state
  const allPlaced = state.players.every(p => p.workers.every(w => w.isTraining || w.placedAt !== null))
  if (allPlaced) {
    if (_deferRoundEnd) return { ...state, _pendingRoundEnd: true }
    return processRoundEnd(state, true)
  }
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

// ---- Strategy dispatch ----

function cpuTakeTurn(state: GameState, playerId: number): GameState {
  const player = getPlayer(state, playerId)
  switch (player.cpuStrategy) {
    case 'greedy':     return cpuTakeTurnGreedy(state, playerId)
    case 'beam':       return cpuTakeTurnBeam(state, playerId)
    case 'mcts':       return cpuTakeTurnMCTS(state, playerId)
    case 'disruptive': return cpuTakeTurnDisruptive(state, playerId)
    default:           return cpuTakeTurnRandom(state, playerId)
  }
}

function cpuTakeTurnNoAuto(state: GameState, playerId: number): GameState {
  const player = getPlayer(state, playerId)
  switch (player.cpuStrategy) {
    case 'greedy':     return cpuTakeTurnGreedyNoAuto(state, playerId)
    case 'beam':       return cpuTakeTurnBeamNoAuto(state, playerId)
    case 'mcts':       return cpuTakeTurnMCTSNoAuto(state, playerId)
    case 'disruptive': return cpuTakeTurnDisruptiveNoAuto(state, playerId)
    default:           return cpuTakeTurnRandomNoAuto(state, playerId)
  }
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
  const beforePlayer = getPlayer(state, action.playerId)
  const card = beforePlayer.hand.find(c => c.id === targetCardId)
  if (!card || card.kind !== 'building') return state
  const def = ALL_BUILDING_CARDS[card.name]!
  if (!def.tags.includes('farm')) return state
  let s: GameState
  ;[s] = constructBuilding(state, action.playerId, card.id, [], 0)
  s = { ...s, pendingAction: null }
  const afterPlayer = getPlayer(s, action.playerId)
  s = addLog(s, buildActionLog(action.sourceName ?? '', 'build-farm-free', beforePlayer, afterPlayer, state.startPlayerIndex, s.startPlayerIndex))
  return afterHumanAction(s)
}

export function confirmBuildPayment(state: GameState, paymentIds: string[]): GameState {
  const action = state.pendingAction
  if (!action || action.kind !== 'choose-build-payment') return state
  if (paymentIds.length !== action.cost) return state
  const beforePlayer = getPlayer(state, action.playerId)
  let s: GameState
  ;[s] = constructBuilding(state, action.playerId, action.targetId, paymentIds, action.drawAfter)
  s = { ...s, pendingAction: null }
  // 宮大工（build-gain-vp）経由の建設なら勝利点を加算
  const sourceEffect = action.sourceName ? ALL_BUILDING_CARDS[action.sourceName]?.effect : undefined
  if (sourceEffect?.kind === 'build-gain-vp') {
    s = updatePlayer(s, action.playerId, p => ({ ...p, victoryPoints: p.victoryPoints + 1 }))
    s = addLog(s, `${getPlayer(s, action.playerId).name} が勝利点カードを取得（計${getPlayer(s, action.playerId).victoryPoints}枚）`)
  }
  const afterPlayer = getPlayer(s, action.playerId)
  s = addLog(s, buildActionLog(action.sourceName ?? '', 'build', beforePlayer, afterPlayer, state.startPlayerIndex, s.startPlayerIndex))
  return afterHumanAction(s)
}

export function confirmDoublePayment(state: GameState, paymentIds: string[]): GameState {
  const action = state.pendingAction
  if (!action || action.kind !== 'choose-double-payment') return state
  if (paymentIds.length !== action.cost) return state
  const beforePlayer = getPlayer(state, action.playerId)
  let s = state
  ;[s] = constructBuilding(s, action.playerId, action.firstId, paymentIds, 0)
  ;[s] = constructBuilding(s, action.playerId, action.secondId, [], 0)
  s = { ...s, pendingAction: null }
  const afterPlayer = getPlayer(s, action.playerId)
  s = addLog(s, buildActionLog(action.sourceName ?? '', 'build-double', beforePlayer, afterPlayer, state.startPlayerIndex, s.startPlayerIndex))
  return afterHumanAction(s)
}

export function confirmDiscard(state: GameState): GameState {
  const action = state.pendingAction
  if (!action || action.kind !== 'choose-discard') return state
  if (action.selected.length !== action.count) return state

  const beforePlayer = getPlayer(state, action.playerId)
  const removed = beforePlayer.hand.filter(c => action.selected.includes(c.id))
  const discarded = removed.filter(c => c.kind === 'building') as BuildingCard[]

  let s = updatePlayer(state, action.playerId, p => ({
    ...p,
    hand: p.hand.filter(c => !action.selected.includes(c.id)),
  }))
  s = { ...s, discardPile: [...s.discardPile, ...discarded] }

  if (action.gainAmount > 0) {
    s = { ...s, household: s.household - action.gainAmount }
    s = updatePlayer(s, action.playerId, p => ({ ...p, money: p.money + action.gainAmount }))
  }

  s = { ...s, pendingAction: null }
  const afterPlayer = getPlayer(s, action.playerId)
  s = addLog(s, buildActionLog(action.sourceName ?? '', 'discard-gain', beforePlayer, afterPlayer, state.startPlayerIndex, s.startPlayerIndex))
  return afterHumanAction(s)
}

export function confirmDiscardDraw(state: GameState, drawCount: number): GameState {
  const action = state.pendingAction
  if (!action || action.kind !== 'choose-discard') return state
  if (action.selected.length !== action.count) return state

  const beforePlayer = getPlayer(state, action.playerId)
  const removed = beforePlayer.hand.filter(c => action.selected.includes(c.id))
  const discarded = removed.filter(c => c.kind === 'building') as BuildingCard[]

  let s = updatePlayer(state, action.playerId, p => ({
    ...p,
    hand: p.hand.filter(c => !action.selected.includes(c.id)),
  }))
  s = { ...s, discardPile: [...s.discardPile, ...discarded] }
  s = drawCards(s, action.playerId, drawCount)
  s = { ...s, pendingAction: null }
  const afterPlayer = getPlayer(s, action.playerId)
  s = addLog(s, buildActionLog(action.sourceName ?? '', 'discard-draw', beforePlayer, afterPlayer, state.startPlayerIndex, s.startPlayerIndex))
  return afterHumanAction(s)
}

export function pickRevealedCard(state: GameState, cardId: string): GameState {
  const action = state.pendingAction
  if (!action || action.kind !== 'choose-from-revealed') return state

  const beforePlayer = getPlayer(state, action.playerId)
  const picked = action.revealed.find(c => c.id === cardId)
  if (!picked) return state

  const others = action.revealed.filter(c => c.id !== cardId)
  const discarded = others.filter(c => c.kind === 'building') as BuildingCard[]

  let s = updatePlayer(state, action.playerId, p => ({ ...p, hand: [...p.hand, picked] }))
  s = { ...s, discardPile: [...s.discardPile, ...discarded], pendingAction: null }
  const afterPlayer = getPlayer(s, action.playerId)
  const revealPickInfo = { picked: (picked as BuildingCard).name, discarded: discarded.map(c => c.name) }
  s = addLog(s, buildActionLog(action.sourceName ?? '', 'reveal-pick', beforePlayer, afterPlayer, state.startPlayerIndex, s.startPlayerIndex, revealPickInfo))

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
  s = addLog(s, `${player.name} が手札超過${player.hand.length}→${pa.limit}枚`)

  return resolveAfterHandLimit(s, pa.noCpu)
}

// ---- メセナ専用アクション確定 ----

export function selectBuildTwoFirstCard(state: GameState, cardId: string): GameState {
  return selectBuildTwoFirst(state, cardId)
}

export function selectBuildTwoSecondCard(state: GameState, cardId: string): GameState {
  return selectBuildTwoSecond(state, cardId)
}

export function confirmBuildTwoCards(state: GameState, paymentIds: string[]): GameState {
  let s = confirmBuildTwoPayment(state, paymentIds)
  return afterHumanAction(s)
}

export function confirmFreeBuildCard(state: GameState, cardId: string): GameState {
  let s = confirmFreeBuild(state, cardId)
  return afterHumanAction(s)
}

export function selectNoSellBuildCard(state: GameState, cardId: string): GameState {
  return selectNoSellBuildTarget(state, cardId)
}

