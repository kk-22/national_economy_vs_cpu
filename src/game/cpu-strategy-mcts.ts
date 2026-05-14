import { rngNext } from './primitives'
import { calculateScores } from './round'
import { MCTS_SIMULATIONS } from './cpu'
import { pickWorkerExpansion } from './cpu-scoring'
import { setLastCpuNoAutoTarget } from './turns'
import { placeWorkerOnPublic, placeWorkerOnBuilding, afterAction, afterHumanAction } from './turns'
import { getAvailablePublicWorkplaces, getAvailableOwnedBuildings } from './availability'
import type { GameState } from './types'

export function cpuTakeTurnMCTS(state: GameState, playerId: number): GameState {
  const pubOptions = getAvailablePublicWorkplaces(state, playerId)
  const bldOptions = getAvailableOwnedBuildings(state, playerId)
  if (pubOptions.length === 0 && bldOptions.length === 0) return afterAction(state)

  const expansion = pickWorkerExpansion(state, playerId)
  if (expansion) return placeWorkerOnPublic(state, playerId, expansion.id)

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
      cpuStrategy: (p.cpuStrategy === 'mcts' || p.cpuStrategy === 'beam' || !p.isCpu) ? 'greedy' as const : p.cpuStrategy,
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

export function cpuTakeTurnMCTSNoAuto(state: GameState, playerId: number): GameState {
  const pubOptions = getAvailablePublicWorkplaces(state, playerId)
  const bldOptions = getAvailableOwnedBuildings(state, playerId)
  if (pubOptions.length === 0 && bldOptions.length === 0) return afterHumanAction(state)

  const expansion = pickWorkerExpansion(state, playerId)
  if (expansion) {
    setLastCpuNoAutoTarget({ id: expansion.id, type: 'pub' })
    return placeWorkerOnPublic(state, playerId, expansion.id, true)
  }

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
      cpuStrategy: (p.cpuStrategy === 'mcts' || p.cpuStrategy === 'beam' || !p.isCpu) ? 'greedy' as const : p.cpuStrategy,
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

  setLastCpuNoAutoTarget({ id: bestOption.id, type: bestOption.type })
  if (bestOption.type === 'pub') return placeWorkerOnPublic(state, playerId, bestOption.id, true)
  return placeWorkerOnBuilding(state, playerId, bestOption.id, true)
}
