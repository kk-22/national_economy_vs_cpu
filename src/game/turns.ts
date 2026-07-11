import { getPlayer, addLog, updatePlayer, availableWorkers, drawCards, drawConsumption, buildActionLog, ALL_BUILDING_CARDS } from './primitives'
import { constructBuilding, selectBuildTwoFirst, selectBuildTwoSecond, confirmBuildTwoPayment, confirmFreeBuild, selectNoSellBuildTarget, getConstructionDiscount } from './build'
import { applyEffect } from './effects'
import { processRoundEnd, resolveAfterHandLimit } from './round'
import { cpuTakeTurnGreedy, cpuTakeTurnGreedyNoAuto } from './cpu-strategy-greedy'
import { cpuTakeTurnBeam, cpuTakeTurnBeamNoAuto } from './cpu-strategy-beam'
import { cpuTakeTurnMCTS, cpuTakeTurnMCTSNoAuto } from './cpu-strategy-mcts'
import { cpuTakeTurnDisruptive, cpuTakeTurnDisruptiveNoAuto } from './cpu-strategy-disruptive'
import { cpuTakeTurnRandom, cpuTakeTurnRandomNoAuto } from './cpu-strategy-random'
import type { GameState, BuildingCard, Player, GameEffect } from './types'

function computeDrewAfterBuildTwo(beforeState: GameState, beforePlayer: Player, afterPlayer: Player): boolean {
  const newBuildings = afterPlayer.ownedBuildings.filter(b => !beforePlayer.ownedBuildings.some(ob => ob.id === b.id))
  if (newBuildings.length !== 2) return false
  const d1 = getConstructionDiscount(beforeState, beforePlayer.id, newBuildings[0].name)
  const d2 = getConstructionDiscount(beforeState, beforePlayer.id, newBuildings[1].name)
  const totalCost = Math.max(0, (ALL_BUILDING_CARDS[newBuildings[0].name]?.cost ?? 0) - d1)
                  + Math.max(0, (ALL_BUILDING_CARDS[newBuildings[1].name]?.cost ?? 0) - d2)
  return beforePlayer.hand.length - 2 - totalCost === 0
}

// CPU NoAuto ターンで選択した配置先（replay 高速化用）。戻り値として呼び出し元に伝搬する。
export interface CpuTarget { id: string; type: 'pub' | 'bld' }
export interface CpuNoAutoResult { state: GameState; target: CpuTarget | null }

// ---- Worker placement ----

interface PlacementTarget {
  id: string
  name: string
  effect: GameEffect
}

// PendingAction のうち、配置元（一般職場 or 自分の建物）のIDをsourceIdとして記録する必要がある種類
function needsPlacementSourceId(paKind: string): boolean {
  return paKind === 'choose-build-target' || paKind === 'choose-farm-build' || paKind === 'choose-double-first'
    || paKind === 'choose-discard' || paKind === 'choose-from-revealed' || paKind === 'choose-build-two-first'
    || paKind === 'choose-free-build' || paKind === 'choose-no-sell-build' || paKind === 'choose-consumption-or-discard'
}

// 一般職場・自分の建物どちらへの配置にも共通するロジック（コマ配置→効果適用→ログ→ターン進行）。
// applyPlacement で配置先固有のデータ構造（publicWorkplaces.workerIds / ownedBuilding.workerHereId）を更新する。
function placeWorkerCommon(
  state: GameState,
  playerId: number,
  target: PlacementTarget,
  applyPlacement: (s: GameState, workerId: string, worker2Id: string | null) => GameState,
  forceHumanPath: boolean,
  deferRoundEnd = false,
): GameState {
  const player = getPlayer(state, playerId)
  const worker = availableWorkers(player)[0]
  if (!worker) return state

  const beforePlayer = player
  const beforeSP = state.startPlayerIndex
  const beforeDiscardPile = state.discardPile

  const def = ALL_BUILDING_CARDS[target.name]
  const koma = availableWorkers(player)
  const worker2 = def?.requiresDoubleWorker ? koma[1] : null

  let s = updatePlayer(state, playerId, p => ({
    ...p,
    workers: p.workers.map(w => {
      if (w.id === worker.id) return { ...w, placedAt: target.id }
      if (worker2 && w.id === worker2.id) return { ...w, placedAt: target.id }
      return w
    }),
  }))
  s = applyPlacement(s, worker.id, worker2?.id ?? null)

  s = applyEffect(s, playerId, target.effect, player.isCpu, player.cpuStrategy)

  if (s.pendingAction) {
    const pa = s.pendingAction
    const withSource = needsPlacementSourceId(pa.kind)
      ? { ...pa, sourceName: target.name, sourceId: target.id }
      : { ...pa, sourceName: target.name }
    s = { ...s, pendingAction: withSource }
    return s
  }

  const afterPlayer = getPlayer(s, playerId)
  let revealPickInfo: { picked: string; discarded: string[] } | undefined
  if (target.effect.kind === 'reveal-pick') {
    const pickedCard = afterPlayer.hand.find(c => c.kind === 'building' && !beforePlayer.hand.some(b => b.id === c.id)) as (typeof afterPlayer.hand[number] & { kind: 'building' }) | undefined
    const newDiscarded = s.discardPile.filter(c => !beforeDiscardPile.some(b => b.id === c.id))
    revealPickInfo = { picked: pickedCard?.name ?? '不明', discarded: newDiscarded.map(c => c.name) }
  }
  const drewAfterBuildTwo = target.effect.kind === 'build-two'
    ? computeDrewAfterBuildTwo(state, beforePlayer, afterPlayer)
    : undefined
  s = addLog(s, buildActionLog(target.name, target.effect.kind, beforePlayer, afterPlayer, beforeSP, s.startPlayerIndex, revealPickInfo, drewAfterBuildTwo))

  return (!player.isCpu || forceHumanPath) ? afterHumanAction(s, deferRoundEnd) : afterAction(s)
}

export function placeWorkerOnPublic(state: GameState, playerId: number, workplaceId: string, forceHumanPath = false, deferRoundEnd = false): GameState {
  const workplace = state.publicWorkplaces.find(w => w.id === workplaceId)!
  return placeWorkerCommon(state, playerId, workplace, (s, workerId, worker2Id) => ({
    ...s,
    publicWorkplaces: s.publicWorkplaces.map(wp => {
      if (wp.id !== workplaceId) return wp
      const ids = worker2Id ? [...wp.workerIds, workerId, worker2Id] : [...wp.workerIds, workerId]
      return { ...wp, workerIds: ids }
    }),
  }), forceHumanPath, deferRoundEnd)
}

export function placeWorkerOnBuilding(state: GameState, playerId: number, buildingId: string, forceHumanPath = false, deferRoundEnd = false): GameState {
  const player = getPlayer(state, playerId)
  const building = player.ownedBuildings.find(b => b.id === buildingId)!
  const def = ALL_BUILDING_CARDS[building.name]!
  return placeWorkerCommon(state, playerId, { id: building.id, name: building.name, effect: def.effect }, (s, workerId) => updatePlayer(s, playerId, p => ({
    ...p,
    ownedBuildings: p.ownedBuildings.map(b => b.id === buildingId ? { ...b, workerHereId: workerId } : b),
  })), forceHumanPath, deferRoundEnd)
}

// ---- Turn sequencing ----

export function afterAction(state: GameState): GameState {
  if (state.pendingAction) return state
  const allPlaced = state.players.every(p => p.workers.every(w => w.isTraining || w.placedAt !== null))
  if (allPlaced) return processRoundEnd(state)
  return advanceTurn(state)
}

// deferRoundEnd: Vue層のアニメーション待ちのため、ラウンド終了を_pendingRoundEndフラグで遅延させるか否か
export function afterHumanAction(state: GameState, deferRoundEnd = false): GameState {
  if (state.pendingAction) return state
  const allPlaced = state.players.every(p => p.workers.every(w => w.isTraining || w.placedAt !== null))
  if (allPlaced) {
    if (deferRoundEnd) return { ...state, _pendingRoundEnd: true }
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

function cpuTakeTurnNoAuto(state: GameState, playerId: number, deferRoundEnd: boolean): CpuNoAutoResult {
  const player = getPlayer(state, playerId)
  switch (player.cpuStrategy) {
    case 'greedy':     return cpuTakeTurnGreedyNoAuto(state, playerId, deferRoundEnd)
    case 'beam':       return cpuTakeTurnBeamNoAuto(state, playerId, deferRoundEnd)
    case 'mcts':       return cpuTakeTurnMCTSNoAuto(state, playerId, deferRoundEnd)
    case 'disruptive': return cpuTakeTurnDisruptiveNoAuto(state, playerId, deferRoundEnd)
    default:           return cpuTakeTurnRandomNoAuto(state, playerId, deferRoundEnd)
  }
}

// deferRoundEnd: Vue層のアニメーション待ちのため、ラウンド終了を_pendingRoundEndフラグで遅延させるか否か
export function cpuOneTurnStep(state: GameState, deferRoundEnd = false): CpuNoAutoResult {
  if (state.pendingAction) return { state, target: null }
  const current = state.players[state.currentPlayerIndex]
  if (!current?.isCpu) return { state, target: null }
  const avail = availableWorkers(current)
  if (avail.length === 0) return { state: advanceTurnNoCpu(state), target: null }
  return cpuTakeTurnNoAuto(state, current.id, deferRoundEnd)
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

  // 支払い枚数の検証（消費財2倍モードは別途計算）
  if (action.consumptionDouble) {
    const playerHand = getPlayer(state, action.playerId).hand
    const consumptionPaid = paymentIds.filter(id => playerHand.find(c => c.id === id)?.kind === 'consumption').length
    const buildingPaid = paymentIds.length - consumptionPaid
    if (consumptionPaid * 2 + buildingPaid !== action.cost) return state
  } else {
    if (paymentIds.length !== action.cost) return state
  }

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

  // 植民団: 建設後に消費財を引く
  if (action.consumptionAfter) {
    s = drawConsumption(s, action.playerId, action.consumptionAfter)
  }

  // 摩天建設: 建設後に手札が0枚なら建物カードを引く
  if (action.drawAfterEmpty && getPlayer(s, action.playerId).hand.length === 0) {
    s = drawCards(s, action.playerId, action.drawAfterEmpty)
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

// ---- グローリー専用アクション確定 ----

// 農村: 消費財2枚引く OR 消費財2枚捨て建物3枚引く
export function confirmConsumptionOrDiscard(state: GameState, choice: 'consumption' | 'discard-draw'): GameState {
  const action = state.pendingAction
  if (!action || action.kind !== 'choose-consumption-or-discard') return state
  const beforePlayer = getPlayer(state, action.playerId)
  let s: GameState = { ...state, pendingAction: null }

  if (choice === 'consumption') {
    s = drawConsumption(s, action.playerId, action.n)
    const afterPlayer = getPlayer(s, action.playerId)
    s = addLog(s, buildActionLog(action.sourceName ?? '', 'draw-consumption-or-discard-draw', beforePlayer, afterPlayer, state.startPlayerIndex, s.startPlayerIndex))
    return afterHumanAction(s)
  } else {
    // 消費財をn枚自動で捨てて建物カードをn+1枚引く
    const player = getPlayer(s, action.playerId)
    const toDiscard = player.hand.filter(c => c.kind === 'consumption').slice(0, action.n)
    const toDiscardIds = new Set(toDiscard.map(c => c.id))
    s = updatePlayer(s, action.playerId, p => ({ ...p, hand: p.hand.filter(c => !toDiscardIds.has(c.id)) }))
    s = drawCards(s, action.playerId, action.n + 1)
    const afterPlayer = getPlayer(s, action.playerId)
    s = addLog(s, buildActionLog(action.sourceName ?? '', 'draw-consumption-or-discard-draw', beforePlayer, afterPlayer, state.startPlayerIndex, s.startPlayerIndex))
    return afterHumanAction(s)
  }
}

