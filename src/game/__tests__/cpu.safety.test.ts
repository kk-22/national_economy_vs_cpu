import { describe, test, expect, beforeEach } from 'vitest'
import { cpuBuild, cpuDiscardDraw, cpuDiscardGain } from '../cpu'
import {
  resetIds,
  makePlayer,
  makeState,
  makeBuildingCard,
  makeConsumptionCard,
} from './helpers'

beforeEach(() => { resetIds() })

// ============================================================
// cpuBuild: 手札・コスト不足のとき建設しない
// ============================================================

describe('cpuBuild: 手札不足では建設しない', () => {
  test('手札0枚 → ownedBuildings に変化なし', () => {
    const player = makePlayer({ hand: [] })
    const state = makeState([player])

    const result = cpuBuild(state, player.id, 0, 0, 'greedy')

    expect(result.players[0].ownedBuildings).toHaveLength(0)
  })

  test('手札1枚（農場 cost=1）→ 支払いカードが0枚で建設不可', () => {
    // 農場 cost=1: hand.length-1=0 >= 1 を満たさないため buildable=[]
    const player = makePlayer({ hand: [makeBuildingCard('農場')] })
    const state = makeState([player])

    const result = cpuBuild(state, player.id, 0, 0, 'greedy')

    expect(result.players[0].ownedBuildings).toHaveLength(0)
  })

  test('手札2枚（工場 cost=2 + 消費財1枚）→ 支払いカードが1枚しかなく建設不可', () => {
    // 工場 cost=2: hand.length-1=1 >= 2 を満たさない
    const player = makePlayer({
      hand: [makeBuildingCard('工場'), makeConsumptionCard()],
    })
    const state = makeState([player])

    const result = cpuBuild(state, player.id, 0, 0, 'greedy')

    expect(result.players[0].ownedBuildings).toHaveLength(0)
  })

  test('手札が足りていれば建設が成立する（正常動作の確認）', () => {
    // 農場 cost=1: hand.length-1=1 >= 1 → 建設可能
    const player = makePlayer({
      hand: [makeBuildingCard('農場'), makeConsumptionCard()],
    })
    const state = makeState([player])

    const result = cpuBuild(state, player.id, 0, 0, 'greedy')

    expect(result.players[0].ownedBuildings).toHaveLength(1)
    expect(result.players[0].ownedBuildings[0].name).toBe('農場')
    // 建設に使った手札が減っている（農場本体+支払い1枚=2枚消費）
    expect(result.players[0].hand).toHaveLength(0)
  })

  test('discount あり: 手札2枚（工場 cost=2, discount=1）→ 実効コスト1で建設可能', () => {
    // discountedCost = max(0, 2-1) = 1: hand.length-1=1 >= 1 → 建設可能
    const player = makePlayer({
      hand: [makeBuildingCard('工場'), makeConsumptionCard()],
    })
    const state = makeState([player])

    const result = cpuBuild(state, player.id, 1, 0, 'greedy')

    expect(result.players[0].ownedBuildings).toHaveLength(1)
    expect(result.players[0].ownedBuildings[0].name).toBe('工場')
  })
})

// ============================================================
// cpuDiscardDraw: 手札不足でもクラッシュしない
// ============================================================

describe('cpuDiscardDraw: 手札不足でクラッシュしない', () => {
  test('手札0枚・discard=2 要求 → クラッシュせず捨て0枚・引き枚数ぶん手に入る', () => {
    const player = makePlayer({ hand: [] })
    const state = makeState([player], {
      buildingDeck: [
        { id: 'dk1', name: '農場' }, { id: 'dk2', name: '工場' },
        { id: 'dk3', name: '農場' }, { id: 'dk4', name: '工場' },
      ],
    })

    // discard=2 だが手札0枚 → 捨て0枚で4枚引く
    expect(() => cpuDiscardDraw(state, player.id, 2, 4, 'greedy')).not.toThrow()
    const result = cpuDiscardDraw(state, player.id, 2, 4, 'greedy')
    expect(result.players[0].hand).toHaveLength(4)
  })

  test('手札1枚・discard=2 要求 → 1枚だけ捨てて4枚引く', () => {
    const player = makePlayer({ hand: [makeBuildingCard('農場')] })
    const state = makeState([player], {
      buildingDeck: [
        { id: 'dk1', name: '工場' }, { id: 'dk2', name: '工場' },
        { id: 'dk3', name: '工場' }, { id: 'dk4', name: '工場' },
      ],
    })

    expect(() => cpuDiscardDraw(state, player.id, 2, 4, 'greedy')).not.toThrow()
    const result = cpuDiscardDraw(state, player.id, 2, 4, 'greedy')
    // 手札1枚を捨てて4枚引く → 手札4枚
    expect(result.players[0].hand).toHaveLength(4)
  })
})

// ============================================================
// cpuDiscardGain: 手札不足でもクラッシュしない
// ============================================================

describe('cpuDiscardGain: 手札不足でクラッシュしない', () => {
  test('手札0枚・discard=1 要求 → クラッシュしない', () => {
    const player = makePlayer({ hand: [] })
    const state = makeState([player], { household: 20 })

    expect(() => cpuDiscardGain(state, player.id, 1, 6, 'greedy')).not.toThrow()
  })

  test('手札0枚・discard=1 → 捨て0枚でも gain 分だけ加算される（household から移動）', () => {
    const player = makePlayer({ hand: [] })
    const state = makeState([player], { household: 20 })

    const result = cpuDiscardGain(state, player.id, 1, 6, 'greedy')

    // 捨て0枚でも household → player.money への移動は実行される
    expect(result.household).toBe(14)
    expect(result.players[0].money).toBe(26)
  })
})
