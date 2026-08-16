/**
 * replay.pending-kinds.test.ts
 * replay.ts の resolvePending が未カバーだった pendingAction 種別のリグレッションテスト。
 * choose-build-two-*・choose-free-build・choose-no-sell-build・choose-consumption-or-discard は
 * pendingEntry への記録漏れが undo 後の不整合バグを引き起こすため（replay.ts 内コメント参照）、
 * 「resolvePending 後に pendingAction が解消されていること」を確認する。
 */

import { describe, test, expect, beforeEach } from 'vitest'
import { replayToIndex } from '../replay'
import {
  placeWorkerOnPublic, selectBuildTwoFirstCard, selectBuildTwoSecondCard, confirmBuildTwoCards,
  confirmFreeBuildCard, selectNoSellBuildCard, confirmBuildPayment, confirmConsumptionOrDiscard,
} from '../turns'
import type { HistoryEntry } from '../history'
import {
  resetIds, makePlayer, makeState, makeBuildingCard, makeWorker, makePublicWorkplace,
} from './helpers'

beforeEach(() => { resetIds() })

function makeHumanGuard(): ReturnType<typeof makePlayer> {
  return makePlayer({ id: 1, name: 'Guard', isCpu: false, cpuStrategy: 'random', workers: [makeWorker(1)] })
}

// ============================================================
// choose-build-two-first / second / payment（地球建設）
// ============================================================

describe('replay: build-two 効果（地球建設）', () => {
  test('2棟を合計コスト分の手札で同時建設するリプレイが再現できる', () => {
    const farm = makeBuildingCard('農場')    // cost: 1
    const factory = makeBuildingCard('工場')  // cost: 2
    const payer1 = makeBuildingCard('農場')
    const payer2 = makeBuildingCard('農場')
    const payer3 = makeBuildingCard('農場')
    const player = makePlayer({
      id: 0, isCpu: false, cpuStrategy: 'random',
      hand: [farm, factory, payer1, payer2, payer3],
    })
    const chikyu = makePublicWorkplace('地球建設', { kind: 'build-two' })
    const initialState = makeState([player, makeHumanGuard()], { publicWorkplaces: [chikyu] })
    const chikyuId = initialState.publicWorkplaces[0].id

    let s = placeWorkerOnPublic(initialState, 0, chikyuId)
    expect(s.pendingAction?.kind).toBe('choose-build-two-first')
    s = selectBuildTwoFirstCard(s, farm.id)
    expect(s.pendingAction?.kind).toBe('choose-build-two-second')
    s = selectBuildTwoSecondCard(s, factory.id)
    expect(s.pendingAction?.kind).toBe('choose-build-two-payment')
    const expectedState = confirmBuildTwoCards(s, [payer1.id, payer2.id, payer3.id])
    expect(expectedState.pendingAction).toBeNull()

    const actionLog: HistoryEntry[] = [
      {
        playerId: 0,
        targetId: chikyuId,
        targetName: '地球建設',
        builtCard: { id: farm.id, name: '農場' },
        secondBuiltCard: { id: factory.id, name: '工場' },
        paymentCards: [
          { id: payer1.id, name: '農場' },
          { id: payer2.id, name: '農場' },
          { id: payer3.id, name: '農場' },
        ],
        timestamp: 0,
      },
    ]

    const replayed = replayToIndex(initialState, actionLog)
    expect(replayed.pendingAction).toBeNull()
    expect(replayed.players[0].ownedBuildings.map(b => b.name).sort()).toEqual(expectedState.players[0].ownedBuildings.map(b => b.name).sort())
    expect(replayed.players[0].hand.map(c => c.id).sort()).toEqual(expectedState.players[0].hand.map(c => c.id).sort())
  })
})

// ============================================================
// choose-free-build（プレハブ工務店）
// ============================================================

describe('replay: build-free-if-cheap 効果（プレハブ工務店）', () => {
  test('資産価値maxAsset以下の建物を無料建設するリプレイが再現できる', () => {
    const farm = makeBuildingCard('農場')  // assetValue: 6
    const player = makePlayer({ id: 0, isCpu: false, cpuStrategy: 'random', hand: [farm] })
    const prefab = makePublicWorkplace('プレハブ工務店', { kind: 'build-free-if-cheap', maxAsset: 10 })
    const initialState = makeState([player, makeHumanGuard()], { publicWorkplaces: [prefab] })
    const prefabId = initialState.publicWorkplaces[0].id

    let s = placeWorkerOnPublic(initialState, 0, prefabId)
    expect(s.pendingAction?.kind).toBe('choose-free-build')
    const expectedState = confirmFreeBuildCard(s, farm.id)
    expect(expectedState.pendingAction).toBeNull()

    const actionLog: HistoryEntry[] = [
      {
        playerId: 0,
        targetId: prefabId,
        targetName: 'プレハブ工務店',
        builtCard: { id: farm.id, name: '農場' },
        timestamp: 0,
      },
    ]

    const replayed = replayToIndex(initialState, actionLog)
    expect(replayed.pendingAction).toBeNull()
    expect(replayed.players[0].ownedBuildings.map(b => b.name)).toEqual(expectedState.players[0].ownedBuildings.map(b => b.name))
  })
})

// ============================================================
// choose-no-sell-build（建築会社）
// ============================================================

describe('replay: build-no-sell 効果（建築会社）', () => {
  test('売却不可建物をコスト払いで建設するリプレイが再現できる', () => {
    const warehouse = makeBuildingCard('倉庫')  // cost: 2, canSell: false
    const payer1 = makeBuildingCard('農場')
    const payer2 = makeBuildingCard('農場')
    const player = makePlayer({ id: 0, isCpu: false, cpuStrategy: 'random', hand: [warehouse, payer1, payer2] })
    const kensetsu = makePublicWorkplace('建築会社', { kind: 'build-no-sell', drawAfter: 0 })
    const initialState = makeState([player, makeHumanGuard()], { publicWorkplaces: [kensetsu] })
    const kensetsuId = initialState.publicWorkplaces[0].id

    let s = placeWorkerOnPublic(initialState, 0, kensetsuId)
    expect(s.pendingAction?.kind).toBe('choose-no-sell-build')
    s = selectNoSellBuildCard(s, warehouse.id)
    expect(s.pendingAction?.kind).toBe('choose-build-payment')
    const expectedState = confirmBuildPayment(s, [payer1.id, payer2.id])
    expect(expectedState.pendingAction).toBeNull()

    const actionLog: HistoryEntry[] = [
      {
        playerId: 0,
        targetId: kensetsuId,
        targetName: '建築会社',
        builtCard: { id: warehouse.id, name: '倉庫' },
        paymentCards: [
          { id: payer1.id, name: '農場' },
          { id: payer2.id, name: '農場' },
        ],
        timestamp: 0,
      },
    ]

    const replayed = replayToIndex(initialState, actionLog)
    expect(replayed.pendingAction).toBeNull()
    expect(replayed.players[0].ownedBuildings.map(b => b.name)).toEqual(expectedState.players[0].ownedBuildings.map(b => b.name))
  })
})

// ============================================================
// choose-consumption-or-discard（グローリー: 農村）
// ============================================================

describe('replay: draw-consumption-or-discard-draw 効果（農村）', () => {
  test('「消費財を引く」選択のリプレイが再現できる', () => {
    const player = makePlayer({ id: 0, isCpu: false, cpuStrategy: 'random' })
    const nouson = makePublicWorkplace('農村', { kind: 'draw-consumption-or-discard-draw', n: 2 })
    const initialState = makeState([player, makeHumanGuard()], { publicWorkplaces: [nouson] })
    const nousonId = initialState.publicWorkplaces[0].id

    let s = placeWorkerOnPublic(initialState, 0, nousonId)
    expect(s.pendingAction?.kind).toBe('choose-consumption-or-discard')
    const expectedState = confirmConsumptionOrDiscard(s, 'consumption')
    expect(expectedState.pendingAction).toBeNull()

    const actionLog: HistoryEntry[] = [
      { playerId: 0, targetId: nousonId, targetName: '農村', gloryChoice: 'consumption', timestamp: 0 },
    ]

    const replayed = replayToIndex(initialState, actionLog)
    expect(replayed.pendingAction).toBeNull()
    expect(replayed.players[0].hand.length).toBe(expectedState.players[0].hand.length)
  })

  test('「消費財を捨てて建物を引く」選択のリプレイが再現できる', () => {
    const con1 = { kind: 'consumption' as const, id: 'con-a' }
    const con2 = { kind: 'consumption' as const, id: 'con-b' }
    const player = makePlayer({ id: 0, isCpu: false, cpuStrategy: 'random', hand: [con1, con2] })
    const nouson = makePublicWorkplace('農村', { kind: 'draw-consumption-or-discard-draw', n: 2 })
    const initialState = makeState([player, makeHumanGuard()], {
      publicWorkplaces: [nouson],
      buildingDeck: [{ id: 'deck-1', name: '農場' }, { id: 'deck-2', name: '農場' }, { id: 'deck-3', name: '農場' }],
    })
    const nousonId = initialState.publicWorkplaces[0].id

    let s = placeWorkerOnPublic(initialState, 0, nousonId)
    const expectedState = confirmConsumptionOrDiscard(s, 'discard-draw')
    expect(expectedState.pendingAction).toBeNull()

    const actionLog: HistoryEntry[] = [
      { playerId: 0, targetId: nousonId, targetName: '農村', gloryChoice: 'discard-draw', timestamp: 0 },
    ]

    const replayed = replayToIndex(initialState, actionLog)
    expect(replayed.pendingAction).toBeNull()
    expect(replayed.players[0].hand.map(c => c.id).sort()).toEqual(expectedState.players[0].hand.map(c => c.id).sort())
  })
})
