/**
 * cpu.pub-priority.test.ts
 *
 * 「一般職場と同名の自分の建物は選択肢から除外される」ルールの検証。
 *
 * 対象:
 *   - filterDominatedWorkplaces (rule 3) の単体テスト
 *   - greedy / random / mcts 各戦略の統合テスト
 *
 * 検証方法:
 *   「一般職場にのみ X がある」状況と「一般職場・自分の場の両方に X がある」状況で
 *   どちらも一般職場の X を使うことを確認する。
 *   後者で自分の場の X が除外されていなければ、ランダムに自分の場を選ぶ可能性があり
 *   テストが不安定になる（→ 何度実行しても一般職場を使えば除外が機能している）。
 */

import { describe, test, expect, beforeEach } from 'vitest'
import { filterDominatedWorkplaces } from '../cpu-scoring'
import { cpuOneTurnStep } from '../turns'
import {
  resetIds,
  makePlayer,
  makeState,
  makeConsumptionCard,
  makeOwnedBuilding,
  makePublicWorkplace,
  makeWorker,
  usedPublicWorkplace,
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
// filterDominatedWorkplaces: rule 3 の単体テスト
// ============================================================

describe('filterDominatedWorkplaces: 一般職場と同名の自分の建物を除外', () => {
  test('一般職場に農場がある場合、自分の場の農場は除外される', () => {
    const pubOptions = [
      makePublicWorkplace('農場', { kind: 'draw-consumption', n: 2 }),
      makePublicWorkplace('露店', { kind: 'discard-gain', discard: 1, gain: 6 }),
    ]
    const bldOptions = [
      makeOwnedBuilding('農場'),
      makeOwnedBuilding('製鉄所'),
    ]

    const { pubOptions: pub, bldOptions: bld } = filterDominatedWorkplaces(pubOptions, bldOptions)

    // 一般職場の農場はそのまま残る
    expect(pub.some(wp => wp.name === '農場')).toBe(true)
    // 自分の場の農場は除外される
    expect(bld.some(b => b.name === '農場')).toBe(false)
    // 一般職場にない製鉄所はそのまま残る
    expect(bld.some(b => b.name === '製鉄所')).toBe(true)
  })

  test('一般職場に複数の同名施設がある場合、それぞれ対応する自分の場の施設が除外される', () => {
    const pubOptions = [
      makePublicWorkplace('農場', { kind: 'draw-consumption', n: 2 }),
      makePublicWorkplace('製鉄所', { kind: 'draw', n: 3 }),
    ]
    const bldOptions = [
      makeOwnedBuilding('農場'),
      makeOwnedBuilding('製鉄所'),
      makeOwnedBuilding('工場'),
    ]

    const { bldOptions: bld } = filterDominatedWorkplaces(pubOptions, bldOptions)

    expect(bld.some(b => b.name === '農場')).toBe(false)
    expect(bld.some(b => b.name === '製鉄所')).toBe(false)
    // 一般職場にない工場は残る
    expect(bld.some(b => b.name === '工場')).toBe(true)
  })

  test('一般職場に同名施設がない場合、自分の場の施設は除外されない', () => {
    const pubOptions = [
      makePublicWorkplace('露店', { kind: 'discard-gain', discard: 1, gain: 6 }),
    ]
    const bldOptions = [
      makeOwnedBuilding('農場'),
      makeOwnedBuilding('製鉄所'),
    ]

    const { bldOptions: bld } = filterDominatedWorkplaces(pubOptions, bldOptions)

    expect(bld).toHaveLength(2)
  })

  test('自分の場の施設がない場合はエラーなく処理される', () => {
    const pubOptions = [
      makePublicWorkplace('農場', { kind: 'draw-consumption', n: 2 }),
    ]
    const bldOptions: ReturnType<typeof makeOwnedBuilding>[] = []

    const { pubOptions: pub, bldOptions: bld } = filterDominatedWorkplaces(pubOptions, bldOptions)

    expect(pub).toHaveLength(1)
    expect(bld).toHaveLength(0)
  })
})

// ============================================================
// 各CPU戦略: 同名施設が両方にある場合は一般職場を使う
// ============================================================
//
// シナリオ設計:
//   一般職場に農場のみ、自分の場にも農場のみ。
//   owned 農場が除外されれば選択肢は pub 農場のみ → 必ず pub 農場を使う。
//   除外されていなければランダムで owned を選ぶ可能性がある（テストが不安定になる）。

describe('greedy: 同名施設があれば自分の場の施設は選択肢から除外される', () => {
  test('一般職場と自分の場の両方に農場がある場合、一般職場の農場を使う', () => {
    const cpu = makePlayer({
      workers: [makeWorker(0), makeWorker(0)],
      hand: [makeConsumptionCard(), makeConsumptionCard(), makeConsumptionCard()],
      ownedBuildings: [makeOwnedBuilding('農場')],
      money: 20,
      cpuStrategy: 'greedy',
    })
    const state = makeState([cpu, makeHumanGuard()], {
      publicWorkplaces: [
        makePublicWorkplace('農場', { kind: 'draw-consumption', n: 2 }),
      ],
    })

    const result = cpuOneTurnStep(state).state

    expect(usedPublicWorkplace(state, result)).toBe('農場')
    expect(usedOwnedBuilding(state, result, 0)).toBeNull()
  })

  test('一般職場と自分の場の両方に製鉄所がある場合、一般職場の製鉄所を使う', () => {
    const cpu = makePlayer({
      workers: [makeWorker(0), makeWorker(0)],
      hand: [makeConsumptionCard(), makeConsumptionCard(), makeConsumptionCard()],
      ownedBuildings: [makeOwnedBuilding('製鉄所')],
      money: 20,
      cpuStrategy: 'greedy',
    })
    const state = makeState([cpu, makeHumanGuard()], {
      publicWorkplaces: [
        makePublicWorkplace('製鉄所', { kind: 'draw', n: 3 }),
      ],
    })

    const result = cpuOneTurnStep(state).state

    expect(usedPublicWorkplace(state, result)).toBe('製鉄所')
    expect(usedOwnedBuilding(state, result, 0)).toBeNull()
  })
})

describe('random: 同名施設があれば自分の場の施設は選択肢から除外される', () => {
  test('一般職場と自分の場の両方に農場がある場合、一般職場の農場を使う', () => {
    const cpu = makePlayer({
      workers: [makeWorker(0), makeWorker(0)],
      hand: [makeConsumptionCard(), makeConsumptionCard(), makeConsumptionCard()],
      ownedBuildings: [makeOwnedBuilding('農場')],
      money: 20,
      cpuStrategy: 'random',
    })
    const state = makeState([cpu, makeHumanGuard()], {
      publicWorkplaces: [
        makePublicWorkplace('農場', { kind: 'draw-consumption', n: 2 }),
      ],
    })

    const result = cpuOneTurnStep(state).state

    expect(usedPublicWorkplace(state, result)).toBe('農場')
    expect(usedOwnedBuilding(state, result, 0)).toBeNull()
  })

  test('一般職場と自分の場の両方に製鉄所がある場合、一般職場の製鉄所を使う', () => {
    const cpu = makePlayer({
      workers: [makeWorker(0), makeWorker(0)],
      hand: [makeConsumptionCard(), makeConsumptionCard(), makeConsumptionCard()],
      ownedBuildings: [makeOwnedBuilding('製鉄所')],
      money: 20,
      cpuStrategy: 'random',
    })
    const state = makeState([cpu, makeHumanGuard()], {
      publicWorkplaces: [
        makePublicWorkplace('製鉄所', { kind: 'draw', n: 3 }),
      ],
    })

    const result = cpuOneTurnStep(state).state

    expect(usedPublicWorkplace(state, result)).toBe('製鉄所')
    expect(usedOwnedBuilding(state, result, 0)).toBeNull()
  })
})

// MCTS はシミュレーション内で全プレイヤーを greedy 化して完走させるため、
// テスト状態を round=9・相手ワーカー配置済みにする。
// こうすることで CPU が1手置いた時点で allPlaced=true → processRoundEnd(round9) → game-over となり
// スタックオーバーフローを回避できる。
describe('mcts: 同名施設があれば自分の場の施設は選択肢から除外される', () => {
  // ラウンド9用ヒューマンガード: ワーカー配置済み（シミュレーション内でも動かない）
  function makeHumanGuardPlaced(): Player {
    return makePlayer({
      id: 1,
      name: 'Human',
      isCpu: false,
      cpuStrategy: 'random',
      money: 20,
      hand: [],
      ownedBuildings: [],
      workers: [makeWorker(1, { placedAt: 'dummy' })],
    })
  }

  test('一般職場と自分の場の両方に農場がある場合、一般職場の農場を使う', () => {
    const cpu = makePlayer({
      workers: [makeWorker(0)],
      hand: [makeConsumptionCard(), makeConsumptionCard(), makeConsumptionCard()],
      ownedBuildings: [makeOwnedBuilding('農場')],
      money: 20,
      cpuStrategy: 'mcts',
    })
    const state = makeState([cpu, makeHumanGuardPlaced()], {
      round: 9,
      publicWorkplaces: [
        makePublicWorkplace('農場', { kind: 'draw-consumption', n: 2 }),
      ],
    })

    const result = cpuOneTurnStep(state).state

    expect(usedPublicWorkplace(state, result)).toBe('農場')
    expect(usedOwnedBuilding(state, result, 0)).toBeNull()
  })

  test('一般職場と自分の場の両方に製鉄所がある場合、一般職場の製鉄所を使う', () => {
    const cpu = makePlayer({
      workers: [makeWorker(0)],
      hand: [makeConsumptionCard(), makeConsumptionCard(), makeConsumptionCard()],
      ownedBuildings: [makeOwnedBuilding('製鉄所')],
      money: 20,
      cpuStrategy: 'mcts',
    })
    const state = makeState([cpu, makeHumanGuardPlaced()], {
      round: 9,
      publicWorkplaces: [
        makePublicWorkplace('製鉄所', { kind: 'draw', n: 3 }),
      ],
    })

    const result = cpuOneTurnStep(state).state

    expect(usedPublicWorkplace(state, result)).toBe('製鉄所')
    expect(usedOwnedBuilding(state, result, 0)).toBeNull()
  })
})
