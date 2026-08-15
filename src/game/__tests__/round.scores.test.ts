/**
 * round.scores.test.ts
 * calculateScores の終了時ボーナス・未払い賃金ペナルティ・勝利点計算のテスト。
 */

import { describe, test, expect, beforeEach } from 'vitest'
import { calculateScores } from '../round'
import {
  resetIds,
  makePlayer,
  makeState,
  makeOwnedBuilding,
  makeConsumptionCard,
  makeWorker,
} from './helpers'

beforeEach(() => { resetIds() })

describe('calculateScores: 終了時ボーナス', () => {
  test('p-per-building（不動産屋）: 所有建物数×ptsが加算される', () => {
    const player = makePlayer({
      id: 0, money: 0,
      ownedBuildings: [makeOwnedBuilding('不動産屋')],
    })
    const state = makeState([player])

    const [score] = calculateScores(state)

    expect(score.bonuses).toBe(3) // pts3 × 建物1つ
    expect(score.buildingValue).toBe(10) // 不動産屋 assetValue
    expect(score.total).toBe(13)
  })

  test('p-per-consumption（農協）: 手札の消費財枚数×ptsが加算される', () => {
    const player = makePlayer({
      id: 0, money: 0,
      ownedBuildings: [makeOwnedBuilding('農協')],
      hand: [makeConsumptionCard(), makeConsumptionCard()],
    })
    const state = makeState([player])

    const [score] = calculateScores(state)

    expect(score.bonuses).toBe(6) // pts3 × 消費財2枚
  })

  test('p-per-worker（労働組合）: 労働者数×ptsが加算される', () => {
    const player = makePlayer({
      id: 0, money: 0,
      ownedBuildings: [makeOwnedBuilding('労働組合')],
      workers: [makeWorker(0), makeWorker(0), makeWorker(0)],
    })
    const state = makeState([player])

    const [score] = calculateScores(state)

    expect(score.bonuses).toBe(18) // pts6 × 労働者3人
  })

  test('p-per-factory（鉄道）: factoryタグ建物数×ptsが加算される', () => {
    const player = makePlayer({
      id: 0, money: 0,
      ownedBuildings: [makeOwnedBuilding('鉄道'), makeOwnedBuilding('製鉄所')],
    })
    const state = makeState([player])

    const [score] = calculateScores(state)

    expect(score.bonuses).toBe(8) // pts8 × factory建物1つ(製鉄所)
  })

  test('p-per-no-sell（本社ビル）: 売却不可建物数×ptsが加算される', () => {
    const player = makePlayer({
      id: 0, money: 0,
      ownedBuildings: [makeOwnedBuilding('本社ビル')],
    })
    const state = makeState([player])

    const [score] = calculateScores(state)

    expect(score.bonuses).toBe(6) // pts6 × 売却不可建物1つ(本社ビル自身)
  })
})

describe('calculateScores: 未払い賃金ペナルティ', () => {
  test('法律事務所なし: 未払い賃金×3がそのままペナルティになる', () => {
    const player = makePlayer({ id: 0, money: 0, unpaidWages: 4 })
    const state = makeState([player])

    const [score] = calculateScores(state)

    expect(score.unpaidPenalty).toBe(12)
  })

  test('法律事務所（免除上限5）あり: 免除分を差し引いた分だけペナルティになる', () => {
    const player = makePlayer({
      id: 0, money: 0,
      ownedBuildings: [makeOwnedBuilding('法律事務所')],
      unpaidWages: 8,
    })
    const state = makeState([player])

    const [score] = calculateScores(state)

    expect(score.unpaidPenalty).toBe(9) // (8-5)×3
  })

  test('法律事務所あり・未払いが免除上限以下: ペナルティ0', () => {
    const player = makePlayer({
      id: 0, money: 0,
      ownedBuildings: [makeOwnedBuilding('法律事務所')],
      unpaidWages: 3,
    })
    const state = makeState([player])

    const [score] = calculateScores(state)

    expect(score.unpaidPenalty).toBe(0)
  })
})

describe('calculateScores: 勝利点計算', () => {
  test('floor(n/3)*10 + (n%3)*1 の式で計算される', () => {
    const player = makePlayer({ id: 0, money: 0, victoryPoints: 4 })
    const state = makeState([player])

    const [score] = calculateScores(state)

    expect(score.vpScore).toBe(11) // floor(4/3)*10 + (4%3)*1 = 10+1
  })

  test('会計事務所（p-vp-double）所有時、2倍分の増加は建物効果(bonuses)に計上され、勝利点(vpScore)はベース点のまま', () => {
    const player = makePlayer({
      id: 0, money: 0,
      ownedBuildings: [makeOwnedBuilding('会計事務所')],
      victoryPoints: 4,
    })
    const state = makeState([player])

    const [score] = calculateScores(state)

    expect(score.vpScore).toBe(11) // ベース点のまま（floor(4/3)*10 + (4%3)*1）
    expect(score.bonuses).toBe(11) // 2倍分の増加がbonuses側に計上される
  })
})

describe('calculateScores: total集計', () => {
  test('buildingValue + money + bonuses + vpScore - unpaidPenalty で合計される', () => {
    const player = makePlayer({
      id: 0, money: 15,
      ownedBuildings: [makeOwnedBuilding('不動産屋')], // assetValue10, bonuses3
      unpaidWages: 2, // penalty 6
      victoryPoints: 1, // vpScore 1
    })
    const state = makeState([player])

    const [score] = calculateScores(state)

    expect(score.total).toBe(10 + 15 + 3 + 1 - 6)
  })
})
