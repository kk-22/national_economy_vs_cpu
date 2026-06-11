/**
 * replay.test.ts
 * replayToIndex のリグレッションテスト。
 * 手動で実行したアクションと同じ actionLog から replay した状態が一致することを確認する。
 */

import { describe, test, expect, beforeEach } from 'vitest'
import { replayToIndex } from '../replay'
import { placeWorkerOnPublic, placeWorkerOnBuilding, confirmDiscard, confirmBuildPayment } from '../turns'
import { selectBuildTarget } from '../build'
import type { HistoryEntry } from '../history'
import {
  resetIds,
  makePlayer,
  makeState,
  makeBuildingCard,
  makeConsumptionCard,
  makeWorker,
  makeOwnedBuilding,
  makePublicWorkplace,
} from './helpers'

/** 状態比較の核心部分を検証するヘルパー */
function assertStateMatch(replayed: ReturnType<typeof replayToIndex>, expected: ReturnType<typeof replayToIndex>) {
  expect(replayed.currentPlayerIndex).toBe(expected.currentPlayerIndex)
  expect(replayed.household).toBe(expected.household)
  expect(replayed.phase).toBe(expected.phase)
  for (let i = 0; i < expected.players.length; i++) {
    const rp = replayed.players[i]
    const ep = expected.players[i]
    expect(rp.money).toBe(ep.money)
    expect(rp.hand.map(c => c.id).sort()).toEqual(ep.hand.map(c => c.id).sort())
    expect(rp.ownedBuildings.map(b => b.name).sort()).toEqual(ep.ownedBuildings.map(b => b.name).sort())
    expect(rp.workers.map(w => w.placedAt).sort()).toEqual(ep.workers.map(w => w.placedAt).sort())
  }
  for (const ewp of expected.publicWorkplaces) {
    const rwp = replayed.publicWorkplaces.find(w => w.id === ewp.id)
    expect(rwp?.workerIds.sort()).toEqual(ewp.workerIds.sort())
  }
}

beforeEach(() => { resetIds() })

// 人間プレイヤーが置いた後にラウンドが終わらないよう、まだ置けるガードプレイヤー
function makeHumanGuard(): ReturnType<typeof makePlayer> {
  return makePlayer({ id: 1, name: 'Guard', isCpu: false, cpuStrategy: 'random', workers: [makeWorker(1)] })
}

// ============================================================
// draw 効果（鉱山）
// ============================================================

describe('replay: draw 効果（鉱山）', () => {
  test('ワーカー配置後の手札・ワーカー位置が再現できる', () => {
    const deckCard = { id: 'deck-1', name: '農場' }
    const player = makePlayer({ id: 0, isCpu: false, cpuStrategy: 'random' })
    const mine = makePublicWorkplace('鉱山', { kind: 'draw', n: 1 })
    const initialState = makeState([player, makeHumanGuard()], {
      buildingDeck: [deckCard],
      publicWorkplaces: [mine],
    })

    const mineId = initialState.publicWorkplaces[0].id
    const expectedState = placeWorkerOnPublic(initialState, 0, mineId)

    const actionLog: HistoryEntry[] = [
      { playerId: 0, targetId: mineId, targetName: '鉱山', timestamp: 0 },
    ]

    assertStateMatch(replayToIndex(initialState, actionLog), expectedState)
  })
})

// ============================================================
// discard-gain 効果（露店）
// ============================================================

describe('replay: discard-gain 効果（露店）', () => {
  test('消費財1枚捨てて+6金のリプレイが再現できる', () => {
    const con1 = makeConsumptionCard()
    const player = makePlayer({ id: 0, isCpu: false, cpuStrategy: 'random', hand: [con1] })
    const roten = makePublicWorkplace('露店', { kind: 'discard-gain', discard: 1, gain: 6 })
    const initialState = makeState([player, makeHumanGuard()], {
      publicWorkplaces: [roten],
      household: 50,
    })

    const rotenId = initialState.publicWorkplaces[0].id

    // 手動実行
    let s = placeWorkerOnPublic(initialState, 0, rotenId)
    expect(s.pendingAction?.kind).toBe('choose-discard')
    s = { ...s, pendingAction: { ...s.pendingAction!, selected: [con1.id] } } as typeof s
    const expectedState = confirmDiscard(s)

    const actionLog: HistoryEntry[] = [
      {
        playerId: 0,
        targetId: rotenId,
        targetName: '露店',
        discardedCards: [{ id: con1.id, name: '消費財' }],
        timestamp: 0,
      },
    ]

    assertStateMatch(replayToIndex(initialState, actionLog), expectedState)
  })

  test('建物カード1枚捨てて+6金のリプレイが再現できる', () => {
    const bld = makeBuildingCard('農場')
    const player = makePlayer({ id: 0, isCpu: false, cpuStrategy: 'random', hand: [bld] })
    const roten = makePublicWorkplace('露店', { kind: 'discard-gain', discard: 1, gain: 6 })
    const initialState = makeState([player, makeHumanGuard()], {
      publicWorkplaces: [roten],
      household: 50,
    })

    const rotenId = initialState.publicWorkplaces[0].id

    let s = placeWorkerOnPublic(initialState, 0, rotenId)
    s = { ...s, pendingAction: { ...s.pendingAction!, selected: [bld.id] } } as typeof s
    const expectedState = confirmDiscard(s)

    const actionLog: HistoryEntry[] = [
      {
        playerId: 0,
        targetId: rotenId,
        targetName: '露店',
        discardedCards: [{ id: bld.id, name: '農場' }],
        timestamp: 0,
      },
    ]

    assertStateMatch(replayToIndex(initialState, actionLog), expectedState)
  })
})

// ============================================================
// build 効果（大工）
// ============================================================

describe('replay: build 効果（大工）', () => {
  test('農場(cost=1)を消費財1枚払って建設するリプレイが再現できる', () => {
    const farm = makeBuildingCard('農場')  // cost: 1
    const con1 = makeConsumptionCard()
    const player = makePlayer({ id: 0, isCpu: false, cpuStrategy: 'random', hand: [farm, con1] })
    const daiku = makePublicWorkplace('大工', { kind: 'build', discount: 0, drawAfter: 0 })
    const initialState = makeState([player, makeHumanGuard()], {
      publicWorkplaces: [daiku],
    })

    const daikuId = initialState.publicWorkplaces[0].id

    // 手動実行
    let s = placeWorkerOnPublic(initialState, 0, daikuId)
    expect(s.pendingAction?.kind).toBe('choose-build-target')
    s = selectBuildTarget(s, farm.id)
    expect(s.pendingAction?.kind).toBe('choose-build-payment')
    const expectedState = confirmBuildPayment(s, [con1.id])

    const actionLog: HistoryEntry[] = [
      {
        playerId: 0,
        targetId: daikuId,
        targetName: '大工',
        builtCard: { id: farm.id, name: '農場' },
        paymentCards: [{ id: con1.id, name: '消費財' }],
        timestamp: 0,
      },
    ]

    assertStateMatch(replayToIndex(initialState, actionLog), expectedState)
  })

  test('工場(cost=2)を消費財2枚払って建設するリプレイが再現できる', () => {
    const factory = makeBuildingCard('工場')  // cost: 2
    const con1 = makeConsumptionCard()
    const con2 = makeConsumptionCard()
    const player = makePlayer({ id: 0, isCpu: false, cpuStrategy: 'random', hand: [factory, con1, con2] })
    const daiku = makePublicWorkplace('大工', { kind: 'build', discount: 0, drawAfter: 0 })
    const initialState = makeState([player, makeHumanGuard()], {
      publicWorkplaces: [daiku],
    })

    const daikuId = initialState.publicWorkplaces[0].id

    let s = placeWorkerOnPublic(initialState, 0, daikuId)
    s = selectBuildTarget(s, factory.id)
    const expectedState = confirmBuildPayment(s, [con1.id, con2.id])

    const actionLog: HistoryEntry[] = [
      {
        playerId: 0,
        targetId: daikuId,
        targetName: '大工',
        builtCard: { id: factory.id, name: '工場' },
        paymentCards: [
          { id: con1.id, name: '消費財' },
          { id: con2.id, name: '消費財' },
        ],
        timestamp: 0,
      },
    ]

    assertStateMatch(replayToIndex(initialState, actionLog), expectedState)
  })
})

// ============================================================
// 所有建物へのワーカー配置（農場: draw-consumption 2）
// ============================================================

describe('replay: 所有建物へのワーカー配置', () => {
  test('農場（draw-consumption 2）のリプレイが再現できる', () => {
    const farm = makeOwnedBuilding('農場')
    const player = makePlayer({ id: 0, isCpu: false, cpuStrategy: 'random', ownedBuildings: [farm] })
    const initialState = makeState([player, makeHumanGuard()], { household: 50 })

    const farmBldId = farm.id
    const expectedState = placeWorkerOnBuilding(initialState, 0, farmBldId)

    const actionLog: HistoryEntry[] = [
      { playerId: 0, targetId: farmBldId, targetName: '農場', timestamp: 0 },
    ]

    assertStateMatch(replayToIndex(initialState, actionLog), expectedState)
  })
})

// ============================================================
// 複数ターンのシーケンス
// ============================================================

describe('replay: 複数ターンのシーケンス', () => {
  test('2人が順番に鉱山に置くシーケンスが再現できる', () => {
    const deckCard1 = { id: 'deck-1', name: '農場' }
    const deckCard2 = { id: 'deck-2', name: '工場' }
    const p0 = makePlayer({ id: 0, isCpu: false, cpuStrategy: 'random' })
    const p1 = makePlayer({ id: 1, name: 'Player1', isCpu: false, cpuStrategy: 'random' })
    const mine = makePublicWorkplace('鉱山', { kind: 'draw', n: 1 }, { allowMultiple: true })
    const initialState = makeState([p0, p1], {
      buildingDeck: [deckCard1, deckCard2],
      publicWorkplaces: [mine],
    })

    const mineId = initialState.publicWorkplaces[0].id

    // 手動実行: p0 → p1
    let s = placeWorkerOnPublic(initialState, 0, mineId)  // p0 が置く → currentPlayerIndex = 1
    const expectedState = placeWorkerOnPublic(s, 1, mineId)  // p1 が置く

    const actionLog: HistoryEntry[] = [
      { playerId: 0, targetId: mineId, targetName: '鉱山', timestamp: 0 },
      { playerId: 1, targetId: mineId, targetName: '鉱山', timestamp: 1 },
    ]

    assertStateMatch(replayToIndex(initialState, actionLog), expectedState)
  })

  test('大工（建設）の後に露店（換金）するシーケンスが再現できる', () => {
    const farm = makeBuildingCard('農場')  // cost: 1
    const con1 = makeConsumptionCard()
    const con2 = makeConsumptionCard()
    const p0 = makePlayer({ id: 0, isCpu: false, cpuStrategy: 'random', hand: [farm, con1] })
    const p1 = makePlayer({ id: 1, name: 'Player1', isCpu: false, cpuStrategy: 'random', hand: [con2] })

    const daiku = makePublicWorkplace('大工', { kind: 'build', discount: 0, drawAfter: 0 })
    const roten = makePublicWorkplace('露店', { kind: 'discard-gain', discard: 1, gain: 6 })
    const initialState = makeState([p0, p1], {
      publicWorkplaces: [daiku, roten],
      household: 50,
    })

    const daikuId = initialState.publicWorkplaces[0].id
    const rotenId = initialState.publicWorkplaces[1].id

    // 手動実行
    let s = placeWorkerOnPublic(initialState, 0, daikuId)   // p0: 大工 → choose-build-target
    s = selectBuildTarget(s, farm.id)
    s = confirmBuildPayment(s, [con1.id])                    // p0 の turn 完了 → p1 へ
    s = placeWorkerOnPublic(s, 1, rotenId)                   // p1: 露店 → choose-discard
    s = { ...s, pendingAction: { ...s.pendingAction!, selected: [con2.id] } } as typeof s
    const expectedState = confirmDiscard(s)

    const actionLog: HistoryEntry[] = [
      {
        playerId: 0,
        targetId: daikuId,
        targetName: '大工',
        builtCard: { id: farm.id, name: '農場' },
        paymentCards: [{ id: con1.id, name: '消費財' }],
        timestamp: 0,
      },
      {
        playerId: 1,
        targetId: rotenId,
        targetName: '露店',
        discardedCards: [{ id: con2.id, name: '消費財' }],
        timestamp: 1,
      },
    ]

    assertStateMatch(replayToIndex(initialState, actionLog), expectedState)
  })
})
