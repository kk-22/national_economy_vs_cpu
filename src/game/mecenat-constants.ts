import type { BuildingCardDef } from './types'

// ※ cost/assetValue が「推」のカードは実装時にPDFと照合して確定すること
// ※ tags: 農業アイコン='farm', 工業アイコン='factory' のみ。施設（錠前）はcanSell:falseで判定
export const MECENAT_BUILDING_CARDS: Record<string, BuildingCardDef> = {
  '手畑':           { name: '手畑',           cost: 1,  assetValue: 6,  tags: ['farm'],            canSell: true,  isWorkplace: true,  count: 6, effect: { kind: 'draw-consumption-by-hand' } },
  '食堂':           { name: '食堂',           cost: 1,  assetValue: 8,  tags: ['farm'],            canSell: true,  isWorkplace: true,  count: 2, effect: { kind: 'discard-gain-household', discard: 1, gain: 8, minHousehold: 8 } },
  '菜園':           { name: '菜園',           cost: 2,  assetValue: 10, tags: ['farm'],            canSell: true,  isWorkplace: true,  count: 4, effect: { kind: 'draw-gain-vp', n: 2, drawType: 'consumption' } },
  '鉄工所':         { name: '鉄工所',         cost: 1,  assetValue: 8,  tags: ['factory'],         canSell: true,  isWorkplace: true,  count: 3, effect: { kind: 'draw-if-mine', n: 2 } },
  '建築会社':       { name: '建築会社',       cost: 2,  assetValue: 10, tags: [],                  canSell: true,  isWorkplace: true,  count: 2, effect: { kind: 'build-no-sell', drawAfter: 2 } },
  '養殖場':         { name: '養殖場',         cost: 2,  assetValue: 12, tags: ['farm'],            canSell: true,  isWorkplace: true,  count: 6, effect: { kind: 'draw-consumption-if-have', withConsumption: 3, without: 2 } },
  '醸造所':         { name: '醸造所',         cost: 4,  assetValue: 18, tags: ['farm'],            canSell: true,  isWorkplace: true,  count: 2, effect: { kind: 'draw-consumption-hold', n: 4 } },
  '宝くじ':         { name: '宝くじ',         cost: 2,  assetValue: 8,  tags: [],                  canSell: true,  isWorkplace: true,  count: 2, effect: { kind: 'gain-household', net: 10, take: 20, minHousehold: 20 } },
  '宮大工':         { name: '宮大工',         cost: 1,  assetValue: 10, tags: [],                  canSell: true,  isWorkplace: true,  count: 5, effect: { kind: 'build-gain-vp', discount: 0, drawAfter: 0 } },
  '研究所':         { name: '研究所',         cost: 3,  assetValue: 16, tags: [],                  canSell: true,  isWorkplace: true,  count: 2, effect: { kind: 'draw-gain-vp', n: 2, drawType: 'building' } },
  '食品工場':       { name: '食品工場',       cost: 2,  assetValue: 12, tags: ['factory'],         canSell: true,  isWorkplace: true,  count: 8, effect: { kind: 'discard-draw', discard: 2, draw: 4 }, constructionDiscount: { condition: 'own-tag', tag: 'farm', discount: 1 } },
  '観光牧場':       { name: '観光牧場',       cost: 3,  assetValue: 14, tags: ['farm'],            canSell: true,  isWorkplace: true,  count: 2, effect: { kind: 'gain-per-consumption', perCard: 4 } },
  '工業団地':       { name: '工業団地',       cost: 4,  assetValue: 16, tags: ['factory'],         canSell: true,  isWorkplace: true,  count: 2, effect: { kind: 'draw-with-build-discount', n: 3, discountTag: 'factory' } },
  '墓地':           { name: '墓地',           cost: 1,  assetValue: 8,  tags: [],                  canSell: false, isWorkplace: false, count: 2, effect: { kind: 'p-if-empty-hand', bonus: 8 } },
  // 旧市街: farm+factoryアイコン付き かつ canSell:false → farm/factory条件・施設数条件すべてでカウントされる
  '旧市街':         { name: '旧市街',         cost: 2,  assetValue: 10, tags: ['farm', 'factory'], canSell: false, isWorkplace: false, count: 3, effect: { kind: 'none' } },
  'プレハブ工務店': { name: 'プレハブ工務店', cost: 3,  assetValue: 12, tags: [],                  canSell: true,  isWorkplace: true,  count: 2, effect: { kind: 'build-free-if-cheap', maxCost: 10 } },
  '造船所':         { name: '造船所',         cost: 4,  assetValue: 20, tags: [],                  canSell: true,  isWorkplace: true,  count: 3, effect: { kind: 'discard-draw-min-hand', discard: 3, draw: 6, minHand: 3 } },
  '地球建設':       { name: '地球建設',       cost: 4,  assetValue: 16, tags: [],                  canSell: true,  isWorkplace: true,  count: 3, effect: { kind: 'build-two' } },
  '遊園地':         { name: '遊園地',         cost: 5,  assetValue: 24, tags: [],                  canSell: true,  isWorkplace: true,  count: 2, effect: { kind: 'discard-gain-household-min', discard: 2, gain: 25, minHousehold: 25 } },
  '石油コンビナート': { name: '石油コンビナート', cost: 6, assetValue: 28, tags: ['factory'],     canSell: true,  isWorkplace: true,  count: 2, effect: { kind: 'draw', n: 4 } },
  '博物館':         { name: '博物館',         cost: 5,  assetValue: 34, tags: [],                  canSell: false, isWorkplace: false, count: 1, effect: { kind: 'none' } },
  '会計事務所':     { name: '会計事務所',     cost: 3,  assetValue: 12, tags: [],                  canSell: false, isWorkplace: false, count: 1, effect: { kind: 'p-vp-double' } },
  '鉄道駅':         { name: '鉄道駅',         cost: 3,  assetValue: 18, tags: [],                  canSell: false, isWorkplace: false, count: 2, effect: { kind: 'p-if-own-n-buildings', threshold: 6, bonus: 18 } },
  '植物園':         { name: '植物園',         cost: 4,  assetValue: 22, tags: [],                  canSell: false, isWorkplace: false, count: 1, effect: { kind: 'p-if-tag-n', tag: 'farm', threshold: 3, bonus: 22 } },
  // 輸出港・投資銀行: 施設（canSell:false）の所有数で判定
  '輸出港':         { name: '輸出港',         cost: 5,  assetValue: 24, tags: [],                  canSell: false, isWorkplace: false, count: 1, effect: { kind: 'p-if-no-sell-n', threshold: 2, bonus: 24 } },
  '投資銀行':       { name: '投資銀行',       cost: 6,  assetValue: 30, tags: [],                  canSell: false, isWorkplace: false, count: 1, effect: { kind: 'p-if-no-sell-n', threshold: 4, bonus: 30 } },
  // 大聖堂: 勝利点5枚以上でコスト-4（建設時判定）。effectはnone（isWorkplace:falseなのでworker配置なし）
  '大聖堂':         { name: '大聖堂',         cost: 10, assetValue: 50, tags: [],                  canSell: false, isWorkplace: false, count: 3, effect: { kind: 'none' }, constructionDiscount: { condition: 'own-vp-min', minVp: 5, discount: 4 } },
}
