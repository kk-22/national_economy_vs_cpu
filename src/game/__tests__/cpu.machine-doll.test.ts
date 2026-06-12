/**
 * cpu.machine-doll.test.ts
 * 機械人形（グローリー）の建設例外のテスト。
 *
 * cpu.ts の greedy フィルタは「R7以下は非職場建物を建てない」ルールに
 * 機械人形の例外を持つ。scoreEffect 側にも同じ例外がないと、
 * 機械人形が唯一の建設候補のとき建設アクション自体が選ばれなくなる。
 */

import { describe, test, expect, beforeEach } from 'vitest'
import { scoreEffect } from '../cpu-scoring'
import { resetIds, makePlayer, makeBuildingCard, makeConsumptionCard } from './helpers'

beforeEach(() => { resetIds() })

describe('scoreEffect: build 効果と機械人形', () => {
  test('R7以下でも機械人形が唯一の候補なら建設スコアは -Infinity にならない', () => {
    // 機械人形(cost=4) + 支払い用4枚 → 建設可能
    const player = makePlayer({
      hand: [
        makeBuildingCard('機械人形'),
        makeConsumptionCard(), makeConsumptionCard(), makeConsumptionCard(), makeConsumptionCard(),
      ],
      money: 20,
    })
    const score = scoreEffect({ kind: 'build', discount: 0, drawAfter: 0 }, player, 50, 3, 2)
    expect(score).toBeGreaterThan(-Infinity)
  })

  test('R7以下で他の非職場建物（記念碑）のみなら建設スコアは -Infinity のまま', () => {
    const player = makePlayer({
      hand: [
        makeBuildingCard('記念碑'),
        makeConsumptionCard(), makeConsumptionCard(), makeConsumptionCard(),
      ],
      money: 20,
    })
    const score = scoreEffect({ kind: 'build', discount: 0, drawAfter: 0 }, player, 50, 3, 2)
    expect(score).toBe(-Infinity)
  })
})
