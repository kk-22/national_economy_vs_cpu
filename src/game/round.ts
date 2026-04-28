import { BUILDING_CARDS, ROUND_CARDS } from './constants'
import { getPlayer, updatePlayer, addLog, genId } from './primitives'
import type { GameState, BuildingCard, PublicWorkplace, Player, ScoreResult } from './types'

// Circular dep with turns.ts (processCpuTurns calls processRoundEnd; processRoundEnd/startNextRound call processCpuTurns)
// Safe: all are function defs, no top-level calls
import { processCpuTurns } from './turns'

export function flipRoundCard(state: GameState, round: number, playerCount: number): GameState {
  const roundCard = ROUND_CARDS[round - 1]
  let s = state
  const newWorkplaces: PublicWorkplace[] = []

  for (const wp of roundCard.workplaces) {
    const count = wp.count(playerCount)
    for (let i = 0; i < count; i++) {
      let id: string
      ;[s, id] = genId(s, `wp-`)
      newWorkplaces.push({
        id,
        name: wp.name,
        effect: wp.effect,
        allowMultiple: wp.allowMultiple,
        workerIds: [],
      })
    }
  }

  return { ...s, publicWorkplaces: [...s.publicWorkplaces, ...newWorkplaces] }
}

export function getHandLimit(player: Player): number {
  let limit = 5
  for (const b of player.ownedBuildings) {
    const effect = BUILDING_CARDS[b.name]?.effect
    if (effect?.kind === 'p-hand-limit') limit += effect.n
  }
  return limit
}

export function processRoundEnd(state: GameState, noCpu = false): GameState {
  let s = addLog(state, `--- ラウンド ${state.round} 終了 ---`)
  const wage = ROUND_CARDS[state.round - 1].wage

  for (const player of s.players) {
    const totalWage = player.workers.length * wage
    s = addLog(s, `${player.name}: 賃金 $${totalWage} (労働者${player.workers.length}人 × $${wage})`)

    let remaining = totalWage
    let playerMoney = getPlayer(s, player.id).money

    if (playerMoney >= remaining) {
      s = updatePlayer(s, player.id, p => ({ ...p, money: p.money - remaining }))
      s = { ...s, household: s.household + remaining }
    } else {
      remaining -= playerMoney
      s = updatePlayer(s, player.id, p => ({ ...p, money: 0 }))
      s = { ...s, household: s.household + playerMoney }

      const sellable = getPlayer(s, player.id).ownedBuildings
        .filter(b => BUILDING_CARDS[b.name]?.canSell)
        .sort((a, b) => (BUILDING_CARDS[b.name]?.assetValue ?? 0) - (BUILDING_CARDS[a.name]?.assetValue ?? 0))

      for (const b of sellable) {
        if (remaining <= 0) break
        const def = BUILDING_CARDS[b.name]!
        const value = def.assetValue
        if (value <= remaining || sellable.filter(sb => sb.id !== b.id).reduce((sum, sb) => sum + (BUILDING_CARDS[sb.name]?.assetValue ?? 0), 0) < remaining) {
          s = updatePlayer(s, player.id, p => ({
            ...p,
            money: p.money + value,
            ownedBuildings: p.ownedBuildings.filter(ob => ob.id !== b.id),
          }))
          if (def.isWorkplace) {
            let wpId: string
            ;[s, wpId] = genId(s, 'wp-sold-')
            const wp: PublicWorkplace = { id: wpId, name: b.name, effect: def.effect, allowMultiple: false, workerIds: [] }
            s = { ...s, publicWorkplaces: [...s.publicWorkplaces, wp] }
          }
          s = addLog(s, `${player.name} が ${b.name} を $${value} で売却`)
          remaining -= value
          const newMoney = getPlayer(s, player.id).money
          if (newMoney >= remaining) {
            s = updatePlayer(s, player.id, p => ({ ...p, money: p.money - remaining }))
            s = { ...s, household: s.household + remaining }
            remaining = 0
          } else {
            remaining -= newMoney
            s = updatePlayer(s, player.id, p => ({ ...p, money: 0 }))
            s = { ...s, household: s.household + newMoney }
          }
        }
      }

      if (remaining > 0) {
        s = updatePlayer(s, player.id, p => ({ ...p, unpaidWages: p.unpaidWages + remaining }))
        s = addLog(s, `${player.name} が未払い賃金 ${remaining} 枚受け取り`)
      }
    }
  }

  // CPU players: auto-discard excess hand cards
  for (const player of s.players) {
    if (!player.isCpu) continue
    const p = getPlayer(s, player.id)
    const limit = getHandLimit(p)
    if (p.hand.length <= limit) continue
    const excess = p.hand.length - limit
    const sorted = [...p.hand].sort((a, b) => {
      if (a.kind === 'consumption' && b.kind !== 'consumption') return -1
      if (b.kind === 'consumption' && a.kind !== 'consumption') return 1
      return 0
    })
    const toDiscard = sorted.slice(0, excess)
    const discardSet = new Set(toDiscard.map(c => c.id))
    const discardedBuildings = toDiscard.filter(c => c.kind === 'building') as BuildingCard[]
    s = updatePlayer(s, player.id, pl => ({ ...pl, hand: pl.hand.filter(c => !discardSet.has(c.id)) }))
    s = { ...s, discardPile: [...s.discardPile, ...discardedBuildings] }
    s = addLog(s, `${player.name} が手札上限（${limit}枚）超過のため ${excess} 枚捨て`)
  }

  // Human player: prompt if needed
  for (const player of s.players) {
    if (player.isCpu) continue
    const p = getPlayer(s, player.id)
    const limit = getHandLimit(p)
    if (p.hand.length <= limit) continue
    const excess = p.hand.length - limit
    s = addLog(s, `${player.name} の手札が上限（${limit}枚）を超えています。${excess}枚捨ててください`)
    s = { ...s, pendingAction: { kind: 'choose-hand-limit', playerId: player.id, limit, count: excess, selected: [], noCpu } }
    return s
  }

  return startNextRound(s, noCpu)
}

export function startNextRound(state: GameState, noCpu: boolean): GameState {
  let s = state

  if (s.round >= 9) {
    s = { ...s, phase: 'game-over' }
    s = addLog(s, '=== ゲーム終了 ===')
    return s
  }

  const nextRound = s.round + 1
  const playerCount = s.players.length

  for (const player of s.players) {
    const burnBuilding = player.ownedBuildings.find(b => b.name === '焼畑' && b.workerHereId !== null)
    if (burnBuilding) {
      s = updatePlayer(s, player.id, p => ({
        ...p,
        ownedBuildings: p.ownedBuildings.filter(ob => ob.id !== burnBuilding.id),
      }))
      s = addLog(s, `${player.name} の焼畑が消滅しました`)
    }
  }

  s = {
    ...s,
    players: s.players.map(p => ({
      ...p,
      workers: p.workers.map(w => ({ ...w, isTraining: false, placedAt: null })),
      ownedBuildings: p.ownedBuildings.map(b => ({ ...b, workerHereId: null })),
    })),
    publicWorkplaces: s.publicWorkplaces.map(wp => ({ ...wp, workerIds: [] })),
  }

  s = { ...s, round: nextRound }
  s = flipRoundCard(s, nextRound, playerCount)
  s = addLog(s, `--- ラウンド ${nextRound} 開始 (賃金 $${ROUND_CARDS[nextRound - 1].wage}) ---`)

  s = { ...s, currentPlayerIndex: s.startPlayerIndex }

  if (!noCpu) s = processCpuTurns(s)
  return s
}

export function calculateScores(state: GameState): ScoreResult[] {
  return state.players.map(player => {
    const buildingValue = player.ownedBuildings.reduce((sum, b) => sum + (BUILDING_CARDS[b.name]?.assetValue ?? 0), 0)

    let bonuses = 0
    for (const b of player.ownedBuildings) {
      const effect = BUILDING_CARDS[b.name]?.effect
      if (!effect) continue
      switch (effect.kind) {
        case 'p-per-building':
          bonuses += effect.pts * player.ownedBuildings.length
          break
        case 'p-per-consumption':
          bonuses += effect.pts * player.hand.filter(c => c.kind === 'consumption').length
          break
        case 'p-per-worker':
          bonuses += effect.pts * player.workers.length
          break
        case 'p-per-factory':
          bonuses += effect.pts * player.ownedBuildings.filter(ob => BUILDING_CARDS[ob.name]?.tags.includes('factory')).length
          break
        case 'p-per-no-sell':
          bonuses += effect.pts * player.ownedBuildings.filter(ob => !BUILDING_CARDS[ob.name]?.canSell).length
          break
      }
    }

    const hasForgive = player.ownedBuildings.some(b => BUILDING_CARDS[b.name]?.effect.kind === 'p-forgive-wages')
    const forgivenWages = hasForgive ? Math.min(player.unpaidWages, 5) : 0
    const unpaidPenalty = (player.unpaidWages - forgivenWages) * 3

    return {
      playerId: player.id,
      buildingValue,
      money: player.money,
      unpaidPenalty,
      bonuses,
      total: buildingValue + player.money + bonuses - unpaidPenalty,
    }
  })
}
