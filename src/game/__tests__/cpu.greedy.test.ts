/**
 * cpu.greedy.test.ts
 * greedy CPU の選択品質テスト。
 *
 * ※ テスト設計上の注意:
 *   最後のワーカーを置くと afterHumanAction → processRoundEnd が発動し
 *   publicWorkplace.workerIds / ownedBuilding.workerHereId がリセットされる。
 *   これを避けるため、「ラウンド終了防止用ダミー人間プレイヤー」(id=1, worker 1人)
 *   を用意し、CPU が全員置いた後も人間のワーカーが残るようにする。
 */

import { describe, test, expect, beforeEach } from 'vitest'
import { cpuOneTurnStep } from '../turns'
import {
  resetIds,
  makePlayer,
  makeState,
  makeBuildingCard,
  makeConsumptionCard,
  makeWorker,
  makeOwnedBuilding,
  makePublicWorkplace,
  usedPublicWorkplace,
  builtBuilding,
  usedOwnedBuilding,
} from './helpers'
import type { Player } from '../types'

beforeEach(() => { resetIds() })

// ラウンド終了防止用ダミー人間プレイヤー
function makeHumanGuard(): Player {
  return makePlayer({
    id: 1,
    name: 'Human',
    isCpu: false,
    cpuStrategy: 'random',
    money: 20,
    hand: [],
    ownedBuildings: [],
    workers: [makeWorker(1)],
  })
}

// ============================================================
// 学校: 労働者2人のとき常に選ぶ
// ============================================================
// 根拠: 学校スコア = addBase(130) × (1-0/9) × pubBonus(1.3) ≈ 169
//   大工(農場 cost=1) = (85+3)×1.2×1.3 ≈ 137
//   大工(製鉄所 cost=4) = (85+12)×1.2×1.3 ≈ 152
//   → いずれも 169 に負ける

describe('greedy: 労働者2人なら学校を選ぶ', () => {
  test('大工（農場を建てられる）より学校を優先する', () => {
    const cpu = makePlayer({
      workers: [makeWorker(0), makeWorker(0)],
      hand: [makeBuildingCard('農場'), makeConsumptionCard()],
      money: 20,
    })
    const state = makeState([cpu, makeHumanGuard()], {
      round: 1,
      publicWorkplaces: [
        makePublicWorkplace('学校', { kind: 'add-worker', immediate: false }),
        makePublicWorkplace('大工', { kind: 'build', discount: 0, drawAfter: 0 }),
        makePublicWorkplace('採石場', { kind: 'draw-become-start' }),
      ],
    })

    const result = cpuOneTurnStep(state)

    // 学校を使った証拠: 研修中ワーカーが追加される
    expect(result.players[0].workers.length).toBe(3)
    expect(result.players[0].workers.some(w => w.isTraining)).toBe(true)
  })

  test('高コスト建物（製鉄所 cost=4）を建てられる手札があっても学校を優先する', () => {
    const cpu = makePlayer({
      workers: [makeWorker(0), makeWorker(0)],
      hand: [
        makeBuildingCard('製鉄所'),
        makeConsumptionCard(), makeConsumptionCard(),
        makeConsumptionCard(), makeConsumptionCard(),
      ],
      money: 20,
    })
    const state = makeState([cpu, makeHumanGuard()], {
      round: 1,
      publicWorkplaces: [
        makePublicWorkplace('学校', { kind: 'add-worker', immediate: false }),
        makePublicWorkplace('大工', { kind: 'build', discount: 0, drawAfter: 0 }),
      ],
    })

    const result = cpuOneTurnStep(state)

    expect(result.players[0].workers.length).toBe(3)
    expect(result.players[0].workers.some(w => w.isTraining)).toBe(true)
  })

  test('自分の場の製鉄所（draw:3）より学校を優先する', () => {
    const cpu = makePlayer({
      workers: [makeWorker(0), makeWorker(0)],
      hand: [makeConsumptionCard(), makeConsumptionCard()],
      ownedBuildings: [makeOwnedBuilding('製鉄所')],
      money: 20,
    })
    const state = makeState([cpu, makeHumanGuard()], {
      round: 1,
      publicWorkplaces: [
        makePublicWorkplace('学校', { kind: 'add-worker', immediate: false }),
      ],
    })

    const result = cpuOneTurnStep(state)

    expect(result.players[0].workers.length).toBe(3)
    expect(result.players[0].workers.some(w => w.isTraining)).toBe(true)
  })
})

// ============================================================
// 残り1ワーカー: money 状況で建設か市場か
// ============================================================
//
// 賃金計算: Round1 wage=2 × workers=3人 = expectedWage=6

describe('greedy: 残り1ワーカー・建設か市場か', () => {
  test('money が賃金以上なら残り1ワーカーでも建物を建てる', () => {
    // workers=3(2配置済み+1フリー), money=8 >= expectedWage=6
    const cpu = makePlayer({
      workers: [
        makeWorker(0, { placedAt: 'dummy1' }),
        makeWorker(0, { placedAt: 'dummy2' }),
        makeWorker(0),
      ],
      hand: [makeBuildingCard('農場'), makeConsumptionCard()],
      money: 8,
    })
    const state = makeState([cpu, makeHumanGuard()], {
      round: 1,
      publicWorkplaces: [
        makePublicWorkplace('大工', { kind: 'build', discount: 0, drawAfter: 0 }),
        makePublicWorkplace('露店', { kind: 'discard-gain', discard: 1, gain: 6 }),
      ],
    })

    const result = cpuOneTurnStep(state)

    expect(builtBuilding(state, result, 0)).toBe('農場')
  })

  // ラウンド終了防止: cpu 3workers(2配置済み+1フリー) + human 1worker(フリー)
  // → CPU 最後のワーカーを置いても人間がまだ → ラウンド終了しない
  test('money が賃金未満なら建設せず discard-gain（露店）でお金を稼ぐ', () => {
    // workers=3(2配置済み+1フリー), money=4 < expectedWage=6
    // availWorkers=1<2 かつ money<wage → build は -Infinity
    const cpu = makePlayer({
      workers: [
        makeWorker(0, { placedAt: 'dummy1' }),
        makeWorker(0, { placedAt: 'dummy2' }),
        makeWorker(0),
      ],
      hand: [makeBuildingCard('農場'), makeConsumptionCard()],
      money: 4,
    })
    const state = makeState([cpu, makeHumanGuard()], {
      round: 1,
      publicWorkplaces: [
        makePublicWorkplace('大工', { kind: 'build', discount: 0, drawAfter: 0 }),
        makePublicWorkplace('露店', { kind: 'discard-gain', discard: 1, gain: 6 }),
      ],
    })

    const result = cpuOneTurnStep(state)

    expect(builtBuilding(state, result, 0)).toBeNull()
    expect(usedPublicWorkplace(state, result)).toBe('露店')
  })
})

// ============================================================
// 残り2ワーカー: money 状況 × 既存建物の有無
// ============================================================
//
// 賃金計算: Round1 wage=2 × workers=2人 = expectedWage=4
//
// 【ラウンド終了防止】
//   CPU 2workers + human 1worker で構成。
//   CPU が2手使い切っても人間が残るためラウンド終了しない。

describe('greedy: 残り2ワーカー・建設か既存施設使用か', () => {
  test('money が賃金以上なら大工で建物を建てる', () => {
    // money=8 >= expectedWage=4 → build は -Infinity にならない（大工スコア≈142）
    const cpu = makePlayer({
      workers: [makeWorker(0), makeWorker(0)],
      hand: [makeBuildingCard('工場'), makeConsumptionCard(), makeConsumptionCard()],
      money: 8,
    })
    const state = makeState([cpu, makeHumanGuard()], {
      round: 1,
      publicWorkplaces: [
        makePublicWorkplace('大工', { kind: 'build', discount: 0, drawAfter: 0 }),
        makePublicWorkplace('露店', { kind: 'discard-gain', discard: 1, gain: 6 }),
      ],
    })

    const result = cpuOneTurnStep(state)

    expect(builtBuilding(state, result, 0)).toBe('工場')
  })

  test('money<賃金 かつ 同等以上コストの建物（製鉄所 cost=4）があれば建設しない', () => {
    // money=3 < expectedWage=4
    // 建てようとする工場 cost=2 ≤ 製鉄所 cost=4 → 製鉄所を使った方が得
    const cpu = makePlayer({
      workers: [makeWorker(0), makeWorker(0)],
      hand: [makeBuildingCard('工場'), makeConsumptionCard(), makeConsumptionCard()],
      ownedBuildings: [makeOwnedBuilding('製鉄所')],
      money: 3,
    })
    const state = makeState([cpu, makeHumanGuard()], {
      round: 1,
      publicWorkplaces: [
        makePublicWorkplace('大工', { kind: 'build', discount: 0, drawAfter: 0 }),
        makePublicWorkplace('露店', { kind: 'discard-gain', discard: 1, gain: 6 }),
      ],
    })

    const result = cpuOneTurnStep(state)

    expect(builtBuilding(state, result, 0)).toBeNull()
    expect(usedOwnedBuilding(state, result, 0)).toBe('製鉄所')
  })

  test('money<賃金 かつ 同等以上コストの建物がなければ建設し、次の手でその建物を使う', () => {
    // money=20（賃金が払えるよう設定）、既存建物なし
    // Worker1: 大工 → 工場建設（cost=2、手札5→消費財2枚に）
    // Worker2: 工場を使う（discard2→draw4 → 手札2→4枚に）
    //
    // ※ ダミー人間プレイヤーを置かない設計:
    //   Worker2 の後にラウンドが終了するが、手札枚数はラウンド終了をまたいで保持される。
    //   工場(discard2,draw4)を使った場合は手札が 2→4 枚になることで確認する。
    //   デッキ空の場合 drawCards は消費財を生成するため枚数が確定する。
    const cpu = makePlayer({
      workers: [makeWorker(0), makeWorker(0)],
      hand: [
        makeBuildingCard('工場'),
        makeConsumptionCard(), makeConsumptionCard(),
        makeConsumptionCard(), makeConsumptionCard(),
      ],
      ownedBuildings: [],
      money: 20,  // 賃金 (2workers×2=4) を超える額
    })
    const state = makeState([cpu], {  // 人間ガードなし（ラウンド終了を許容）
      round: 1,
      buildingDeck: [],  // 空 → draw 時は消費財が生成される
      publicWorkplaces: [
        makePublicWorkplace('大工', { kind: 'build', discount: 0, drawAfter: 0 }),
        makePublicWorkplace('露店', { kind: 'discard-gain', discard: 1, gain: 6 }),
      ],
    })

    // Worker 1: 大工 → 工場建設（ラウンドはまだ終了しない）
    const after1 = cpuOneTurnStep(state)
    expect(builtBuilding(state, after1, 0)).toBe('工場')
    expect(after1.players[0].hand.length).toBe(2)  // 工場+消費財×2 を消費

    // Worker 2: 工場を使う → discard2, draw4 → 手札 2→4 枚
    // （ラウンド終了後も手札はそのまま保持される）
    const after2 = cpuOneTurnStep(after1)
    expect(after2.players[0].hand.length).toBe(4)
  })

  test('建設後に手札が空になるゼネコンは建てない', () => {
    // ゼネコン cost=4: 手札5枚（ゼネコン+消費財×4）をすべて使い切る
    // 建設後 hand=0 → Worker2 はゼネコン(build効果)を使えない
    const cpu = makePlayer({
      workers: [makeWorker(0), makeWorker(0)],
      hand: [
        makeBuildingCard('ゼネコン'),
        makeConsumptionCard(), makeConsumptionCard(),
        makeConsumptionCard(), makeConsumptionCard(),
      ],
      ownedBuildings: [],
      money: 3,
    })
    const state = makeState([cpu, makeHumanGuard()], {
      round: 1,
      publicWorkplaces: [
        makePublicWorkplace('大工', { kind: 'build', discount: 0, drawAfter: 0 }),
        makePublicWorkplace('露店', { kind: 'discard-gain', discard: 1, gain: 6 }),
      ],
    })

    const result = cpuOneTurnStep(state)

    expect(builtBuilding(state, result, 0)).not.toBe('ゼネコン')
  })
})
