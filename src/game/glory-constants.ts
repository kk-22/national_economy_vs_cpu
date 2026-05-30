import type { BuildingCardDef } from './types'

export const GLORY_BUILDING_CARDS: Record<string, BuildingCardDef> = {
  // cost: 0
  '遺物':           { name: '遺物',           cost: 0, assetValue: 4,  tags: [],              canSell: false, isWorkplace: false, count: 3, effect: { kind: 'on-build-gain-vp', n: 2 } },
  // cost: 1
  '農村':           { name: '農村',           cost: 1, assetValue: 6,  tags: ['agriculture'], canSell: true,  isWorkplace: true,  count: 6, effect: { kind: 'draw-consumption-or-discard-draw', n: 2 },                                                                    beamCategory: 'draw-consumption' },
  '植民団':         { name: '植民団',         cost: 1, assetValue: 6,  tags: [],              canSell: true,  isWorkplace: true,  count: 5, effect: { kind: 'build-then-draw-consumption', discount: 0, consumption: 1 },                                                  beamCategory: 'builder' },
  '工房':           { name: '工房',           cost: 1, assetValue: 8,  tags: ['industry'],    canSell: true,  isWorkplace: true,  count: 5, effect: { kind: 'draw-gain-vp', n: 1, drawType: 'building' },                                                                  beamCategory: 'draw-building' },
  // cost: 2
  '蒸気工場':       { name: '蒸気工場',       cost: 2, assetValue: 10,  tags: ['industry'],    canSell: true,  isWorkplace: true,  count: 8, effect: { kind: 'discard-draw', discard: 2, draw: 4 },    constructionDiscount: { condition: 'own-vp-min', minVp: 2, discount: 1 }, beamCategory: 'draw-building' },
  '養鶏場':         { name: '養鶏場',         cost: 2, assetValue: 12,  tags: ['agriculture'], canSell: true,  isWorkplace: true,  count: 4, effect: { kind: 'draw-consumption-odd-even', even: 2, odd: 3 },                                                               beamCategory: 'draw-consumption' },
  '摩天建設':       { name: '摩天建設',       cost: 2, assetValue: 10,  tags: [],              canSell: true,  isWorkplace: true,  count: 3, effect: { kind: 'build-draw-if-empty', discount: 0, drawAfterEmpty: 2 },                                                       beamCategory: 'builder' },
  'ボードゲームカフェ': { name: 'ボードゲームカフェ', cost: 2, assetValue: 10, tags: [],        canSell: true,  isWorkplace: true,  count: 3, effect: { kind: 'gain-household-by-workers', withWorker: 5, withoutWorker: 10 },                                               beamCategory: 'income' },
  // cost: 3
  '綿花農場':       { name: '綿花農場',       cost: 3, assetValue: 14,  tags: ['agriculture'], canSell: true,  isWorkplace: true,  count: 3, requiresDoubleWorker: true,  effect: { kind: 'draw-consumption', n: 5 },                                                      beamCategory: 'draw-consumption' },
  '美術館':         { name: '美術館',         cost: 3, assetValue: 14,  tags: [],              canSell: true,  isWorkplace: true,  count: 2, effect: { kind: 'gain-household-if-hand', exactHand: 5, gain: 14, otherwise: 7 },                                              beamCategory: 'income' },
  '記念碑':         { name: '記念碑',         cost: 3, assetValue: 24,  tags: [],              canSell: false, isWorkplace: false, count: 2, effect: { kind: 'none' } },
  '消費者組合':     { name: '消費者組合',     cost: 3, assetValue: 18,  tags: [],              canSell: false, isWorkplace: false, count: 1, effect: { kind: 'p-if-tag-asset-min', tag: 'agriculture', minAsset: 20, bonus: 18 } },
  // cost: 4
  '機械人形':       { name: '機械人形',       cost: 4, assetValue: 2,  tags: [],              canSell: false, isWorkplace: false, count: 5, effect: { kind: 'on-build-gain-automaton' } },
  '炭鉱':           { name: '炭鉱',           cost: 4, assetValue: 20,  tags: ['industry'],    canSell: true,  isWorkplace: true,  count: 2, requiresDoubleWorker: true,  effect: { kind: 'draw', n: 5 },                                                                   beamCategory: 'draw-building' },
  'モダニズム建設': { name: 'モダニズム建設', cost: 4, assetValue: 18,  tags: [],              canSell: true,  isWorkplace: true,  count: 2, effect: { kind: 'build-consumption-double' },                                                                                  beamCategory: 'builder' },
  '劇場':           { name: '劇場',           cost: 4, assetValue: 20,  tags: [],              canSell: true,  isWorkplace: true,  count: 2, effect: { kind: 'draw-gain-household', n: 2, gain: 20 },                                                                       beamCategory: 'income' },
  'ギルドホール':   { name: 'ギルドホール',   cost: 4, assetValue: 20,  tags: [],              canSell: false, isWorkplace: false, count: 1, effect: { kind: 'p-if-has-both-tags', tag1: 'agriculture', tag2: 'industry', bonus: 20 } },
  '象牙の塔':       { name: '象牙の塔',       cost: 4, assetValue: 22,  tags: [],              canSell: false, isWorkplace: false, count: 1, effect: { kind: 'p-if-vp-min', minVp: 7, bonus: 22 } },
  // cost: 5
  '精錬所':         { name: '精錬所',         cost: 5, assetValue: 16,  tags: ['industry'],    canSell: true,  isWorkplace: true,  count: 3, constructionDiscount: { condition: 'own-vp-min', minVp: 3, discount: 2 }, effect: { kind: 'draw', n: 3 },                      beamCategory: 'draw-building' },
  '転送装置':       { name: '転送装置',       cost: 5, assetValue: 22,  tags: [],              canSell: true,  isWorkplace: true,  count: 2, requiresDoubleWorker: true,  effect: { kind: 'build-free-any' },                                                              beamCategory: 'builder' },
  '革命広場':       { name: '革命広場',       cost: 5, assetValue: 18,  tags: [],              canSell: false, isWorkplace: false, count: 1, effect: { kind: 'p-if-workers-min', minWorkers: 5, bonus: 18 } },
  '収穫祭':         { name: '収穫祭',         cost: 5, assetValue: 26,  tags: [],              canSell: false, isWorkplace: false, count: 1, effect: { kind: 'p-if-consumption-in-hand-min', minCount: 4, bonus: 26 } },
  '技術展示会':     { name: '技術展示会',     cost: 5, assetValue: 24,  tags: [],              canSell: false, isWorkplace: false, count: 1, effect: { kind: 'p-if-tag-asset-min', tag: 'industry', minAsset: 30, bonus: 24 } },
  // cost: 6
  '温室':           { name: '温室',           cost: 6, assetValue: 18,  tags: [],              canSell: true,  isWorkplace: true,  count: 2, constructionDiscount: { condition: 'own-vp-min', minVp: 4, discount: 2 }, effect: { kind: 'draw-consumption', n: 4 },           beamCategory: 'draw-consumption' },
  '神殿':           { name: '神殿',           cost: 6, assetValue: 30,  tags: [],              canSell: false, isWorkplace: false, count: 1, effect: { kind: 'p-if-only-no-sell', bonus: 30 } },
  // cost: 7
  '機関車工場':     { name: '機関車工場',     cost: 7, assetValue: 24,  tags: ['industry'],    canSell: true,  isWorkplace: true,  count: 2, constructionDiscount: { condition: 'own-vp-min', minVp: 5, discount: 3 }, effect: { kind: 'discard-draw', discard: 3, draw: 7 }, beamCategory: 'draw-building' },
}
