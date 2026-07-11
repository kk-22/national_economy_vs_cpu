/**
 * round.wages.test.ts
 * ラウンド終了時の賃金精算・建物自動売却ロジックのテスト。
 * processWagesCash / autoSellForWages / findSellOptions / cpuBestSellOption を
 * processRoundEnd / confirmSellBuildings 経由で検証する。
 */

import { describe, test, expect, beforeEach } from 'vitest'
import { processRoundEnd, confirmSellBuildings } from '../round'
import {
  resetIds,
  makePlayer,
  makeState,
  makeOwnedBuilding,
} from './helpers'

beforeEach(() => { resetIds() })

// ラウンド1の賃金は $2/人。デフォルトのworkers=2人なので totalWage = $4。

describe('CPU: 建物売却による賃金精算', () => {
  test('売却可能な建物1つで不足分を賄える → 自動売却され、余りはmoneyに残る', () => {
    const player = makePlayer({ id: 0, isCpu: true, money: 0, ownedBuildings: [makeOwnedBuilding('農場')] })
    const state = makeState([player], { round: 1, household: 0 })

    const result = processRoundEnd(state, true)
    const p = result.players[0]

    expect(p.ownedBuildings).toHaveLength(0)
    expect(p.money).toBe(2) // 農場(assetValue 6) - 賃金4 = 2
    expect(p.unpaidWages).toBe(0)
    expect(result.household).toBe(4)
    expect(result.publicWorkplaces.some(wp => wp.kind === 'sold' && wp.name === '農場')).toBe(true)
  })

  test('売却可能な建物がない・資金もない → 未払い賃金として記録される', () => {
    const player = makePlayer({ id: 0, isCpu: true, money: 0, ownedBuildings: [makeOwnedBuilding('焼畑')] })
    const state = makeState([player], { round: 1, household: 0 })

    const result = processRoundEnd(state, true)
    const p = result.players[0]

    expect(p.ownedBuildings).toHaveLength(1) // 焼畑は canSell:false のため売却されない
    expect(p.money).toBe(0)
    expect(p.unpaidWages).toBe(4)
    expect(result.household).toBe(0)
  })

  test('複数の売却候補がある場合、売却総額が最小になる建物を選ぶ（高価な建物を残す）', () => {
    const cheap = makeOwnedBuilding('農場')    // assetValue 6
    const expensive = makeOwnedBuilding('工場') // assetValue 12
    const player = makePlayer({ id: 0, isCpu: true, money: 0, ownedBuildings: [cheap, expensive] })
    const state = makeState([player], { round: 1, household: 0 })

    const result = processRoundEnd(state, true)
    const p = result.players[0]

    expect(p.ownedBuildings.map(b => b.id)).toEqual([expensive.id])
    expect(p.money).toBe(2) // 農場(6) - 賃金4 = 2
  })
})

describe('人間: 建物売却による賃金精算', () => {
  test('売却候補が1通りしかない場合は自動確定される（pendingActionは出ない）', () => {
    const player = makePlayer({ id: 0, isCpu: false, money: 0, ownedBuildings: [makeOwnedBuilding('農場')] })
    const state = makeState([player], { round: 1, household: 0 })

    const result = processRoundEnd(state, true)
    const p = result.players[0]

    expect(result.pendingAction).toBeNull()
    expect(p.ownedBuildings).toHaveLength(0)
    expect(p.money).toBe(2)
    expect(result.household).toBe(4)
  })

  test('売却候補が複数ある場合は choose-sell-buildings の pendingAction が設定される', () => {
    const b1 = makeOwnedBuilding('農場')
    const b2 = makeOwnedBuilding('農場')
    const player = makePlayer({ id: 0, isCpu: false, money: 0, ownedBuildings: [b1, b2] })
    const state = makeState([player], { round: 1, household: 0 })

    const result = processRoundEnd(state, true)

    expect(result.pendingAction?.kind).toBe('choose-sell-buildings')
    if (result.pendingAction?.kind === 'choose-sell-buildings') {
      expect(result.pendingAction.deficit).toBe(4)
      expect([...result.pendingAction.sellableIds].sort()).toEqual([b1.id, b2.id].sort())
    }
  })

  test('confirmSellBuildings で選択した建物のみが売却される', () => {
    const b1 = makeOwnedBuilding('農場')
    const b2 = makeOwnedBuilding('農場')
    const player = makePlayer({ id: 0, isCpu: false, money: 0, ownedBuildings: [b1, b2] })
    const state = makeState([player], { round: 1, household: 0 })

    const pending = processRoundEnd(state, true)
    const result = confirmSellBuildings(pending, [b1.id])
    const p = result.players[0]

    expect(p.ownedBuildings.map(b => b.id)).toEqual([b2.id])
    expect(p.money).toBe(2)
    expect(result.household).toBe(4)
    expect(result.pendingAction).toBeNull()
  })

  test('全部売っても足りない場合は自動的に全売却したうえで未払い賃金が記録される（即時確定、pendingActionなし）', () => {
    const player = makePlayer({
      id: 0,
      isCpu: false,
      money: 0,
      ownedBuildings: [makeOwnedBuilding('焼畑')],
    })
    const state = makeState([player], { round: 1, household: 0 })

    const result = processRoundEnd(state, true)
    const p = result.players[0]

    expect(p.ownedBuildings).toHaveLength(1) // 焼畑は canSell:false のため売却されない
    expect(p.unpaidWages).toBe(4)
  })
})
