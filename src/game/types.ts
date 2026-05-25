export type Tag = 'farm' | 'factory'

// 建物の建設コストに対する条件付き割引
export type ConditionalDiscount =
  | { condition: 'own-tag'; tag: Tag; discount: number }       // 指定タグの建物を所有していればコスト割引
  | { condition: 'own-vp-min'; minVp: number; discount: number } // 勝利点カードがminVp枚以上あればコスト割引

export type CpuStrategy = 'random' | 'greedy' | 'beam' | 'mcts' | 'disruptive'

export interface BuildingCardDef {
  name: string
  cost: number        // cards to discard when building
  assetValue: number  // VP and sell value
  tags: Tag[]
  canSell: boolean    // false = 錠前アイコン (facility, no worker placement)
  isWorkplace: boolean
  effect: GameEffect
  count: number
  constructionDiscount?: ConditionalDiscount  // 建設時の条件付きコスト割引
}

export type GameEffect =
  | { kind: 'none' }
  | { kind: 'draw'; n: number }
  | { kind: 'draw-become-start' }
  | { kind: 'draw-consumption'; n: number }
  | { kind: 'slash-burn' }
  | { kind: 'gain-supply'; n: number }
  | { kind: 'reveal-pick'; n: number }
  | { kind: 'discard-draw'; discard: number; draw: number }
  | { kind: 'build'; discount: number; drawAfter: number }
  | { kind: 'draw-consumption-to'; target: number }
  | { kind: 'build-farm-free' }
  | { kind: 'draw-if-empty'; normal: number; empty: number }
  | { kind: 'discard-gain'; discard: number; gain: number }
  | { kind: 'add-worker'; immediate: boolean }
  | { kind: 'fill-workers'; target: number }
  | { kind: 'build-double' }
  | { kind: 'p-hand-limit'; n: number }
  | { kind: 'p-worker-limit'; n: number }
  | { kind: 'p-forgive-wages'; max: number }
  | { kind: 'p-per-building'; pts: number }
  | { kind: 'p-per-consumption'; pts: number }
  | { kind: 'p-per-worker'; pts: number }
  | { kind: 'p-per-no-sell'; pts: number }
  | { kind: 'p-per-factory'; pts: number }
  // --- メセナ専用 ---
  | { kind: 'draw-consumption-by-hand' }
  | { kind: 'discard-gain-household'; discard: number; gain: number; minHousehold: number }
  | { kind: 'draw-if-mine'; n: number }
  | { kind: 'build-gain-vp'; discount: number; drawAfter: number }
  | { kind: 'draw-gain-vp'; n: number; drawType: 'building' | 'consumption' }
  | { kind: 'draw-consumption-if-have'; withConsumption: number; without: number }
  | { kind: 'gain-per-consumption'; perCard: number }
  | { kind: 'gain-household'; net: number; take: number; minHousehold: number }
  | { kind: 'build-free-if-cheap'; maxCost: number }
  | { kind: 'build-two' }
  | { kind: 'draw-consumption-hold'; n: number }
  | { kind: 'discard-draw-min-hand'; discard: number; draw: number; minHand: number }
  | { kind: 'draw-with-build-discount'; n: number; discountTag: Tag }
  | { kind: 'discard-gain-household-min'; discard: number; gain: number; minHousehold: number }
  | { kind: 'p-if-empty-hand'; bonus: number }
  | { kind: 'p-vp-double' }
  | { kind: 'p-if-own-n-buildings'; threshold: number; bonus: number }
  | { kind: 'p-if-tag-n'; tag: Tag; threshold: number; bonus: number }
  | { kind: 'p-if-no-sell-n'; threshold: number; bonus: number }
  | { kind: 'p-vp-build-discount'; vpThreshold: number; discount: number }
  | { kind: 'build-no-sell'; drawAfter: number }

export interface BuildingCard {
  id: string
  name: string
}

export interface ConsumptionCard {
  id: string
}

export type HandCard =
  | (BuildingCard & { kind: 'building' })
  | (ConsumptionCard & { kind: 'consumption' })

export interface Worker {
  id: string
  playerId: number
  isTraining: boolean
  placedAt: string | null
}

export interface OwnedBuilding {
  id: string
  name: string
  workerHereId: string | null
  storedConsumption?: number  // 醸造所が保持する消費財枚数
}

export interface PublicWorkplace {
  id: string
  kind: 'round' | 'sold'
  name: string
  effect: GameEffect
  allowMultiple: boolean
  workerIds: string[]
}

export interface Player {
  id: number
  name: string
  isCpu: boolean
  cpuStrategy: CpuStrategy
  money: number
  hand: HandCard[]
  ownedBuildings: OwnedBuilding[]
  workers: Worker[]
  unpaidWages: number
  victoryPoints: number  // 勝利点カード枚数（プログレスでは常に0）
}

export type PendingAction =
  | { kind: 'choose-build-target'; playerId: number; discount: number; drawAfter: number; sourceName?: string; sourceId?: string }
  | { kind: 'choose-build-payment'; playerId: number; targetId: string; targetName: string; cost: number; drawAfter: number; discount: number; sourceName?: string; sourceId?: string }
  | { kind: 'choose-discard'; playerId: number; count: number; gainAmount: number; selected: string[]; drawCount?: number; sourceName?: string; sourceId?: string }
  | { kind: 'choose-from-revealed'; playerId: number; revealed: HandCard[]; sourceName?: string; sourceId?: string }
  | { kind: 'choose-farm-build'; playerId: number; sourceName?: string; sourceId?: string }
  | { kind: 'choose-double-first'; playerId: number; sourceName?: string; sourceId?: string }
  | { kind: 'choose-double-second'; playerId: number; firstCost: number; firstId: string; sourceName?: string; sourceId?: string }
  | { kind: 'choose-double-payment'; playerId: number; firstId: string; secondId: string; cost: number; firstCost: number; sourceName?: string; sourceId?: string }
  | { kind: 'choose-hand-limit'; playerId: number; limit: number; count: number; selected: string[]; noCpu: boolean; sourceName?: string }
  | { kind: 'choose-sell-buildings'; playerId: number; deficit: number; sellableIds: string[]; selected: string[]; noCpu: boolean; sourceName?: string }
  // --- メセナ専用 ---
  | { kind: 'choose-build-two-first'; playerId: number; sourceName?: string; sourceId?: string }
  | { kind: 'choose-build-two-second'; playerId: number; firstId: string; firstCost: number; sourceName?: string; sourceId?: string }
  | { kind: 'choose-build-two-payment'; playerId: number; firstId: string; secondId: string; totalCost: number; sourceName?: string; sourceId?: string }
  | { kind: 'choose-free-build'; playerId: number; maxCost: number; sourceName?: string; sourceId?: string }
  | { kind: 'choose-no-sell-build'; playerId: number; drawAfter: number; sourceName?: string; sourceId?: string }

export type GamePhase = 'placement' | 'game-over'

export type GameSeries = 'progress' | 'mecenat'

export interface GameState {
  round: number
  currentPlayerIndex: number
  startPlayerIndex: number
  players: Player[]
  publicWorkplaces: PublicWorkplace[]
  buildingDeck: BuildingCard[]
  discardPile: BuildingCard[]
  household: number
  phase: GamePhase
  series: GameSeries
  pendingAction: PendingAction | null
  log: string[]
  _nextId: number
  _rngSeed: number   // ゲーム開始時のシード（不変・保存用）
  _rngState: number  // 現在のRNG状態（スナップショットに含まれ再現可能）
  _pendingWageDeficit?: { playerId: number; deficit: number }  // 賃金不足の一時記録（手札上限処理後に建物売却へ）
  _pendingRoundEnd?: true  // Vue層がアニメーション後にラウンド終了処理を行うための一時フラグ
}

export interface GameConfig {
  humanName: string
  cpuCount: number
  cpuOnly?: boolean      // true = 全員CPU（プレイヤーなし）
  playerOrder?: number   // 0=ランダム, 1〜4=手番順（1番目が先手）
  cpuStrategies?: CpuStrategy[]  // CPU番号順（0=CPU1, 1=CPU2, ...）
  seed?: number          // 固定シード（GA用・省略時はランダム）
  series?: GameSeries    // シリーズ選択（省略時はprogress）
}

export interface ScoreResult {
  playerId: number
  money: number
  buildingValue: number
  bonuses: number
  unpaidPenalty: number
  workerCount: number
  actionsPlaced: number
  victoryPoints: number  // 勝利点カード枚数
  vpScore: number        // 勝利点カードによる得点（会計事務所2倍含む）
  total: number
}
