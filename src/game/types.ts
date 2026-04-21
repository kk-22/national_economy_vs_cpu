export type Tag = 'farm' | 'factory'

export interface BuildingCardDef {
  name: string
  cost: number        // cards to discard when building
  assetValue: number  // VP and sell value
  tags: Tag[]
  canSell: boolean    // false = 錠前アイコン (facility, no worker placement)
  isWorkplace: boolean
  effect: GameEffect
  count: number
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
  | { kind: 'discard-all-gain'; n: number }
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
}

export interface PublicWorkplace {
  id: string
  name: string
  effect: GameEffect
  allowMultiple: boolean
  workerIds: string[]
}

export interface Player {
  id: number
  name: string
  isCpu: boolean
  money: number
  hand: HandCard[]
  ownedBuildings: OwnedBuilding[]
  workers: Worker[]
  unpaidWages: number
}

export type PendingAction =
  | { kind: 'choose-build-target'; playerId: number; discount: number; drawAfter: number }
  | { kind: 'choose-build-payment'; playerId: number; targetId: string; targetName: string; cost: number; drawAfter: number; discount: number }
  | { kind: 'choose-discard'; playerId: number; count: number; gainAmount: number; selected: string[]; drawCount?: number }
  | { kind: 'choose-from-revealed'; playerId: number; revealed: HandCard[] }
  | { kind: 'choose-farm-build'; playerId: number }
  | { kind: 'choose-double-first'; playerId: number }
  | { kind: 'choose-double-second'; playerId: number; firstCost: number; firstId: string }
  | { kind: 'choose-double-payment'; playerId: number; firstId: string; secondId: string; cost: number; firstCost: number }

export type GamePhase = 'placement' | 'game-over'

export interface GameState {
  round: number
  currentPlayerIndex: number
  startPlayerIndex: number
  players: Player[]
  publicWorkplaces: PublicWorkplace[]
  buildingDeck: BuildingCard[]
  discardPile: BuildingCard[]
  supply: number
  phase: GamePhase
  pendingAction: PendingAction | null
  log: string[]
  _nextId: number
}

export interface GameConfig {
  humanName: string
  cpuCount: number
}

export interface ScoreResult {
  playerId: number
  buildingValue: number
  money: number
  unpaidPenalty: number
  bonuses: number
  total: number
}
