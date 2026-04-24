import type { BuildingCardDef } from './types'

export const BUILDING_CARDS: Record<string, BuildingCardDef> = {
  '農場':     { name: '農場',     cost: 1, assetValue: 6,  tags: ['farm'],    canSell: true,  isWorkplace: true,  count: 8, effect: { kind: 'draw-consumption', n: 2 } },
  '焼畑':     { name: '焼畑',     cost: 1, assetValue: 0,  tags: ['farm'],    canSell: false, isWorkplace: true,  count: 2, effect: { kind: 'slash-burn' } },
  '珈琲店':   { name: '珈琲店',   cost: 1, assetValue: 8,  tags: [],          canSell: true,  isWorkplace: true,  count: 2, effect: { kind: 'gain-supply', n: 5 } },
  '設計事務所':{ name: '設計事務所', cost: 1, assetValue: 8, tags: [],        canSell: true,  isWorkplace: true,  count: 4, effect: { kind: 'reveal-pick', n: 5 } },
  '工場':     { name: '工場',     cost: 2, assetValue: 12, tags: ['factory'], canSell: true,  isWorkplace: true,  count: 8, effect: { kind: 'discard-draw', discard: 2, draw: 4 } },
  '建設会社': { name: '建設会社', cost: 2, assetValue: 10, tags: [],          canSell: true,  isWorkplace: true,  count: 4, effect: { kind: 'build', discount: 1, drawAfter: 0 } },
  '倉庫':     { name: '倉庫',     cost: 2, assetValue: 10, tags: [],          canSell: false, isWorkplace: false, count: 3, effect: { kind: 'p-hand-limit', n: 4 } },
  '法律事務所':{ name: '法律事務所', cost: 2, assetValue: 8, tags: [],        canSell: false, isWorkplace: false, count: 1, effect: { kind: 'p-forgive-wages', max: 5 } },
  '果樹園':   { name: '果樹園',   cost: 2, assetValue: 10, tags: ['farm'],    canSell: true,  isWorkplace: true,  count: 3, effect: { kind: 'draw-consumption-to', target: 4 } },
  '社宅':     { name: '社宅',     cost: 2, assetValue: 8,  tags: [],          canSell: false, isWorkplace: false, count: 2, effect: { kind: 'p-worker-limit', n: 1 } },
  '不動産屋': { name: '不動産屋', cost: 3, assetValue: 10, tags: [],          canSell: false, isWorkplace: false, count: 2, effect: { kind: 'p-per-building', pts: 3 } },
  '開拓民':   { name: '開拓民',   cost: 3, assetValue: 14, tags: [],          canSell: true,  isWorkplace: true,  count: 2, effect: { kind: 'build-farm-free' } },
  'レストラン':{ name: 'レストラン', cost: 3, assetValue: 16, tags: [],       canSell: true,  isWorkplace: true,  count: 2, effect: { kind: 'discard-gain', discard: 1, gain: 15 } },
  '大農園':   { name: '大農園',   cost: 3, assetValue: 12, tags: ['farm'],    canSell: true,  isWorkplace: true,  count: 3, effect: { kind: 'draw-consumption', n: 3 } },
  '農協':     { name: '農協',     cost: 3, assetValue: 12, tags: [],          canSell: false, isWorkplace: false, count: 1, effect: { kind: 'p-per-consumption', pts: 3 } },
  'ゼネコン': { name: 'ゼネコン', cost: 4, assetValue: 18, tags: [],          canSell: true,  isWorkplace: true,  count: 3, effect: { kind: 'build', discount: 0, drawAfter: 2 } },
  '製鉄所':   { name: '製鉄所',   cost: 4, assetValue: 20, tags: ['factory'], canSell: true,  isWorkplace: true,  count: 3, effect: { kind: 'draw', n: 3 } },
  '邸宅':     { name: '邸宅',     cost: 4, assetValue: 28, tags: [],          canSell: false, isWorkplace: false, count: 1, effect: { kind: 'none' } },
  '化学工場': { name: '化学工場', cost: 4, assetValue: 18, tags: ['factory'], canSell: true,  isWorkplace: true,  count: 2, effect: { kind: 'draw-if-empty', normal: 2, empty: 4 } },
  '労働組合': { name: '労働組合', cost: 4, assetValue: 0,  tags: [],          canSell: false, isWorkplace: false, count: 1, effect: { kind: 'p-per-worker', pts: 6 } },
  '自動車工場':{ name: '自動車工場', cost: 5, assetValue: 24, tags: ['factory'], canSell: true, isWorkplace: true, count: 3, effect: { kind: 'discard-draw', discard: 3, draw: 7 } },
  '本社ビル': { name: '本社ビル', cost: 5, assetValue: 20, tags: [],          canSell: false, isWorkplace: false, count: 1, effect: { kind: 'p-per-no-sell', pts: 6 } },
  '二胡市建設':{ name: '二胡市建設', cost: 5, assetValue: 20, tags: [],       canSell: true,  isWorkplace: true,  count: 2, effect: { kind: 'build-double' } },
  '鉄道':     { name: '鉄道',     cost: 5, assetValue: 18, tags: [],          canSell: false, isWorkplace: false, count: 1, effect: { kind: 'p-per-factory', pts: 8 } },
}

export interface RoundCard {
  wage: number
  workplaces: {
    name: string
    effect: import('./types').GameEffect
    allowMultiple: boolean
    count: (playerCount: number) => number
  }[]
}

export const ROUND_CARDS: RoundCard[] = [
  {
    wage: 2,
    workplaces: [
      { name: '採石場',   effect: { kind: 'draw-become-start' },               allowMultiple: false, count: () => 1 },
      { name: '鉱山',     effect: { kind: 'draw', n: 1 },                       allowMultiple: true,  count: () => 1 },
      { name: '学校',     effect: { kind: 'add-worker', immediate: false },      allowMultiple: false, count: () => 1 },
      { name: '大工',     effect: { kind: 'build', discount: 0, drawAfter: 0 }, allowMultiple: false, count: (n) => n - 1 },
    ],
  },
  {
    wage: 2,
    workplaces: [{ name: '露店', effect: { kind: 'discard-gain', discard: 1, gain: 6 }, allowMultiple: false, count: () => 1 }],
  },
  {
    wage: 3,
    workplaces: [{ name: '市場', effect: { kind: 'discard-gain', discard: 2, gain: 12 }, allowMultiple: false, count: () => 1 }],
  },
  {
    wage: 3,
    workplaces: [{ name: '高等学校', effect: { kind: 'fill-workers', target: 4 }, allowMultiple: false, count: () => 1 }],
  },
  {
    wage: 3,
    workplaces: [{ name: 'スーパーマーケット', effect: { kind: 'discard-gain', discard: 3, gain: 18 }, allowMultiple: false, count: () => 1 }],
  },
  {
    wage: 4,
    workplaces: [{ name: '大学', effect: { kind: 'fill-workers', target: 5 }, allowMultiple: false, count: () => 1 }],
  },
  {
    wage: 4,
    workplaces: [{ name: '百貨店', effect: { kind: 'discard-gain', discard: 4, gain: 24 }, allowMultiple: false, count: () => 1 }],
  },
  {
    wage: 5,
    workplaces: [{ name: '専門学校', effect: { kind: 'add-worker', immediate: true }, allowMultiple: false, count: () => 1 }],
  },
  {
    wage: 5,
    workplaces: [{ name: '万博', effect: { kind: 'discard-gain', discard: 5, gain: 30 }, allowMultiple: false, count: () => 1 }],
  },
]

export const MAX_WORKERS_PER_PLAYER = 5
