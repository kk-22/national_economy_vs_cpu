/**
 * build.modernism.test.ts
 * モダニズム建設（consumptionDouble）の支払い・戻るボタン動作のテスト。
 */

import { describe, test, expect, beforeEach } from 'vitest'
import { confirmBuildPayment } from '../turns'
import { selectBuildTarget, cancelBuildPayment } from '../build'
import {
  resetIds,
  makePlayer,
  makeState,
  makeBuildingCard,
  makeConsumptionCard,
} from './helpers'

beforeEach(() => { resetIds() })

// cost に対応する実在のカード名マップ
const CARD_BY_COST: Record<number, string> = { 2: '工場', 3: '不動産屋', 4: 'ゼネコン' }

// choose-build-payment(consumptionDouble) 状態を作るヘルパー
function makePaymentState(cost: number, hand: ReturnType<typeof makeBuildingCard | typeof makeConsumptionCard>[]) {
  const targetCard = makeBuildingCard(CARD_BY_COST[cost] ?? '工場')
  const player = makePlayer({ id: 0, isCpu: false, hand: [targetCard, ...hand] })
  const state = makeState([player], {
    pendingAction: {
      kind: 'choose-build-payment',
      playerId: 0,
      targetId: targetCard.id,
      targetName: targetCard.name,
      cost,
      drawAfter: 0,
      discount: 0,
      consumptionDouble: true,
      sourceName: 'モダニズム建設',
      sourceId: 'src-1',
    },
  })
  return { state, targetCard, hand }
}

describe('モダニズム建設: 消費財2倍カウント', () => {
  test('消費財1枚（実効2）でコスト2の建物を建設できる', () => {
    const con = makeConsumptionCard()
    const { state, targetCard } = makePaymentState(2, [con])

    const result = confirmBuildPayment(state, [con.id])

    const player = result.players.find(p => p.id === 0)!
    expect(player.ownedBuildings.some(b => b.name === targetCard.name)).toBe(true)
    expect(result.pendingAction).toBeNull()
  })

  test('消費財2枚（実効4）でコスト4の建物を建設できる', () => {
    const con1 = makeConsumptionCard()
    const con2 = makeConsumptionCard()
    const { state, targetCard } = makePaymentState(4, [con1, con2])

    const result = confirmBuildPayment(state, [con1.id, con2.id])

    const player = result.players.find(p => p.id === 0)!
    expect(player.ownedBuildings.some(b => b.name === targetCard.name)).toBe(true)
  })

  test('消費財2枚（実効4）でコスト3の奇数コスト建物を超過払いで建設できる', () => {
    const con1 = makeConsumptionCard()
    const con2 = makeConsumptionCard()
    const { state, targetCard } = makePaymentState(3, [con1, con2])

    const result = confirmBuildPayment(state, [con1.id, con2.id])

    const player = result.players.find(p => p.id === 0)!
    expect(player.ownedBuildings.some(b => b.name === targetCard.name)).toBe(true)
  })

  test('消費財1枚（実効2）でコスト3は不足で建設できない', () => {
    const con = makeConsumptionCard()
    const { state } = makePaymentState(3, [con])

    const result = confirmBuildPayment(state, [con.id])

    // pendingAction が残る（建設されない）
    expect(result.pendingAction?.kind).toBe('choose-build-payment')
  })

  test('建物カード1枚（実効1）＋消費財1枚（実効2）でコスト3を建設できる', () => {
    const bld = makeBuildingCard('別の建物')
    const con = makeConsumptionCard()
    const { state, targetCard } = makePaymentState(3, [bld, con])

    const result = confirmBuildPayment(state, [bld.id, con.id])

    const player = result.players.find(p => p.id === 0)!
    expect(player.ownedBuildings.some(b => b.name === targetCard.name)).toBe(true)
  })
})

describe('モダニズム建設: 戻るボタン後の再選択', () => {
  test('cancelBuildPayment が consumptionDouble を choose-build-target に引き継ぐ', () => {
    const con = makeConsumptionCard()
    const targetCard = makeBuildingCard('工場')
    const player = makePlayer({ id: 0, hand: [targetCard, con] })
    const state = makeState([player], {
      pendingAction: {
        kind: 'choose-build-payment',
        playerId: 0,
        targetId: targetCard.id,
        targetName: targetCard.name,
        cost: 2,
        drawAfter: 0,
        discount: 0,
        consumptionDouble: true,
        sourceName: 'モダニズム建設',
        sourceId: 'src-1',
      },
    })

    const afterCancel = cancelBuildPayment(state)

    expect(afterCancel.pendingAction?.kind).toBe('choose-build-target')
    if (afterCancel.pendingAction?.kind === 'choose-build-target') {
      expect(afterCancel.pendingAction.consumptionDouble).toBe(true)
    }
  })

  test('戻り後に建物を再選択すると consumptionDouble が引き継がれ支払いが成功する', () => {
    const con1 = makeConsumptionCard()
    const con2 = makeConsumptionCard()
    const targetCard = makeBuildingCard('工場') // cost: 2
    const player = makePlayer({ id: 0, hand: [targetCard, con1, con2] })
    const stateWithTarget = makeState([player], {
      pendingAction: {
        kind: 'choose-build-target',
        playerId: 0,
        discount: 0,
        drawAfter: 0,
        consumptionDouble: true,
        sourceName: 'モダニズム建設',
        sourceId: 'src-1',
      },
    })

    // 建物を選択 → choose-build-payment になる
    const afterSelect = selectBuildTarget(stateWithTarget, targetCard.id)
    expect(afterSelect.pendingAction?.kind).toBe('choose-build-payment')
    if (afterSelect.pendingAction?.kind === 'choose-build-payment') {
      expect(afterSelect.pendingAction.consumptionDouble).toBe(true)
    }

    // 消費財2枚で支払い → 建設成功
    const afterPay = confirmBuildPayment(afterSelect, [con1.id, con2.id])
    const resultPlayer = afterPay.players.find(p => p.id === 0)!
    expect(resultPlayer.ownedBuildings.some(b => b.name === targetCard.name)).toBe(true)
  })
})
