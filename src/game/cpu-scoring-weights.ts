// GA 用スコア重みパラメータ・定数・ストア関数

// ---- greedy アクション選択用 ----

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
  drawBecomeStart:        14.0,
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

// ---- ビームサーチ中間評価用 ----
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
  workers3Bonus_early:        0,
  workers3Bonus_late:         1000,
  workers4Bonus_early:        0,
  workers4Bonus_late:         54,
  workers5Bonus_early:        0,
  workers5Bonus_late:         0,
  buildingCardValue_early:    16,
  buildingCardValue_late:     29,
  consumptionCardValue_early: 20,
  consumptionCardValue_late:  6,
  startPlayerBonus_early:     31,
  startPlayerBonus_late:      38,
  assetValueMult_early:       0,
  assetValueMult_late:        15,
  workplace1CostMult_early:   47,
  workplace1CostMult_late:    24,
  workplace2CostMult_early:   13,
  workplace2CostMult_late:    11,
  workplace3CostMult_early:   7,
  workplace3CostMult_late:    9,
  moneyMult_early:            3,
  moneyMult_late:             10,
  unpaidWagesPenalty_early:   19,
  unpaidWagesPenalty_late:    15,
  vpCardValue_early:          18,
  vpCardValue_late:           15,
  drawBuildingCostMult_early: 0,
  drawBuildingCostMult_late:  12,
  builderBonus_early:         0,
  builderBonus_late:          20,
  drawBuildingBonus_early:    6,
  drawBuildingBonus_late:     12,
  drawConsumptionBonus_early: 15,
  drawConsumptionBonus_late:  3,
  incomeBonus_early:          16,
  incomeBonus_late:           10,
}

export const BEAM_EVAL_WEIGHT_BOUNDS: Record<keyof BeamEvalWeights, [number, number]> = {
  workers3Bonus_early:        [0, 1000],
  workers3Bonus_late:         [0, 1000],
  workers4Bonus_early:        [0, 200],
  workers4Bonus_late:         [0, 200],
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
