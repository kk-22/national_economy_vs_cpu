import { BUILDING_CARDS, ROUND_CARDS } from './constants'
import { getPlayer, getMaxWorkers } from './primitives'
import { getAvailablePublicWorkplaces, getAvailableOwnedBuildings } from './availability'
import { GREEDY_BUILD_EXCLUDED } from './cpu'
import { calculateScores } from './round'
import type { GameState, BuildingCard, GameEffect, Player } from './types'

export const BEAM_WIDTH = 5

export type ActionOption = { type: 'pub'; id: string } | { type: 'bld'; id: string }

export function scoreEffect(effect: GameEffect, player: Player, household: number, round: number, availWorkers: number = 1): number {
  const workerCount = player.workers.length
  const wage = ROUND_CARDS[round - 1]?.wage ?? 0
  const expectedWage = workerCount * wage

  switch (effect.kind) {
    case 'build-double': return 160
    case 'build': {
      // 労働者1人しか残っておらず賃金も払えない場合のみ建設を諦める
      if (availWorkers < 2 && player.money < expectedWage) return -Infinity
      const availableAfterBuild = player.workers.filter(w => !w.isTraining && w.placedAt === null).length - 1
      // cpuBuild の greedy フィルタと同じ条件で建設可能カードを探す
      let maxCost = -1
      for (const c of player.hand) {
        if (c.kind !== 'building') continue
        if (GREEDY_BUILD_EXCLUDED.has((c as BuildingCard).name)) continue
        const def = BUILDING_CARDS[(c as BuildingCard).name]
        if (!def) continue
        const discountedCost = Math.max(0, def.cost - effect.discount)
        if (player.hand.length - 1 < discountedCost) continue
        if (def.effect.kind.startsWith('p-')) {
          if (round < 8 || def.assetValue <= 0) continue
        } else {
          // 7ラウンド以下は職場として使えない建物（倉庫など）を建設対象から除外
          if (round <= 7 && !def.isWorkplace) continue
          if (availableAfterBuild < 1) {
            // Fix 1: money が賃金以上なら最後のワーカーでも建設可（assetValue制限を外す）
            if (player.money < expectedWage) {
              if (def.assetValue <= (discountedCost + 1) * 6) continue
            }
          } else {
            // Fix 3: 建設後に手札不足で build 効果の建物が使えない場合は除外
            const remainingHand = player.hand.length - 1 - discountedCost
            if (def.effect.kind === 'build' && remainingHand < 2) continue
          }
        }
        maxCost = Math.max(maxCost, def.cost)
      }
      if (maxCost < 0) return -Infinity
      // Fix 2: money < wage かつ同等以上コストの自分の建物があれば建設しない
      if (player.money < expectedWage) {
        const hasEquivOwned = player.ownedBuildings.some(b => {
          const bDef = BUILDING_CARDS[b.name]
          return bDef && bDef.cost >= maxCost && bDef.isWorkplace && b.workerHereId === null
        })
        if (hasEquivOwned) return -Infinity
      }
      // 大工 < 建設会社 < ゼネコン < 二胡市建設 の優先度順にスコアを上げる
      // discount=1(建設会社)+15, drawAfter=2(ゼネコン)+30 で確実に順序を保証
      return (85 + maxCost * 3) * (availWorkers >= 2 ? 1.2 : 1.0) + effect.discount * 15 + effect.drawAfter * 15
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
      if (round === 9 && availWorkers <= Math.floor(player.workers.length / 2)) return effect.draw * 2
      const ddWorkerBonus = (player.workers.length - 1) * 2
      return effect.draw * (8 + ddWorkerBonus)
    }
    case 'discard-gain': {
      if (player.hand.length < effect.discard || household < effect.gain) return -Infinity
      // ラウンド9後半: 手札→得点の変換機会がないため、gain そのものを得点価値として評価
      if (round === 9 && availWorkers <= Math.floor(player.workers.length / 2)) return effect.gain * 3
      const dgWage = ROUND_CARDS[round - 1]?.wage ?? 0
      const dgExpectedWage = player.workers.length * dgWage
      const dgShortfall = Math.max(0, dgExpectedWage - player.money)
      // お金不足時は市場系施設を鉱山より優先するためスコアを引き上げる
      const dgMultiplier = dgShortfall > 0 ? 2.0 : 0.2
      return effect.gain * dgMultiplier
    }
    case 'gain-supply': {
      if (household < effect.n) return -Infinity
      if (round === 9 && availWorkers <= Math.floor(player.workers.length / 2)) return effect.n * 3
      const gsScore = effect.n * 3
      return gsScore
    }
    case 'draw': {
      // ラウンド9後半: 手札を増やしても得点にならないため大幅に減点
      if (round === 9 && availWorkers <= Math.floor(player.workers.length / 2)) return effect.n * 2
      const drawWorkerBonus = (player.workers.length - 1) * 2
      const drawBase = effect.n * (7 + drawWorkerBonus)
      const availableNow = player.workers.filter(w => !w.isTraining && w.placedAt === null).length
      const hasDrawFactory = player.ownedBuildings.some(b => BUILDING_CARDS[b.name]?.effect.kind === 'discard-draw')
      const drawScore = (hasDrawFactory && availableNow >= 3) ? drawBase * 1.4 : drawBase
      return drawScore
    }
    case 'draw-if-empty': {
      if (round === 9 && availWorkers <= Math.floor(player.workers.length / 2)) return 0
      const diWorkerBonus = (player.workers.length - 1) * 2
      return player.hand.length === 0
        ? effect.empty * (10 + diWorkerBonus)
        : effect.normal * (10 + diWorkerBonus)
    }
    case 'draw-become-start': return 30
    case 'slash-burn': return 25
    case 'draw-consumption':
      // ラウンド9後半: 消費財を増やしても得点にならないため大幅に減点
      if (round === 9 && availWorkers <= Math.floor(player.workers.length / 2)) return effect.n * 2
      // hand>3 でも施設としての価値を反映（discard-gain を常に上回るよう引き上げ）
      return player.hand.length <= 3 ? effect.n * 16 : effect.n * 12
    case 'draw-consumption-to':
      if (round === 9 && availWorkers <= Math.floor(player.workers.length / 2)) return -Infinity
      return player.hand.length >= effect.target ? -Infinity : (effect.target - player.hand.length) * 4
    case 'none': return 5
    default: return 10
  }
}

// 労働者2人のとき増員職場（大学 > 高等学校 > 学校）を優先配置する共通ロジック
export function pickWorkerExpansion(state: GameState, playerId: number): { type: 'pub'; id: string } | null {
  const player = getPlayer(state, playerId)
  if (player.workers.length !== 2) return null
  const available = getAvailablePublicWorkplaces(state, playerId)
  for (const name of ['大学', '高等学校', '学校']) {
    const wp = available.find(w => w.name === name)
    if (wp) return { type: 'pub', id: wp.id }
  }
  return null
}

// greedy スコアで上位 n 件のアクションを返す（beam 候補選択に使用）
export function getTopNActionsGreedy(state: GameState, playerId: number, n: number): ActionOption[] {
  const player = getPlayer(state, playerId)
  const pubOptions = getAvailablePublicWorkplaces(state, playerId)
  const bldOptions = getAvailableOwnedBuildings(state, playerId)
  const avail = player.workers.filter(w => !w.isTraining && w.placedAt === null).length
  const pubBonus = avail >= 2 ? 1.3 : 1.0
  const drawKinds = new Set(['draw', 'discard-draw', 'draw-consumption', 'draw-if-empty'])

  const scored: Array<{ option: ActionOption; score: number }> = []

  for (const wp of pubOptions) {
    const base = scoreEffect(wp.effect, player, state.household, state.round, avail)
    const soldDef = BUILDING_CARDS[wp.name]
    const sc = (soldDef && drawKinds.has(wp.effect.kind))
      ? base * (1.1 + soldDef.cost * 0.2)
      : base * pubBonus
    scored.push({ option: { type: 'pub', id: wp.id }, score: sc })
  }
  for (const bld of bldOptions) {
    const def = BUILDING_CARDS[bld.name]
    if (!def) continue
    const base = scoreEffect(def.effect, player, state.household, state.round, avail)
    const sc = drawKinds.has(def.effect.kind)
      ? base * (1.0 + def.cost * 0.2)
      : base * pubBonus
    scored.push({ option: { type: 'bld', id: bld.id }, score: sc })
  }

  scored.sort((a, b) => b.score - a.score)
  return scored.slice(0, n).map(x => x.option)
}

export function pickDisruptive(state: GameState, playerId: number): { type: 'pub' | 'bld'; id: string } | null {
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

// ラウンド終了後の中間評価関数
export function scoreIntermediateBeam(state: GameState, playerId: number): number {
  const player = getPlayer(state, playerId)
  const wc = player.workers.length
  let score = 0

  if (wc >= 3) score += 1000
  if (wc >= 4) score += 10
  if (wc >= 5) score += 5

  const buildingCards = player.hand.filter(c => c.kind === 'building').length
  const consumptionCards = player.hand.filter(c => c.kind === 'consumption').length
  score += buildingCards * 6 + consumptionCards * 4

  if (state.players[state.startPlayerIndex]?.id === playerId) score += 5

  score += player.ownedBuildings.reduce((s, b) => s + (BUILDING_CARDS[b.name]?.assetValue ?? 0), 0)

  const workplaceCosts = player.ownedBuildings
    .filter(b => BUILDING_CARDS[b.name]?.isWorkplace)
    .map(b => BUILDING_CARDS[b.name]?.cost ?? 0)
    .sort((a, b) => b - a)

  if (wc >= 3 && workplaceCosts.length >= 1) score += workplaceCosts[0] * 10
  if (wc >= 4 && workplaceCosts.length >= 2) score += workplaceCosts[1] * 7
  if (wc >= 5 && workplaceCosts.length >= 3) score += workplaceCosts[2] * 5

  score += player.money
  score -= player.unpaidWages * 3

  return score
}

// startRound に対する終端評価（最終ラウンドは実スコア、それ以外は中間評価）
export function evaluateSimEnd(state: GameState, beamPlayerId: number, startRound: number): number {
  if (startRound === 9) {
    return calculateScores(state).find(sc => sc.playerId === beamPlayerId)?.total ?? 0
  }
  return scoreIntermediateBeam(state, beamPlayerId)
}
