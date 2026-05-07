import { BUILDING_CARDS, ROUND_CARDS } from './constants'
import { getPlayer, addLog, updatePlayer, availableWorkers, drawCards, rngNext, getMaxWorkers, buildActionLog } from './primitives'
import { getAvailablePublicWorkplaces, getAvailableOwnedBuildings } from './availability'
import { constructBuilding } from './build'
import { applyEffect } from './effects'
import { processRoundEnd, calculateScores, resolveAfterHandLimit } from './round'
import { MCTS_SIMULATIONS } from './cpu'
import type { GameState, BuildingCard, PublicWorkplace, OwnedBuilding, GameEffect, Player } from './types'

// ---- Worker placement ----

export function placeWorkerOnPublic(state: GameState, playerId: number, workplaceId: string, forceHumanPath = false): GameState {
  const player = getPlayer(state, playerId)
  const workplace = state.publicWorkplaces.find(w => w.id === workplaceId)!
  const worker = availableWorkers(player)[0]
  if (!worker) return state

  const beforePlayer = player
  const beforeSP = state.startPlayerIndex

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
    const withSource = (pa.kind === 'choose-discard' || pa.kind === 'choose-from-revealed')
      ? { ...pa, sourceName: workplace.name, sourceId: workplaceId }
      : { ...pa, sourceName: workplace.name }
    s = { ...s, pendingAction: withSource }
    return s
  }

  const afterPlayer = getPlayer(s, playerId)
  s = addLog(s, buildActionLog(workplace.name, workplace.effect.kind, beforePlayer, afterPlayer, beforeSP, s.startPlayerIndex))

  return (!player.isCpu || forceHumanPath) ? afterHumanAction(s) : afterAction(s)
}

export function placeWorkerOnBuilding(state: GameState, playerId: number, buildingId: string, forceHumanPath = false): GameState {
  const player = getPlayer(state, playerId)
  const building = player.ownedBuildings.find(b => b.id === buildingId)!
  const def = BUILDING_CARDS[building.name]!
  const worker = availableWorkers(player)[0]
  if (!worker) return state

  const beforePlayer = player
  const beforeSP = state.startPlayerIndex

  let s = updatePlayer(state, playerId, p => ({
    ...p,
    workers: p.workers.map(w => w.id === worker.id ? { ...w, placedAt: buildingId } : w),
    ownedBuildings: p.ownedBuildings.map(b => b.id === buildingId ? { ...b, workerHereId: worker.id } : b),
  }))

  s = applyEffect(s, playerId, def.effect, player.isCpu, player.cpuStrategy)

  if (s.pendingAction) {
    const pa = s.pendingAction
    const withSource = (pa.kind === 'choose-discard' || pa.kind === 'choose-from-revealed')
      ? { ...pa, sourceName: building.name, sourceId: buildingId }
      : { ...pa, sourceName: building.name }
    s = { ...s, pendingAction: withSource }
    return s
  }

  const afterPlayer = getPlayer(s, playerId)
  s = addLog(s, buildActionLog(building.name, def.effect.kind, beforePlayer, afterPlayer, beforeSP, s.startPlayerIndex))

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

// ---- Strategy dispatch ----

function cpuTakeTurn(state: GameState, playerId: number): GameState {
  const player = getPlayer(state, playerId)
  switch (player.cpuStrategy) {
    case 'greedy':     return cpuTakeTurnGreedy(state, playerId)
    case 'mcts':       return cpuTakeTurnMCTS(state, playerId)
    case 'disruptive': return cpuTakeTurnDisruptive(state, playerId)
    default:           return cpuTakeTurnRandom(state, playerId)
  }
}

function cpuTakeTurnNoAuto(state: GameState, playerId: number): GameState {
  const player = getPlayer(state, playerId)
  switch (player.cpuStrategy) {
    case 'greedy':     return cpuTakeTurnGreedyNoAuto(state, playerId)
    case 'mcts':       return cpuTakeTurnMCTSNoAuto(state, playerId)
    case 'disruptive': return cpuTakeTurnDisruptiveNoAuto(state, playerId)
    default:           return cpuTakeTurnRandomNoAuto(state, playerId)
  }
}

// ---- Random strategy ----

function cpuTakeTurnRandom(state: GameState, playerId: number): GameState {
  const pubOptions = getAvailablePublicWorkplaces(state, playerId)
  const bldOptions = getAvailableOwnedBuildings(state, playerId)
  if (pubOptions.length === 0 && bldOptions.length === 0) return afterAction(state)

  let s = state, r: number
  ;[s, r] = rngNext(s)
  const usePub = pubOptions.length > 0 && (bldOptions.length === 0 || r < 0.5)
  if (usePub) {
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

function cpuTakeTurnRandomNoAuto(state: GameState, playerId: number): GameState {
  const pubOptions = getAvailablePublicWorkplaces(state, playerId)
  const bldOptions = getAvailableOwnedBuildings(state, playerId)
  if (pubOptions.length === 0 && bldOptions.length === 0) return afterHumanAction(state)

  let s = state, r: number
  ;[s, r] = rngNext(s)
  const usePub = pubOptions.length > 0 && (bldOptions.length === 0 || r < 0.5)
  if (usePub) {
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

// ---- Greedy strategy ----

function scoreEffect(effect: GameEffect, player: Player, household: number, round: number, availWorkers: number = 1): number {
  const workerCount = player.workers.length
  const wage = ROUND_CARDS[round - 1]?.wage ?? 0
  const expectedWage = workerCount * wage

  switch (effect.kind) {
    case 'build-double': return 110
    case 'build': {
      // 労働者1人しか残っておらず賃金も払えない場合のみ建設を諦める
      if (availWorkers < 2 && player.money < expectedWage) return -Infinity
      const availableAfterBuild = player.workers.filter(w => !w.isTraining && w.placedAt === null).length - 1
      // cpuBuild の greedy フィルタと同じ条件で建設可能カードを探す
      let maxCost = -1
      for (const c of player.hand) {
        if (c.kind !== 'building') continue
        const def = BUILDING_CARDS[(c as BuildingCard).name]
        if (!def) continue
        const discountedCost = Math.max(0, def.cost - effect.discount)
        if (player.hand.length - 1 < discountedCost) continue
        if (def.effect.kind.startsWith('p-')) {
          if (round < 8 || def.assetValue <= 0) continue
        } else if (availableAfterBuild < 1) {
          if (def.assetValue <= (discountedCost + 1) * 6) continue
        }
        maxCost = Math.max(maxCost, def.cost)
      }
      if (maxCost < 0) return -Infinity
      return (85 + maxCost * 3) * (availWorkers >= 2 ? 1.2 : 1.0)
    }
    case 'build-farm-free': return 70
    case 'fill-workers': {
      if (workerCount >= effect.target) return -Infinity
      if (round >= 7) return -Infinity
      // 5人目になる場合のみ賃金持続性チェック
      if (effect.target >= 5 && (player.unpaidWages > 0 || player.money < effect.target * wage)) return -Infinity
      // 労働者が少ないほど増員価値が高い（2人時は最優先・pubBonus込みでビルド系に勝つ）
      const fillBase = workerCount <= 2 ? 135 : (workerCount <= 3 ? 100 : 80)
      return fillBase * (1 - (round - 1) / 9)
    }
    case 'add-worker': {
      if (workerCount >= getMaxWorkers(player)) return -Infinity
      if (!effect.immediate) {
        if (round >= 7) return -Infinity
        // 5人目になる場合のみ賃金持続性チェック
        if (workerCount + 1 >= 5 && (player.unpaidWages > 0 || player.money < (workerCount + 1) * wage)) return -Infinity
        // 2人→3人は最優先、4人・5人は段階的に下げる
        const addBase = workerCount <= 2 ? 130 : (workerCount <= 3 ? 40 : 18)
        return addBase * (1 - (round - 1) / 9)
      }
      // immediate add-worker（専門学校）: 5人目の場合のみ賃金チェック
      if (workerCount + 1 >= 5 && (player.unpaidWages > 0 || player.money < (workerCount + 1) * wage)) return -Infinity
      return 70
    }
    case 'reveal-pick': {
      if (round <= 3) return player.hand.length < 5 ? 85 : 65
      return player.hand.length < 3 ? 70 : 55
    }
    case 'discard-draw': {
      if (player.hand.length < effect.discard) return -Infinity
      const ddWorkerBonus = (player.workers.length - 1) * 2
      return effect.draw * (8 + ddWorkerBonus)
    }
    case 'discard-gain': {
      if (player.hand.length < effect.discard || household < effect.gain) return -Infinity
      const base = effect.gain * 2.5
      return player.money < expectedWage * 1.5 ? base * 1.8 : base
    }
    case 'gain-supply': {
      if (household < effect.n) return -Infinity
      const gsScore = effect.n * 3
      // 労働者が2人以上残っているなら建設を優先させるためスコアを抑制
      return availWorkers >= 2 ? gsScore * 0.5 : gsScore
    }
    case 'draw': {
      const drawWorkerBonus = (player.workers.length - 1) * 2
      const drawBase = effect.n * (7 + drawWorkerBonus)
      const availableNow = player.workers.filter(w => !w.isTraining && w.placedAt === null).length
      const hasDrawFactory = player.ownedBuildings.some(b => BUILDING_CARDS[b.name]?.effect.kind === 'discard-draw')
      const drawScore = (hasDrawFactory && availableNow >= 3) ? drawBase * 1.4 : drawBase
      // 労働者が2人以上残っているなら建設を優先させるためスコアを抑制
      return availWorkers >= 2 ? drawScore * 0.5 : drawScore
    }
    case 'draw-if-empty': {
      const diWorkerBonus = (player.workers.length - 1) * 2
      return player.hand.length === 0
        ? effect.empty * (10 + diWorkerBonus)
        : effect.normal * (10 + diWorkerBonus)
    }
    case 'draw-become-start': return 30
    case 'slash-burn': return 25
    case 'draw-consumption': return effect.n * 4
    case 'draw-consumption-to':
      return player.hand.length >= effect.target ? -Infinity : (effect.target - player.hand.length) * 4
    case 'none': return 5
    default: return 10
  }
}

function cpuTakeTurnGreedy(state: GameState, playerId: number): GameState {
  const pubOptions = getAvailablePublicWorkplaces(state, playerId)
  const bldOptions = getAvailableOwnedBuildings(state, playerId)
  if (pubOptions.length === 0 && bldOptions.length === 0) return afterAction(state)

  const player = getPlayer(state, playerId)
  const availableWorkers = player.workers.filter(w => !w.isTraining && w.placedAt === null).length
  const pubBonus = availableWorkers >= 2 ? 1.3 : 1.0

  let bestScore = -Infinity
  let bestPub: PublicWorkplace | null = null
  let bestBld: OwnedBuilding | null = null

  for (const wp of pubOptions) {
    const sc = scoreEffect(wp.effect, player, state.household, state.round, availableWorkers) * pubBonus
    if (sc > bestScore) { bestScore = sc; bestPub = wp; bestBld = null }
  }
  for (const bld of bldOptions) {
    const def = BUILDING_CARDS[bld.name]
    if (!def) continue
    const sc = scoreEffect(def.effect, player, state.household, state.round, availableWorkers)
    if (sc > bestScore) { bestScore = sc; bestBld = bld; bestPub = null }
  }

  // すべて -Infinity ならランダム
  if (bestScore === -Infinity) return cpuTakeTurnRandom(state, playerId)

  if (bestPub) return placeWorkerOnPublic(state, playerId, bestPub.id)
  if (bestBld) return placeWorkerOnBuilding(state, playerId, bestBld.id)
  return afterAction(state)
}

function cpuTakeTurnGreedyNoAuto(state: GameState, playerId: number): GameState {
  const pubOptions = getAvailablePublicWorkplaces(state, playerId)
  const bldOptions = getAvailableOwnedBuildings(state, playerId)
  if (pubOptions.length === 0 && bldOptions.length === 0) return afterHumanAction(state)

  const player = getPlayer(state, playerId)
  const availableWorkers = player.workers.filter(w => !w.isTraining && w.placedAt === null).length
  const pubBonus = availableWorkers >= 2 ? 1.3 : 1.0

  let bestScore = -Infinity
  let bestPub: PublicWorkplace | null = null
  let bestBld: OwnedBuilding | null = null

  for (const wp of pubOptions) {
    const sc = scoreEffect(wp.effect, player, state.household, state.round, availableWorkers) * pubBonus
    if (sc > bestScore) { bestScore = sc; bestPub = wp; bestBld = null }
  }
  for (const bld of bldOptions) {
    const def = BUILDING_CARDS[bld.name]
    if (!def) continue
    const sc = scoreEffect(def.effect, player, state.household, state.round, availableWorkers)
    if (sc > bestScore) { bestScore = sc; bestBld = bld; bestPub = null }
  }

  if (bestScore === -Infinity) return cpuTakeTurnRandomNoAuto(state, playerId)

  if (bestPub) return placeWorkerOnPublic(state, playerId, bestPub.id, true)
  if (bestBld) return placeWorkerOnBuilding(state, playerId, bestBld.id, true)
  return afterHumanAction(state)
}

// ---- MCTS strategy ----

function cpuTakeTurnMCTS(state: GameState, playerId: number): GameState {
  const pubOptions = getAvailablePublicWorkplaces(state, playerId)
  const bldOptions = getAvailableOwnedBuildings(state, playerId)
  if (pubOptions.length === 0 && bldOptions.length === 0) return afterAction(state)

  const options: Array<{ type: 'pub'; id: string } | { type: 'bld'; id: string }> = [
    ...pubOptions.map(w => ({ type: 'pub' as const, id: w.id })),
    ...bldOptions.map(b => ({ type: 'bld' as const, id: b.id })),
  ]

  // N個のシード事前生成
  const seeds: number[] = []
  let seedGen = state
  for (let i = 0; i < MCTS_SIMULATIONS; i++) {
    let r: number
    ;[seedGen, r] = rngNext(seedGen)
    seeds.push(Math.floor(r * 0xFFFFFFFF))
  }

  // シミュレーション用: MCTS→greedy にキャップ、人間→greedy に変換
  const makeSimState = (seed: number): GameState => ({
    ...state,
    _rngState: seed,
    players: state.players.map(p => ({
      ...p,
      isCpu: true,
      cpuStrategy: (p.cpuStrategy === 'mcts' || !p.isCpu) ? 'greedy' as const : p.cpuStrategy,
    })),
  })

  let bestScore = -Infinity
  let bestOption = options[0]

  for (const opt of options) {
    let totalScore = 0
    for (const seed of seeds) {
      let sim = makeSimState(seed)
      if (opt.type === 'pub') {
        sim = placeWorkerOnPublic(sim, playerId, opt.id)
      } else {
        sim = placeWorkerOnBuilding(sim, playerId, opt.id)
      }
      // isCpu=true の cascade により game-over まで自動完走
      const scores = calculateScores(sim)
      totalScore += scores.find(sc => sc.playerId === playerId)?.total ?? 0
    }
    const avg = totalScore / MCTS_SIMULATIONS
    if (avg > bestScore) { bestScore = avg; bestOption = opt }
  }

  // 実際の state で適用
  if (bestOption.type === 'pub') return placeWorkerOnPublic(state, playerId, bestOption.id)
  return placeWorkerOnBuilding(state, playerId, bestOption.id)
}

function cpuTakeTurnMCTSNoAuto(state: GameState, playerId: number): GameState {
  const pubOptions = getAvailablePublicWorkplaces(state, playerId)
  const bldOptions = getAvailableOwnedBuildings(state, playerId)
  if (pubOptions.length === 0 && bldOptions.length === 0) return afterHumanAction(state)

  const options: Array<{ type: 'pub'; id: string } | { type: 'bld'; id: string }> = [
    ...pubOptions.map(w => ({ type: 'pub' as const, id: w.id })),
    ...bldOptions.map(b => ({ type: 'bld' as const, id: b.id })),
  ]

  const seeds: number[] = []
  let seedGen = state
  for (let i = 0; i < MCTS_SIMULATIONS; i++) {
    let r: number
    ;[seedGen, r] = rngNext(seedGen)
    seeds.push(Math.floor(r * 0xFFFFFFFF))
  }

  const makeSimState = (seed: number): GameState => ({
    ...state,
    _rngState: seed,
    players: state.players.map(p => ({
      ...p,
      isCpu: true,
      cpuStrategy: (p.cpuStrategy === 'mcts' || !p.isCpu) ? 'greedy' as const : p.cpuStrategy,
    })),
  })

  let bestScore = -Infinity
  let bestOption = options[0]

  for (const opt of options) {
    let totalScore = 0
    for (const seed of seeds) {
      let sim = makeSimState(seed)
      if (opt.type === 'pub') {
        sim = placeWorkerOnPublic(sim, playerId, opt.id)
      } else {
        sim = placeWorkerOnBuilding(sim, playerId, opt.id)
      }
      const scores = calculateScores(sim)
      totalScore += scores.find(sc => sc.playerId === playerId)?.total ?? 0
    }
    const avg = totalScore / MCTS_SIMULATIONS
    if (avg > bestScore) { bestScore = avg; bestOption = opt }
  }

  if (bestOption.type === 'pub') return placeWorkerOnPublic(state, playerId, bestOption.id, true)
  return placeWorkerOnBuilding(state, playerId, bestOption.id, true)
}

// ---- Disruptive strategy ----

function cpuTakeTurnDisruptive(state: GameState, playerId: number): GameState {
  const chosen = pickDisruptive(state, playerId)
  if (!chosen) return afterAction(state)
  if (chosen.type === 'pub') return placeWorkerOnPublic(state, playerId, chosen.id)
  return placeWorkerOnBuilding(state, playerId, chosen.id)
}

function cpuTakeTurnDisruptiveNoAuto(state: GameState, playerId: number): GameState {
  const chosen = pickDisruptive(state, playerId)
  if (!chosen) return afterHumanAction(state)
  if (chosen.type === 'pub') return placeWorkerOnPublic(state, playerId, chosen.id, true)
  return placeWorkerOnBuilding(state, playerId, chosen.id, true)
}

function pickDisruptive(state: GameState, playerId: number): { type: 'pub' | 'bld'; id: string } | null {
  const pubOptions = getAvailablePublicWorkplaces(state, playerId)
  const bldOptions = getAvailableOwnedBuildings(state, playerId)
  if (pubOptions.length === 0 && bldOptions.length === 0) return null

  // 1. 売られた建物（上位2コストグループ）
  const soldOptions = pubOptions.filter(wp => wp.id.startsWith('wp-sold-'))
  if (soldOptions.length > 0) {
    const uniqueCosts = [...new Set(
      soldOptions.map(wp => BUILDING_CARDS[wp.name]?.cost ?? 0)
    )].sort((a, b) => b - a).slice(0, 2)

    const topGroup = soldOptions.filter(wp => uniqueCosts.includes(BUILDING_CARDS[wp.name]?.cost ?? -1))
    if (topGroup.length > 0) {
      const best = topGroup.reduce((a, b) =>
        (BUILDING_CARDS[a.name]?.assetValue ?? 0) >= (BUILDING_CARDS[b.name]?.assetValue ?? 0) ? a : b
      )
      return { type: 'pub', id: best.id }
    }
  }

  // 2. 今ラウンドの新施設
  const currentRoundNames = new Set(ROUND_CARDS[state.round - 1]?.workplaces.map(w => w.name) ?? [])
  const roundOptions = pubOptions.filter(wp => currentRoundNames.has(wp.name))
  if (roundOptions.length > 0) {
    // discard-gain の gain 最大を優先
    const best = roundOptions.reduce((a, b) => {
      const aGain = a.effect.kind === 'discard-gain' ? a.effect.gain : 0
      const bGain = b.effect.kind === 'discard-gain' ? b.effect.gain : 0
      return aGain >= bGain ? a : b
    })
    return { type: 'pub', id: best.id }
  }

  // 3. ランダム（pub/bldから）
  const allOptions: Array<{ type: 'pub' | 'bld'; id: string }> = [
    ...pubOptions.map(w => ({ type: 'pub' as const, id: w.id })),
    ...bldOptions.map(b => ({ type: 'bld' as const, id: b.id })),
  ]
  if (allOptions.length === 0) return null
  // 疑似ランダム（RNG使わず先頭）
  return allOptions[0]
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
  const def = BUILDING_CARDS[card.name]!
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
  s = addLog(s, buildActionLog(action.sourceName ?? '', 'reveal-pick', beforePlayer, afterPlayer, state.startPlayerIndex, s.startPlayerIndex))

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
