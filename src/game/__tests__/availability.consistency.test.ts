/**
 * availability.consistency.test.ts
 * availability.ts の「配置可能」判定と、effects.ts の実際の効果適用結果が一致することを検証する。
 *
 * 過去に gain-household-by-workers / gain-household-if-hand で、availability側の予測額が
 * 実際の効果適用時の獲得額とズレており、
 *   - 配置できるはずなのに弾かれる
 *   - 配置できてしまうのに効果が発動せず労働者だけ消費される（サイレントno-op）
 * というバグが存在した。再発防止のための固定テスト。
 */

import { describe, test, expect, beforeEach } from 'vitest'
import { applyEffect } from '../effects'
import { getAvailablePublicWorkplaces } from '../availability'
import {
  resetIds,
  makePlayer,
  makeState,
  makePublicWorkplace,
  makeWorker,
  makeConsumptionCard,
} from './helpers'

beforeEach(() => { resetIds() })

describe('gain-household-by-workers（ボードゲームカフェ）', () => {
  const effect = { kind: 'gain-household-by-workers' as const, withWorker: 5, withoutWorker: 10 }

  test('最後の1コマで配置する場合: household<10なら選択肢に出ない（実際は10必要なため）', () => {
    const worker = makeWorker(0)
    const player = makePlayer({ id: 0, isCpu: false, money: 0, workers: [worker] })
    const wp = makePublicWorkplace('ボードゲームカフェ', effect)
    const state = makeState([player], { household: 7, publicWorkplaces: [wp] })

    const avail = getAvailablePublicWorkplaces(state, 0)

    expect(avail.find(w => w.id === wp.id)).toBeUndefined()
  })

  test('最後の1コマで配置する場合: household=10なら選択肢に出て、実際に$10もらえる', () => {
    const worker = makeWorker(0)
    const player = makePlayer({ id: 0, isCpu: false, money: 0, workers: [worker] })
    const wp = makePublicWorkplace('ボードゲームカフェ', effect)
    const state = makeState([player], { household: 10, publicWorkplaces: [wp] })

    expect(getAvailablePublicWorkplaces(state, 0).find(w => w.id === wp.id)).toBeDefined()

    // 配置後の状態を模倣（このコマのplacedAtが設定済み）
    const placedState = {
      ...state,
      players: [{ ...player, workers: [{ ...worker, placedAt: wp.id }] }],
    }
    const result = applyEffect(placedState, 0, effect, false)

    expect(result.household).toBe(0)
    expect(result.players[0].money).toBe(10)
  })

  test('他に未配置コマが残る場合: household=5(withWorker)なら選択肢に出て、実際に$5もらえる', () => {
    const w1 = makeWorker(0)
    const w2 = makeWorker(0)
    const player = makePlayer({ id: 0, isCpu: false, money: 0, workers: [w1, w2] })
    const wp = makePublicWorkplace('ボードゲームカフェ', effect)
    const state = makeState([player], { household: 5, publicWorkplaces: [wp] })

    expect(getAvailablePublicWorkplaces(state, 0).find(w => w.id === wp.id)).toBeDefined()

    // w1をこの職場に配置、w2は未配置のまま残る状態を模倣
    const placedState = {
      ...state,
      players: [{ ...player, workers: [{ ...w1, placedAt: wp.id }, w2] }],
    }
    const result = applyEffect(placedState, 0, effect, false)

    expect(result.household).toBe(0)
    expect(result.players[0].money).toBe(5)
  })

  test('他に未配置コマが残る場合: household=9(withWorkerは満たすがwithoutWorkerは未満)でも選択肢に出る', () => {
    const w1 = makeWorker(0)
    const w2 = makeWorker(0)
    const player = makePlayer({ id: 0, isCpu: false, money: 0, workers: [w1, w2] })
    const wp = makePublicWorkplace('ボードゲームカフェ', effect)
    const state = makeState([player], { household: 9, publicWorkplaces: [wp] })

    // 実際に必要なのは$5（他にコマが残るため）なので、$9でも配置可能なはず
    expect(getAvailablePublicWorkplaces(state, 0).find(w => w.id === wp.id)).toBeDefined()
  })
})

describe('gain-household-if-hand（美術館）', () => {
  const effect = { kind: 'gain-household-if-hand' as const, exactHand: 5, gain: 14, otherwise: 7 }

  test('手札がexactHand枚のとき: household<gain(14)なら選択肢に出ない', () => {
    const hand = Array.from({ length: 5 }, () => makeConsumptionCard())
    const player = makePlayer({ id: 0, isCpu: false, money: 0, hand })
    const wp = makePublicWorkplace('美術館', effect)
    const state = makeState([player], { household: 10, publicWorkplaces: [wp] })

    expect(getAvailablePublicWorkplaces(state, 0).find(w => w.id === wp.id)).toBeUndefined()
  })

  test('手札がexactHand枚のとき: household>=gain(14)なら選択肢に出て、実際に$14もらえる', () => {
    const hand = Array.from({ length: 5 }, () => makeConsumptionCard())
    const player = makePlayer({ id: 0, isCpu: false, money: 0, hand })
    const wp = makePublicWorkplace('美術館', effect)
    const state = makeState([player], { household: 14, publicWorkplaces: [wp] })

    expect(getAvailablePublicWorkplaces(state, 0).find(w => w.id === wp.id)).toBeDefined()

    const result = applyEffect(state, 0, effect, false)

    expect(result.household).toBe(0)
    expect(result.players[0].money).toBe(14)
  })

  test('手札がexactHand枚以外のとき: household=otherwise(7)で選択肢に出て、実際に$7もらえる', () => {
    const hand = [makeConsumptionCard(), makeConsumptionCard(), makeConsumptionCard()]
    const player = makePlayer({ id: 0, isCpu: false, money: 0, hand })
    const wp = makePublicWorkplace('美術館', effect)
    const state = makeState([player], { household: 7, publicWorkplaces: [wp] })

    expect(getAvailablePublicWorkplaces(state, 0).find(w => w.id === wp.id)).toBeDefined()

    const result = applyEffect(state, 0, effect, false)

    expect(result.household).toBe(0)
    expect(result.players[0].money).toBe(7)
  })
})
