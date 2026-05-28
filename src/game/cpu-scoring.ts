import { ROUND_CARDS } from './constants'
import { getPlayer, getMaxWorkers, ALL_BUILDING_CARDS } from './primitives'
import { getAvailablePublicWorkplaces, getAvailableOwnedBuildings } from './availability'
import { GREEDY_BUILD_EXCLUDED, getConstructionDiscountForPlayer } from './cpu'
import { calculateScores } from './round'
import type { GameState, BuildingCard, GameEffect, Player, PublicWorkplace, OwnedBuilding, BeamCategory } from './types'

// ---- GA 用スコア重みパラメータ (greedy アクション選択用) ----

export interface ScoreWeights {
  buildDouble: number
  fillWorkers2: number
  fillWorkers3: number
  fillWorkers4: number
  addWorker2: number
  addWorker3: number
  addWorker4: number
  addWorkerImmediate: number
  buildBase: number
  buildCostMult: number
  buildDiscountBonus: number
  buildDrawAfterBonus: number
  buildWorkerBonus: number
  buildFarmFree: number
  revealPickEarlyFew: number
  revealPickEarlyMany: number
  revealPickLateFew: number
  revealPickLateMany: number
  discardDrawBase: number
  discardDrawWorkerMult: number
  discardGainShortMult: number
  discardGainNormalMult: number
  gainSupplyMult: number
  drawBase: number
  drawWorkerMult: number
  drawFactoryBonus: number
  drawIfEmptyBase: number
  drawBecomeStart: number
  slashBurn: number
  drawConsumptionFew: number
  drawConsumptionMany: number
  drawConsumptionToMult: number
  pubBonus: number
  drawCostMult: number
  drawPubExtra: number
  r9LateThresholdFrac: number
  r9DrawMult: number
  r9DiscardDrawMult: number
  r9GainMult: number
  r9DrawConsumptionMult: number
  r9DrawIfEmptyScore: number
  r9DrawBecomeStartScore: number
  drawFactoryMinWorkers: number
  noneScore: number
  defaultScore: number
}

export const DEFAULT_WEIGHTS: ScoreWeights = {
  buildDouble:            300.077,
  fillWorkers2:           55.513,
  fillWorkers3:           0.000,
  fillWorkers4:           0.000,
  addWorker2:             110.526,
  addWorker3:             44.590,
  addWorker4:             12.077,
  addWorkerImmediate:     13.490,
  buildBase:              0.000,
  buildCostMult:          1.482,
  buildDiscountBonus:     31.111,
  buildDrawAfterBonus:    27.479,
  buildWorkerBonus:       1.000,
  buildFarmFree:          19.044,
  revealPickEarlyFew:     74.051,
  revealPickEarlyMany:    20.685,
  revealPickLateFew:      50.508,
  revealPickLateMany:     46.516,
  discardDrawBase:        5.514,
  discardDrawWorkerMult:  2.664,
  discardGainShortMult:   4.465,
  discardGainNormalMult:  2.016,
  gainSupplyMult:         3.843,
  drawBase:               1.493,
  drawWorkerMult:         1.887,
  drawFactoryBonus:       1.842,
  drawIfEmptyBase:        11.906,
  drawBecomeStart:        17.823,
  slashBurn:              19.150,
  drawConsumptionFew:     18.898,
  drawConsumptionMany:    4.618,
  drawConsumptionToMult:  9.575,
  pubBonus:               1.755,
  drawCostMult:           0.224,
  drawPubExtra:           0.018,
  r9LateThresholdFrac:    0.500,
  r9DrawMult:             2.000,
  r9DiscardDrawMult:      2.000,
  r9GainMult:             3.000,
  r9DrawConsumptionMult:  2.000,
  r9DrawIfEmptyScore:     0.000,
  r9DrawBecomeStartScore: 2.000,
  drawFactoryMinWorkers:  3.000,
  noneScore:              5.000,
  defaultScore:           10.000,
}

export const WEIGHT_BOUNDS: Record<keyof ScoreWeights, [number, number]> = {
  buildDouble:            [0, 400],
  fillWorkers2:           [0, 300],
  fillWorkers3:           [0, 250],
  fillWorkers4:           [0, 200],
  addWorker2:             [0, 300],
  addWorker3:             [0, 150],
  addWorker4:             [0, 80],
  addWorkerImmediate:     [0, 200],
  buildBase:              [0, 250],
  buildCostMult:          [0, 15],
  buildDiscountBonus:     [0, 50],
  buildDrawAfterBonus:    [0, 50],
  buildWorkerBonus:       [1.0, 2.5],
  buildFarmFree:          [0, 200],
  revealPickEarlyFew:     [0, 200],
  revealPickEarlyMany:    [0, 180],
  revealPickLateFew:      [0, 180],
  revealPickLateMany:     [0, 160],
  discardDrawBase:        [0, 30],
  discardDrawWorkerMult:  [0, 8],
  discardGainShortMult:   [0, 8],
  discardGainNormalMult:  [0, 3],
  gainSupplyMult:         [0, 12],
  drawBase:               [0, 25],
  drawWorkerMult:         [0, 8],
  drawFactoryBonus:       [1.0, 3.0],
  drawIfEmptyBase:        [0, 25],
  drawBecomeStart:        [0, 80],
  slashBurn:              [0, 100],
  drawConsumptionFew:     [0, 50],
  drawConsumptionMany:    [0, 40],
  drawConsumptionToMult:  [0, 15],
  pubBonus:               [1.0, 2.5],
  drawCostMult:           [0, 1.0],
  drawPubExtra:           [0, 0.5],
  r9LateThresholdFrac:    [0.1, 1.0],
  r9DrawMult:             [0, 8],
  r9DiscardDrawMult:      [0, 8],
  r9GainMult:             [0, 10],
  r9DrawConsumptionMult:  [0, 8],
  r9DrawIfEmptyScore:     [0, 15],
  r9DrawBecomeStartScore: [0, 10],
  drawFactoryMinWorkers:  [1, 5],
  noneScore:              [0, 20],
  defaultScore:           [0, 20],
}

// プレイヤー別重みストア（GA 用）
const _playerWeights = new Map<number, ScoreWeights>()

export function setPlayerWeights(playerId: number, weights: ScoreWeights): void {
  _playerWeights.set(playerId, weights)
}

export function clearPlayerWeights(): void {
  _playerWeights.clear()
}

export function getPlayerWeights(playerId: number): ScoreWeights {
  return _playerWeights.get(playerId) ?? DEFAULT_WEIGHTS
}

// ---- GA 用スコア重みパラメータ (ビームサーチ中間評価用) ----
// 全変数を early(R1-4) / late(R5-8) の2段階で管理。R9は最終スコアを使用するため不要。
// GA最適化は整数1刻みで行う。

export interface BeamEvalWeights {
  workers3Bonus_early:        number  // 3人目ワーカー取得ボーナス
  workers3Bonus_late:         number
  workers4Bonus_early:        number  // 4人目ワーカー取得ボーナス（下限50: GA最適化でも4人目雇用を諦めないよう保証）
  workers4Bonus_late:         number  // 下限50
  workers5Bonus_early:        number  // 5人目ワーカー取得ボーナス
  workers5Bonus_late:         number
  buildingCardValue_early:    number  // 手札建物カード1枚あたりの評価値
  buildingCardValue_late:     number
  consumptionCardValue_early: number  // 手札消費財1枚あたりの評価値
  consumptionCardValue_late:  number
  startPlayerBonus_early:     number  // スタートプレイヤーボーナス
  startPlayerBonus_late:      number
  assetValueMult_early:       number  // 所有建物の assetValue への乗数
  assetValueMult_late:        number
  workplace1CostMult_early:   number  // 最高コスト職場のコストへの乗数
  workplace1CostMult_late:    number
  workplace2CostMult_early:   number  // 2番目コスト職場のコストへの乗数
  workplace2CostMult_late:    number
  workplace3CostMult_early:   number  // 3番目コスト職場のコストへの乗数（5人目前提）
  workplace3CostMult_late:    number
  moneyMult_early:            number  // 所持金への乗数
  moneyMult_late:             number
  unpaidWagesPenalty_early:   number  // 未払い賃金1単位あたりのペナルティ
  unpaidWagesPenalty_late:    number
  vpCardValue_early:          number  // 勝利点カード1枚あたりの評価値
  vpCardValue_late:           number
  drawBuildingCostMult_early: number  // 建物カードを引く建物のコスト合算への乗数
  drawBuildingCostMult_late:  number
  // カテゴリボーナス: カテゴリ内の所有建物の最大コスト × ボーナス（複数所有しても1棟分のみ加算）
  builderBonus_early:         number  // 建設系建物（建設会社・ゼネコン系）
  builderBonus_late:          number
  drawBuildingBonus_early:    number  // 建物カードドロー系（工場・製鉄所系）
  drawBuildingBonus_late:     number
  drawConsumptionBonus_early: number  // 消費財ドロー系（農場・大農園系）
  drawConsumptionBonus_late:  number
  incomeBonus_early:          number  // 収入系（珈琲店・レストラン系）
  incomeBonus_late:           number
}

export const DEFAULT_BEAM_EVAL_WEIGHTS: BeamEvalWeights = {
  workers3Bonus_early:        763,
  workers3Bonus_late:         763,
  workers4Bonus_early:        50,
  workers4Bonus_late:         50,
  workers5Bonus_early:        1,
  workers5Bonus_late:         1,
  buildingCardValue_early:    26,
  buildingCardValue_late:     26,
  consumptionCardValue_early: 16,
  consumptionCardValue_late:  16,
  startPlayerBonus_early:     27,
  startPlayerBonus_late:      27,
  assetValueMult_early:       3,
  assetValueMult_late:        3,
  workplace1CostMult_early:   18,
  workplace1CostMult_late:    18,
  workplace2CostMult_early:   10,
  workplace2CostMult_late:    10,
  workplace3CostMult_early:   0,
  workplace3CostMult_late:    0,
  moneyMult_early:            5,
  moneyMult_late:             5,
  unpaidWagesPenalty_early:   9,
  unpaidWagesPenalty_late:    9,
  vpCardValue_early:          5,
  vpCardValue_late:           5,
  drawBuildingCostMult_early: 8,
  drawBuildingCostMult_late:  8,
  builderBonus_early:         0,
  builderBonus_late:          0,
  drawBuildingBonus_early:    0,
  drawBuildingBonus_late:     0,
  drawConsumptionBonus_early: 0,
  drawConsumptionBonus_late:  0,
  incomeBonus_early:          0,
  incomeBonus_late:           0,
}

export const BEAM_EVAL_WEIGHT_BOUNDS: Record<keyof BeamEvalWeights, [number, number]> = {
  workers3Bonus_early:        [0, 1000],
  workers3Bonus_late:         [0, 1000],
  workers4Bonus_early:        [50, 200],  // 下限50: GA最適化でも4人目雇用を諦めないよう保証
  workers4Bonus_late:         [50, 200],  // 下限50
  workers5Bonus_early:        [0, 100],
  workers5Bonus_late:         [0, 100],
  buildingCardValue_early:    [0, 60],
  buildingCardValue_late:     [0, 60],
  consumptionCardValue_early: [0, 30],
  consumptionCardValue_late:  [0, 30],
  startPlayerBonus_early:     [0, 50],
  startPlayerBonus_late:      [0, 50],
  assetValueMult_early:       [0, 15],
  assetValueMult_late:        [0, 15],
  workplace1CostMult_early:   [10, 50],
  workplace1CostMult_late:    [10, 50],
  workplace2CostMult_early:   [10, 40],
  workplace2CostMult_late:    [10, 40],
  workplace3CostMult_early:   [1, 30],
  workplace3CostMult_late:    [1, 30],
  moneyMult_early:            [0, 10],
  moneyMult_late:             [0, 10],
  unpaidWagesPenalty_early:   [0, 20],
  unpaidWagesPenalty_late:    [0, 20],
  vpCardValue_early:          [0, 20],
  vpCardValue_late:           [0, 20],
  drawBuildingCostMult_early: [0, 20],
  drawBuildingCostMult_late:  [0, 20],
  builderBonus_early:         [0, 20],
  builderBonus_late:          [0, 20],
  drawBuildingBonus_early:    [0, 20],
  drawBuildingBonus_late:     [0, 20],
  drawConsumptionBonus_early: [0, 20],
  drawConsumptionBonus_late:  [0, 20],
  incomeBonus_early:          [0, 20],
  incomeBonus_late:           [0, 20],
}

// ビームサーチ中間評価重みストア（GA 用）
let _beamEvalWeights: BeamEvalWeights | null = null

export function setBeamEvalWeights(weights: BeamEvalWeights): void {
  _beamEvalWeights = weights
}

export function clearBeamEvalWeights(): void {
  _beamEvalWeights = null
}

export function getBeamEvalWeights(): BeamEvalWeights {
  return _beamEvalWeights ?? DEFAULT_BEAM_EVAL_WEIGHTS
}

export type ActionOption = { type: 'pub'; id: string } | { type: 'bld'; id: string }

// 上位互換関係にある職場から下位互換の選択肢を除外する
// 1. 採石場が選択肢にあれば鉱山を除外（採石場は draw-become-start で上位互換）
// 2. 大農園（draw-consumption n:3）が選択肢にあれば農場（n:2）を除外
// 3. 宮大工（build-gain-vp）が一般職場にあれば大工を除外（build + 勝利点で完全上位互換）
// 4. 一般職場と同名の自分の建物は除外（一般職場を使えば相手を妨害できるため）
export function filterDominatedWorkplaces(
  pubOptions: PublicWorkplace[],
  bldOptions: OwnedBuilding[],
): { pubOptions: PublicWorkplace[]; bldOptions: OwnedBuilding[] } {
  let filteredPub = pubOptions
  let filteredBld = bldOptions

  // 1. 採石場 > 鉱山
  if (filteredPub.some(wp => wp.name === '採石場')) {
    filteredPub = filteredPub.filter(wp => wp.name !== '鉱山')
  }

  // 2. 大農園 > 農場（draw-consumption n:3 が n:2 の上位互換）
  const hasDainouen = filteredPub.some(wp => wp.name === '大農園') || filteredBld.some(b => b.name === '大農園')
  if (hasDainouen) {
    filteredPub = filteredPub.filter(wp => wp.name !== '農場')
    filteredBld = filteredBld.filter(b => b.name !== '農場')
  }

  // 4. 宮大工（build-gain-vp）が一般職場にある場合、大工を除外
  if (filteredPub.some(wp => wp.name === '宮大工')) {
    filteredPub = filteredPub.filter(wp => wp.name !== '大工')
    filteredBld = filteredBld.filter(b => b.name !== '大工')
  }

  // 5. 一般職場と同名の自分の建物を除外
  const pubNames = new Set(filteredPub.map(wp => wp.name))
  filteredBld = filteredBld.filter(b => !pubNames.has(b.name))

  return { pubOptions: filteredPub, bldOptions: filteredBld }
}

export function scoreEffect(effect: GameEffect, player: Player, household: number, round: number, availWorkers: number = 1, isStartPlayer: boolean = false, weights: ScoreWeights = DEFAULT_WEIGHTS): number {
  const w = weights
  const workerCount = player.workers.length
  const wage = ROUND_CARDS[round - 1]?.wage ?? 0
  const expectedWage = workerCount * wage

  switch (effect.kind) {
    case 'build-double': return w.buildDouble
    case 'build': {
      // 労働者1人しか残っておらず賃金も払えない場合のみ建設を諦める
      if (availWorkers < 2 && player.money < expectedWage) return -Infinity
      const availableAfterBuild = player.workers.filter(w => !w.isTraining && w.placedAt === null).length - 1
      // cpuBuild の greedy フィルタと同じ条件で建設可能カードを探す
      let maxCost = -1
      for (const c of player.hand) {
        if (c.kind !== 'building') continue
        if (GREEDY_BUILD_EXCLUDED.has((c as BuildingCard).name)) continue
        const def = ALL_BUILDING_CARDS[(c as BuildingCard).name]
        if (!def) continue
        const selfDiscount = getConstructionDiscountForPlayer(player, (c as BuildingCard).name)
        const discountedCost = Math.max(0, def.cost - effect.discount - selfDiscount)
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
          const bDef = ALL_BUILDING_CARDS[b.name]
          return bDef && bDef.cost >= maxCost && bDef.isWorkplace && b.workerHereId === null
        })
        if (hasEquivOwned) return -Infinity
      }
      // 大工 < 建設会社 < ゼネコン < 二胡市建設 の優先度順にスコアを上げる
      // discount=1(建設会社)+15, drawAfter=2(ゼネコン)+30 で確実に順序を保証
      return (w.buildBase + maxCost * w.buildCostMult) * (availWorkers >= 2 ? w.buildWorkerBonus : 1.0) + effect.discount * w.buildDiscountBonus + effect.drawAfter * w.buildDrawAfterBonus
    }
    case 'build-farm-free': return w.buildFarmFree
    case 'fill-workers': {
      if (workerCount >= effect.target) return -Infinity
      if (round >= 7) return -Infinity
      // 5人目になる場合のみ賃金持続性チェック
      if (effect.target >= 5 && (player.unpaidWages > 0 || player.money < effect.target * wage)) return -Infinity
      // 労働者が少ないほど増員価値が高い（2人時は最優先・pubBonus込みでビルド系に勝つ）
      const fillBase = workerCount <= 2 ? w.fillWorkers2 : (workerCount <= 3 ? w.fillWorkers3 : w.fillWorkers4)
      return fillBase * (1 - (round - 1) / 9)
    }
    case 'add-worker': {
      if (workerCount >= getMaxWorkers(player)) return -Infinity
      if (!effect.immediate) {
        if (round >= 7) return -Infinity
        // 5人目になる場合のみ賃金持続性チェック
        if (workerCount + 1 >= 5 && (player.unpaidWages > 0 || player.money < (workerCount + 1) * wage)) return -Infinity
        // 2人→3人は最優先、4人・5人は段階的に下げる
        const addBase = workerCount <= 2 ? w.addWorker2 : (workerCount <= 3 ? w.addWorker3 : w.addWorker4)
        return addBase * (1 - (round - 1) / 9)
      }
      // immediate add-worker（専門学校）: 5人目の場合のみ賃金チェック
      if (workerCount + 1 >= 5 && (player.unpaidWages > 0 || player.money < (workerCount + 1) * wage)) return -Infinity
      return w.addWorkerImmediate
    }
    case 'reveal-pick': {
      if (round <= 3) return player.hand.length < 5 ? w.revealPickEarlyFew : w.revealPickEarlyMany
      return player.hand.length < 3 ? w.revealPickLateFew : w.revealPickLateMany
    }
    case 'discard-draw': {
      if (player.hand.length < effect.discard) return -Infinity
      // R9後半: カードの価値はなく純粋な net draw 枚数で評価
      if (round === 9 && availWorkers <= Math.floor(player.workers.length * w.r9LateThresholdFrac)) return (effect.draw - effect.discard) * w.r9DiscardDrawMult
      const netDraw = effect.draw - effect.discard
      const ddWorkerBonus = (player.workers.length - 1) * w.discardDrawWorkerMult
      return netDraw * (w.discardDrawBase + ddWorkerBonus)
    }
    case 'discard-gain': {
      if (player.hand.length < effect.discard || household < effect.gain) return -Infinity
      // ラウンド9後半: 手札は得点にならないので discard コストはゼロ、gain のみ評価
      if (round === 9 && availWorkers <= Math.floor(player.workers.length * w.r9LateThresholdFrac)) return effect.gain * w.r9GainMult
      const dgWage = ROUND_CARDS[round - 1]?.wage ?? 0
      const dgExpectedWage = player.workers.length * dgWage
      const dgShortfall = Math.max(0, dgExpectedWage - player.money)
      // お金不足時は市場系施設を鉱山より優先するためスコアを引き上げる
      const dgMultiplier = dgShortfall > 0 ? w.discardGainShortMult : w.discardGainNormalMult
      // 捨て枚数を機会コストとして差し引く
      const cardValue = w.drawBase + (player.workers.length - 1) * w.drawWorkerMult
      return (effect.gain - effect.discard * cardValue) * dgMultiplier
    }
    case 'gain-supply': {
      if (household < effect.n) return -Infinity
      if (round === 9 && availWorkers <= Math.floor(player.workers.length * w.r9LateThresholdFrac)) return effect.n * w.r9GainMult
      return effect.n * w.gainSupplyMult
    }
    case 'draw': {
      // ラウンド9後半: 手札を増やしても得点にならないため大幅に減点
      if (round === 9 && availWorkers <= Math.floor(player.workers.length * w.r9LateThresholdFrac)) return effect.n * w.r9DrawMult
      const drawWorkerBonus = (player.workers.length - 1) * w.drawWorkerMult
      const drawBaseScore = effect.n * (w.drawBase + drawWorkerBonus)
      const availableNow = player.workers.filter(w => !w.isTraining && w.placedAt === null).length
      const hasDrawFactory = player.ownedBuildings.some(b => ALL_BUILDING_CARDS[b.name]?.effect.kind === 'discard-draw')
      return (hasDrawFactory && availableNow >= Math.round(w.drawFactoryMinWorkers)) ? drawBaseScore * w.drawFactoryBonus : drawBaseScore
    }
    case 'draw-if-empty': {
      if (round === 9 && availWorkers <= Math.floor(player.workers.length * w.r9LateThresholdFrac)) return w.r9DrawIfEmptyScore
      const diWorkerBonus = (player.workers.length - 1) * w.drawWorkerMult
      return player.hand.length === 0
        ? effect.empty * (w.drawIfEmptyBase + diWorkerBonus)
        : effect.normal * (w.drawIfEmptyBase + diWorkerBonus)
    }
    case 'draw-become-start': {
      if (round === 9 && availWorkers <= Math.floor(player.workers.length * w.r9LateThresholdFrac)) return w.r9DrawBecomeStartScore
      // すでにスタートプレイヤーなら SP 効果はゼロ。draw n=1 相当のみ評価
      if (isStartPlayer) return Math.floor(1 * (w.drawBase + (player.workers.length - 1) * w.drawWorkerMult))
      return w.drawBecomeStart
    }
    case 'slash-burn': return w.slashBurn
    case 'draw-consumption':
      // ラウンド9後半: 消費財を増やしても得点にならないため大幅に減点
      if (round === 9 && availWorkers <= Math.floor(player.workers.length * w.r9LateThresholdFrac)) return effect.n * w.r9DrawConsumptionMult
      // hand>3 でも施設としての価値を反映（discard-gain を常に上回るよう引き上げ）
      return player.hand.length <= 3 ? effect.n * w.drawConsumptionFew : effect.n * w.drawConsumptionMany
    case 'draw-consumption-to':
      if (round === 9 && availWorkers <= Math.floor(player.workers.length * w.r9LateThresholdFrac)) return -Infinity
      return player.hand.length >= effect.target ? -Infinity : (effect.target - player.hand.length) * w.drawConsumptionToMult
    case 'none': return w.noneScore

    // --- メセナ専用 ---
    case 'draw-gain-vp': {
      // N枚ドロー + 勝利点1枚（勝利点1枚の期待値を8点と設定）
      const VP_CARD_VALUE = 8
      if (round === 9 && availWorkers <= Math.floor(player.workers.length * w.r9LateThresholdFrac)) {
        return effect.n * w.r9DrawMult + VP_CARD_VALUE
      }
      const drawScore = effect.n * (w.drawBase + (player.workers.length - 1) * w.drawWorkerMult)
      return effect.drawType === 'consumption'
        ? (player.hand.length <= 3 ? effect.n * w.drawConsumptionFew : effect.n * w.drawConsumptionMany) + VP_CARD_VALUE
        : drawScore + VP_CARD_VALUE
    }
    case 'build-gain-vp': {
      const VP_CARD_VALUE = 8
      if (availWorkers < 2 && player.money < player.workers.length * (ROUND_CARDS[round - 1]?.wage ?? 0)) return -Infinity
      return (w.buildBase + 5 * w.buildCostMult) + VP_CARD_VALUE
    }
    case 'draw-consumption-by-hand': {
      const handLen = player.hand.length
      if (handLen >= 3) return -Infinity
      const n = handLen === 0 ? 3 : handLen === 1 ? 2 : 1
      if (round === 9 && availWorkers <= Math.floor(player.workers.length * w.r9LateThresholdFrac)) return n * w.r9DrawConsumptionMult
      return player.hand.length <= 3 ? n * w.drawConsumptionFew : n * w.drawConsumptionMany
    }
    case 'discard-gain-household':
    case 'discard-gain-household-min': {
      const hh = 'minHousehold' in effect ? effect.minHousehold : household
      if (player.hand.length < effect.discard || household < hh) return -Infinity
      if (round === 9 && availWorkers <= Math.floor(player.workers.length * w.r9LateThresholdFrac)) return effect.gain * w.r9GainMult
      return (effect.gain - effect.discard * (w.drawBase + (player.workers.length - 1) * w.drawWorkerMult)) * w.discardGainNormalMult
    }
    case 'gain-household': {
      if (household < effect.minHousehold) return -Infinity
      if (round === 9 && availWorkers <= Math.floor(player.workers.length * w.r9LateThresholdFrac)) return effect.net * w.r9GainMult
      return effect.net * w.gainSupplyMult
    }
    case 'gain-per-consumption': {
      const consCount = player.hand.filter(c => c.kind === 'consumption').length
      const gain = consCount * effect.perCard
      if (gain <= 0 || household < gain) return -Infinity
      if (round === 9 && availWorkers <= Math.floor(player.workers.length * w.r9LateThresholdFrac)) return gain * w.r9GainMult
      return gain * w.gainSupplyMult
    }
    case 'draw-if-mine': {
      // availability 通過済み = 鉱山に配置済みなので、ドロースコアで評価
      if (round === 9 && availWorkers <= Math.floor(player.workers.length * w.r9LateThresholdFrac)) return effect.n * w.r9DrawMult
      return effect.n * (w.drawBase + (player.workers.length - 1) * w.drawWorkerMult)
    }
    case 'draw-consumption-if-have': {
      const hasConsumption = player.hand.some(c => c.kind === 'consumption')
      const n = hasConsumption ? effect.withConsumption : effect.without
      if (round === 9 && availWorkers <= Math.floor(player.workers.length * w.r9LateThresholdFrac)) return n * w.r9DrawConsumptionMult
      return player.hand.length <= 3 ? n * w.drawConsumptionFew : n * w.drawConsumptionMany
    }
    case 'discard-draw-min-hand': {
      if (player.hand.length < effect.minHand) return -Infinity
      if (round === 9 && availWorkers <= Math.floor(player.workers.length * w.r9LateThresholdFrac)) return (effect.draw - effect.discard) * w.r9DiscardDrawMult
      return (effect.draw - effect.discard) * (w.discardDrawBase + (player.workers.length - 1) * w.discardDrawWorkerMult)
    }
    case 'draw-with-build-discount': {
      // 工業団地: 3枚ドロー（割引は建設効果に反映されないが、ドロー価値で評価）
      if (round === 9 && availWorkers <= Math.floor(player.workers.length * w.r9LateThresholdFrac)) return effect.n * w.r9DrawMult
      return effect.n * (w.drawBase + (player.workers.length - 1) * w.drawWorkerMult)
    }
    case 'build-no-sell': {
      // 建築会社: 売却禁止建物を建設。buildBase + コスト評価
      if (availWorkers < 2 && player.money < player.workers.length * (ROUND_CARDS[round - 1]?.wage ?? 0)) return -Infinity
      return (w.buildBase + 5 * w.buildCostMult) + effect.drawAfter * w.buildDrawAfterBonus
    }
    case 'build-free-if-cheap': {
      // プレハブ工務店: 安い建物無料建設
      const freeable = player.hand.some(c => c.kind === 'building' && (ALL_BUILDING_CARDS[c.name]?.assetValue ?? Infinity) <= effect.maxAsset)
      if (!freeable) return -Infinity
      return w.buildFarmFree  // farmFreeと同等の評価
    }
    case 'build-two': {
      // 地球建設: 2棟同時建設
      const buildings = player.hand.filter(c => c.kind === 'building')
      if (buildings.length < 2) return -Infinity
      return w.buildDouble  // buildDoubleと同等の評価
    }
    case 'draw-consumption-hold': {
      // 醸造所: 次ラウンドに消費財4枚（遅延価値）
      if (round >= 9) return -Infinity  // 最終ラウンドは意味なし
      return effect.n * w.drawConsumptionFew * 0.7  // 遅延のため若干割引
    }
    case 'p-if-empty-hand':
    case 'p-vp-double':
    case 'p-if-own-n-buildings':
    case 'p-if-tag-n':
    case 'p-if-no-sell-n':
    case 'p-vp-build-discount':
      return round >= 8 ? w.noneScore + 5 : w.noneScore  // 終盤のみ価値あり

    default: return w.defaultScore
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

// 公共職場のbeamCategoryをRound_CARDSから逆引きするマップ（初回アクセス時に生成）
let _publicWorkplaceCategories: Map<string, BeamCategory> | null = null
function getPublicWorkplaceCategories(): Map<string, BeamCategory> {
  if (_publicWorkplaceCategories) return _publicWorkplaceCategories
  _publicWorkplaceCategories = new Map()
  for (const round of ROUND_CARDS) {
    for (const wp of round.workplaces) {
      if (wp.beamCategory && !_publicWorkplaceCategories.has(wp.name)) {
        _publicWorkplaceCategories.set(wp.name, wp.beamCategory)
      }
    }
  }
  return _publicWorkplaceCategories
}

// カード名からbeamCategoryを返す（所有建物はBUILDING_CARDS、公共職場はROUND_CARDS）
function getCardBeamCategory(name: string): BeamCategory | undefined {
  return ALL_BUILDING_CARDS[name]?.beamCategory ?? getPublicWorkplaceCategories().get(name)
}

// greedy スコアで上位 n 件のアクションを返す（beam 候補選択に使用）
// 上位2手は無条件選択、残り n-2 手は未使用カテゴリを優先して多様性を保証する
export function getTopNActionsGreedy(state: GameState, playerId: number, n: number): ActionOption[] {
  const player = getPlayer(state, playerId)
  const { pubOptions, bldOptions } = filterDominatedWorkplaces(
    getAvailablePublicWorkplaces(state, playerId),
    getAvailableOwnedBuildings(state, playerId),
  )
  const avail = player.workers.filter(w => !w.isTraining && w.placedAt === null).length
  const weights = getPlayerWeights(playerId)
  const pubBonus = avail >= 2 ? weights.pubBonus : 1.0
  const drawKinds = new Set(['draw', 'discard-draw', 'draw-consumption', 'draw-if-empty'])
  const isStartPlayer = state.players[state.startPlayerIndex]?.id === player.id

  const scored: Array<{ option: ActionOption; score: number; name: string }> = []

  for (const wp of pubOptions) {
    const base = scoreEffect(wp.effect, player, state.household, state.round, avail, isStartPlayer, weights)
    const soldDef = ALL_BUILDING_CARDS[wp.name]
    const sc = (soldDef && drawKinds.has(wp.effect.kind))
      ? base * (1.0 + weights.drawPubExtra + soldDef.cost * weights.drawCostMult)
      : base * pubBonus
    scored.push({ option: { type: 'pub', id: wp.id }, score: sc, name: wp.name })
  }
  for (const bld of bldOptions) {
    const def = ALL_BUILDING_CARDS[bld.name]
    if (!def) continue
    const base = scoreEffect(def.effect, player, state.household, state.round, avail, isStartPlayer, weights)
    const sc = drawKinds.has(def.effect.kind)
      ? base * (1.0 + def.cost * weights.drawCostMult)
      : base * pubBonus
    scored.push({ option: { type: 'bld', id: bld.id }, score: sc, name: bld.name })
  }

  scored.sort((a, b) => b.score - a.score)

  // 上位2手を無条件選択
  const result: ActionOption[] = []
  const seenCategories = new Set<string>()
  const top2Count = Math.min(2, scored.length, n)
  for (let i = 0; i < top2Count; i++) {
    result.push(scored[i].option)
    const cat = getCardBeamCategory(scored[i].name)
    if (cat) seenCategories.add(cat)
  }

  if (result.length >= n) return result

  // 残り n-2 手：未使用カテゴリを優先、枯渇したらgreedy補完
  const remaining = scored.slice(top2Count)
  const diversePicks: ActionOption[] = []
  const greedyFallback: ActionOption[] = []

  for (const item of remaining) {
    const cat = getCardBeamCategory(item.name)
    if (cat && !seenCategories.has(cat)) {
      diversePicks.push(item.option)
      seenCategories.add(cat)
    } else {
      greedyFallback.push(item.option)
    }
  }

  for (const opt of [...diversePicks, ...greedyFallback]) {
    if (result.length >= n) break
    result.push(opt)
  }

  return result
}

export function pickDisruptive(state: GameState, playerId: number): { type: 'pub' | 'bld'; id: string } | null {
  // 自分の場の建物は使用しない
  const pubOptions = getAvailablePublicWorkplaces(state, playerId).filter(wp => wp.name !== '大工')
  if (pubOptions.length === 0) return null

  const costOf = (name: string) => ALL_BUILDING_CARDS[name]?.cost ?? 0
  const assetOf = (name: string) => ALL_BUILDING_CARDS[name]?.assetValue ?? 0
  const expansionOrder = ['専門学校', '大学', '学校', '高等学校']

  // 優先度（小さいほど優先）:
  // 2: 一般職場 cost>=5 / 3: cost4 / 4: 万博 / 5: cost3
  // 6: 百貨店 / 7: スーパーマーケット / 8: cost2 / 9: 採石場 / 10: 市場
  // 11: cost1 / 12: 拡張職場 / 13: 露店 / 14: 鉱山
  type Scored = { type: 'pub'; id: string; priority: number; tiebreak: number }
  const scored: Scored[] = []

  for (const wp of pubOptions) {
    if (wp.name === '万博') {
      scored.push({ type: 'pub', id: wp.id, priority: 4, tiebreak: 0 })
      continue
    }
    if (wp.name === '百貨店') {
      scored.push({ type: 'pub', id: wp.id, priority: 6, tiebreak: 0 })
      continue
    }
    if (wp.name === 'スーパーマーケット') {
      scored.push({ type: 'pub', id: wp.id, priority: 7, tiebreak: 0 })
      continue
    }
    if (wp.name === '採石場') {
      scored.push({ type: 'pub', id: wp.id, priority: 9, tiebreak: 0 })
      continue
    }
    if (wp.name === '市場') {
      scored.push({ type: 'pub', id: wp.id, priority: 10, tiebreak: 0 })
      continue
    }
    if (expansionOrder.includes(wp.name)) {
      scored.push({ type: 'pub', id: wp.id, priority: 12, tiebreak: expansionOrder.length - expansionOrder.indexOf(wp.name) })
      continue
    }
    if (wp.name === '露店') {
      scored.push({ type: 'pub', id: wp.id, priority: 13, tiebreak: 0 })
      continue
    }
    if (wp.name === '鉱山') {
      scored.push({ type: 'pub', id: wp.id, priority: 14, tiebreak: 0 })
      continue
    }
    if (wp.kind === 'sold') {
      const cost = costOf(wp.name)
      let priority: number
      if (cost >= 5) priority = 2
      else if (cost === 4) priority = 3
      else if (cost === 3) priority = 5
      else if (cost === 2) priority = 8
      else if (cost === 1) priority = 11
      else priority = 99
      scored.push({ type: 'pub', id: wp.id, priority, tiebreak: assetOf(wp.name) })
      continue
    }
    scored.push({ type: 'pub', id: wp.id, priority: 99, tiebreak: 0 })
  }

  const valid = scored.filter(s => s.priority < 99)
  if (valid.length === 0) return { type: 'pub', id: pubOptions[0].id }

  valid.sort((a, b) => a.priority !== b.priority ? a.priority - b.priority : b.tiebreak - a.tiebreak)
  return { type: valid[0].type, id: valid[0].id }
}

const DRAW_BUILDING_EFFECT_KINDS = new Set([
  'draw', 'discard-draw', 'discard-draw-min-hand',
  'reveal-pick', 'draw-if-empty', 'draw-if-mine',
  'draw-with-build-discount',
])

// early/late の2段階重みをラウンドに応じて単一オブジェクトに解決する
interface ResolvedBeamWeights {
  workers3Bonus: number; workers4Bonus: number; workers5Bonus: number
  buildingCardValue: number; consumptionCardValue: number
  startPlayerBonus: number; assetValueMult: number
  workplace1CostMult: number; workplace2CostMult: number; workplace3CostMult: number
  moneyMult: number; unpaidWagesPenalty: number
  vpCardValue: number; drawBuildingCostMult: number
  builderBonus: number; drawBuildingBonus: number
  drawConsumptionBonus: number; incomeBonus: number
}

function resolveBeamWeights(w: BeamEvalWeights, startRound: number): ResolvedBeamWeights {
  const late = startRound >= 5
  return {
    workers3Bonus:        late ? w.workers3Bonus_late        : w.workers3Bonus_early,
    workers4Bonus:        late ? w.workers4Bonus_late        : w.workers4Bonus_early,
    workers5Bonus:        late ? w.workers5Bonus_late        : w.workers5Bonus_early,
    buildingCardValue:    late ? w.buildingCardValue_late    : w.buildingCardValue_early,
    consumptionCardValue: late ? w.consumptionCardValue_late : w.consumptionCardValue_early,
    startPlayerBonus:     late ? w.startPlayerBonus_late     : w.startPlayerBonus_early,
    assetValueMult:       late ? w.assetValueMult_late       : w.assetValueMult_early,
    workplace1CostMult:   late ? w.workplace1CostMult_late   : w.workplace1CostMult_early,
    workplace2CostMult:   late ? w.workplace2CostMult_late   : w.workplace2CostMult_early,
    workplace3CostMult:   late ? w.workplace3CostMult_late   : w.workplace3CostMult_early,
    moneyMult:            late ? w.moneyMult_late            : w.moneyMult_early,
    unpaidWagesPenalty:   late ? w.unpaidWagesPenalty_late   : w.unpaidWagesPenalty_early,
    vpCardValue:          late ? w.vpCardValue_late          : w.vpCardValue_early,
    drawBuildingCostMult: late ? w.drawBuildingCostMult_late : w.drawBuildingCostMult_early,
    builderBonus:         late ? w.builderBonus_late         : w.builderBonus_early,
    drawBuildingBonus:    late ? w.drawBuildingBonus_late    : w.drawBuildingBonus_early,
    drawConsumptionBonus: late ? w.drawConsumptionBonus_late : w.drawConsumptionBonus_early,
    incomeBonus:          late ? w.incomeBonus_late          : w.incomeBonus_early,
  }
}

const SCORE_CATEGORIES = ['builder', 'draw-building', 'draw-consumption', 'income'] as const

// ラウンド終了後の中間評価関数（startRound で early/late を切り替え）
export function scoreIntermediateBeam(state: GameState, playerId: number, startRound: number): number {
  const w = resolveBeamWeights(getBeamEvalWeights(), startRound)
  const player = getPlayer(state, playerId)
  const wc = player.workers.length
  let score = 0

  if (wc >= 3) score += w.workers3Bonus
  if (wc >= 4) score += w.workers4Bonus
  if (wc >= 5) score += w.workers5Bonus

  const buildingCards = player.hand.filter(c => c.kind === 'building').length
  const consumptionCards = player.hand.filter(c => c.kind === 'consumption').length
  score += buildingCards * w.buildingCardValue + consumptionCards * w.consumptionCardValue

  if (state.players[state.startPlayerIndex]?.id === playerId) score += w.startPlayerBonus

  score += player.ownedBuildings.reduce(
    (s, b) => s + (ALL_BUILDING_CARDS[b.name]?.assetValue ?? 0) * w.assetValueMult, 0,
  )

  const workplaceCosts = player.ownedBuildings
    .filter(b => ALL_BUILDING_CARDS[b.name]?.isWorkplace)
    .map(b => ALL_BUILDING_CARDS[b.name]?.cost ?? 0)
    .sort((a, b) => b - a)

  if (wc >= 3 && workplaceCosts.length >= 1) score += workplaceCosts[0] * w.workplace1CostMult
  if (wc >= 4 && workplaceCosts.length >= 2) score += workplaceCosts[1] * w.workplace2CostMult
  if (wc >= 5 && workplaceCosts.length >= 3) score += workplaceCosts[2] * w.workplace3CostMult

  score += player.money * w.moneyMult
  score -= player.unpaidWages * w.unpaidWagesPenalty
  score += player.victoryPoints * w.vpCardValue

  const drawBuildingCostSum = player.ownedBuildings.reduce((s, b) => {
    const ef = ALL_BUILDING_CARDS[b.name]?.effect
    if (!ef) return s
    if (DRAW_BUILDING_EFFECT_KINDS.has(ef.kind)) return s + (ALL_BUILDING_CARDS[b.name]?.cost ?? 0)
    if (ef.kind === 'draw-gain-vp' && ef.drawType === 'building') return s + (ALL_BUILDING_CARDS[b.name]?.cost ?? 0)
    return s
  }, 0)
  score += drawBuildingCostSum * w.drawBuildingCostMult

  // カテゴリボーナス: カテゴリ内の所有建物の最大コスト × ボーナス
  for (const cat of SCORE_CATEGORIES) {
    let maxCost = 0
    for (const b of player.ownedBuildings) {
      if (ALL_BUILDING_CARDS[b.name]?.beamCategory === cat) {
        maxCost = Math.max(maxCost, ALL_BUILDING_CARDS[b.name]?.cost ?? 0)
      }
    }
    if (maxCost > 0) {
      const bonus = cat === 'builder' ? w.builderBonus
        : cat === 'draw-building' ? w.drawBuildingBonus
        : cat === 'draw-consumption' ? w.drawConsumptionBonus
        : w.incomeBonus
      score += maxCost * bonus
    }
  }

  return score
}

// startRound に対する終端評価（R9以降または game-over は実スコア、それ以外は中間評価）
export function evaluateSimEnd(state: GameState, beamPlayerId: number, startRound: number): number {
  if (startRound >= 9 || state.phase === 'game-over') {
    return calculateScores(state).find(sc => sc.playerId === beamPlayerId)?.total ?? 0
  }
  return scoreIntermediateBeam(state, beamPlayerId, startRound)
}
