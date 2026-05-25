import { ROUND_CARDS } from './constants'
import { getPlayer, updatePlayer, addLog, genId, ALL_BUILDING_CARDS } from './primitives'
import type { GameState, BuildingCard, PublicWorkplace, Player, ScoreResult, OwnedBuilding } from './types'

// Circular dep with turns.ts (processCpuTurns calls processRoundEnd; processRoundEnd/startNextRound call processCpuTurns)
// Safe: all are function defs, no top-level calls
import { processCpuTurns } from './turns'

export function flipRoundCard(state: GameState, round: number, playerCount: number): GameState {
  const roundCard = ROUND_CARDS[round - 1]
  let s = state
  const newWorkplaces: PublicWorkplace[] = []

  for (const wp of roundCard.workplaces) {
    const count = wp.count(playerCount)
    const allowMultiple = typeof wp.allowMultiple === 'function' ? wp.allowMultiple(playerCount) : wp.allowMultiple
    for (let i = 0; i < count; i++) {
      let id: string
      ;[s, id] = genId(s, `wp-`)
      newWorkplaces.push({
        id,
        kind: 'round',
        name: wp.name,
        effect: wp.effect,
        allowMultiple,
        workerIds: [],
      })
    }
  }

  return { ...s, publicWorkplaces: [...s.publicWorkplaces, ...newWorkplaces] }
}

export function getHandLimit(player: Player): number {
  let limit = 5
  for (const b of player.ownedBuildings) {
    const effect = ALL_BUILDING_CARDS[b.name]?.effect
    if (effect?.kind === 'p-hand-limit') limit += effect.n
  }
  return limit
}

// ---- 建物売却ヘルパー ----

// 不足分を補える建物の最小充足部分集合をすべて列挙する
function findSellOptions(sellable: OwnedBuilding[], deficit: number): string[][] {
  const n = sellable.length
  if (n === 0 || deficit <= 0) return []
  const values = sellable.map(b => ALL_BUILDING_CARDS[b.name]?.assetValue ?? 0)
  const totalAvailable = values.reduce((a, b) => a + b, 0)
  if (totalAvailable < deficit) return [] // 全部売っても足りない

  const minimal: string[][] = []
  for (let mask = 1; mask < (1 << n); mask++) {
    let sum = 0
    for (let i = 0; i < n; i++) if ((mask >> i) & 1) sum += values[i]
    if (sum < deficit) continue

    // この部分集合の真部分集合が既に充足できるなら最小でない
    let isMinimal = true
    for (let sub = (mask - 1) & mask; sub > 0; sub = (sub - 1) & mask) {
      let subSum = 0
      for (let i = 0; i < n; i++) if ((sub >> i) & 1) subSum += values[i]
      if (subSum >= deficit) { isMinimal = false; break }
    }
    if (isMinimal) minimal.push(sellable.filter((_, i) => (mask >> i) & 1).map(b => b.id))
  }
  return minimal
}

// CPU: 売却総額が最小、同値なら高価な建物を残す方を選ぶ
function cpuBestSellOption(options: string[][], sellable: OwnedBuilding[]): string[] {
  const valueMap = new Map(sellable.map(b => [b.id, ALL_BUILDING_CARDS[b.name]?.assetValue ?? 0]))
  const allIds = sellable.map(b => b.id)
  return options.reduce((best, opt) => {
    const bestSold = best.reduce((s, id) => s + (valueMap.get(id) ?? 0), 0)
    const optSold  = opt.reduce((s, id) => s + (valueMap.get(id) ?? 0), 0)
    if (optSold < bestSold) return opt
    if (optSold > bestSold) return best
    // 売却額が同じ → 残す建物の価値が高い方を選ぶ
    const kept = (ids: string[]) => allIds.filter(id => !ids.includes(id))
                                         .map(id => valueMap.get(id) ?? 0)
                                         .sort((a, b) => b - a)
    const bk = kept(best), ok = kept(opt)
    for (let i = 0; i < Math.max(bk.length, ok.length); i++) {
      if ((ok[i] ?? 0) > (bk[i] ?? 0)) return opt
      if ((ok[i] ?? 0) < (bk[i] ?? 0)) return best
    }
    return best
  })
}

// 指定した建物IDを売却し、その収益で賃金を支払う
function autoSellForWages(state: GameState, playerId: number, idsToSell: string[], remaining: number): GameState {
  let s = state
  const buildings = getPlayer(s, playerId).ownedBuildings.filter(b => idsToSell.includes(b.id))
  for (const b of buildings) {
    const def = ALL_BUILDING_CARDS[b.name]!
    s = updatePlayer(s, playerId, p => ({
      ...p, money: p.money + def.assetValue,
      ownedBuildings: p.ownedBuildings.filter(ob => ob.id !== b.id),
    }))
    if (def.isWorkplace) {
      let wpId: string
      ;[s, wpId] = genId(s, 'wp-sold-')
      s = { ...s, publicWorkplaces: [...s.publicWorkplaces, { id: wpId, kind: 'sold', name: b.name, effect: def.effect, allowMultiple: false, workerIds: [] }] }
    }
    s = addLog(s, `${getPlayer(s, playerId).name} が ${b.name} を $${def.assetValue} で売却`)
  }
  const canPay = Math.min(getPlayer(s, playerId).money, remaining)
  s = updatePlayer(s, playerId, p => ({ ...p, money: p.money - canPay }))
  s = { ...s, household: s.household + canPay }
  const stillOwed = remaining - canPay
  if (stillOwed > 0) {
    s = updatePlayer(s, playerId, p => ({ ...p, unpaidWages: p.unpaidWages + stillOwed }))
    s = addLog(s, `${getPlayer(s, playerId).name} 未払い賃金 $${stillOwed}`)
  }
  return s
}

// ---- ラウンド終了処理 ----

export function processRoundEnd(state: GameState, noCpu = false): GameState {
  let s = addLog(state, `--- ラウンド ${state.round} 終了 (家計 $${state.household}) ---`)
  s = processWagesCash(s)
  return finishRoundEnd(s, noCpu)
}

// 全プレイヤーの現金払い・CPU建物売却を行う（人間の建物売却は _pendingWageDeficit に記録して後回し）
function processWagesCash(state: GameState): GameState {
  const wage = ROUND_CARDS[state.round - 1].wage
  let s = state

  for (const player of s.players) {
    const totalWage = player.workers.length * wage
    let remaining = totalWage
    const playerMoney = getPlayer(s, player.id).money
    let deferred = false

    if (playerMoney >= remaining) {
      s = updatePlayer(s, player.id, p => ({ ...p, money: p.money - remaining }))
      s = { ...s, household: s.household + remaining }
    } else {
      remaining -= playerMoney
      s = updatePlayer(s, player.id, p => ({ ...p, money: 0 }))
      s = { ...s, household: s.household + playerMoney }

      const sellable = getPlayer(s, player.id).ownedBuildings
        .filter(b => ALL_BUILDING_CARDS[b.name]?.canSell)

      if (!player.isCpu) {
        const totalSellable = sellable.reduce((sum, b) => sum + (ALL_BUILDING_CARDS[b.name]?.assetValue ?? 0), 0)
        if (totalSellable >= remaining) {
          // 手札上限処理の後で建物売却を行うため記録
          s = { ...s, _pendingWageDeficit: { playerId: player.id, deficit: remaining } }
          deferred = true
        } else {
          s = autoSellForWages(s, player.id, sellable.map(b => b.id), remaining)
        }
      } else {
        const options = findSellOptions(sellable, remaining)
        const idsToSell = options.length === 0
          ? sellable.map(b => b.id)
          : options.length === 1
            ? options[0]
            : cpuBestSellOption(options, sellable)
        s = autoSellForWages(s, player.id, idsToSell, remaining)
      }
    }

    if (!deferred) {
      const p = getPlayer(s, player.id)
      s = addLog(s, `${p.name}: 労働者${player.workers.length}人の賃金 $${totalWage}→残り$${p.money}`)
    }
  }

  return s
}

// 手札上限チェック → resolveAfterHandLimit の順に処理
function finishRoundEnd(state: GameState, noCpu: boolean): GameState {
  let s = state

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
    s = addLog(s, `${player.name} が手札超過${p.hand.length}→${limit}枚`)
  }

  // Human player: prompt if needed
  for (const player of s.players) {
    if (player.isCpu) continue
    const p = getPlayer(s, player.id)
    const limit = getHandLimit(p)
    if (p.hand.length <= limit) continue
    const excess = p.hand.length - limit
    const preSelected = p.hand.filter(c => c.kind === 'consumption').slice(0, excess - 1).map(c => c.id)
    s = { ...s, pendingAction: { kind: 'choose-hand-limit', playerId: player.id, limit, count: excess, selected: preSelected, noCpu } }
    return s
  }

  return resolveAfterHandLimit(s, noCpu)
}

// 手札上限処理完了後（またはスキップ後）の建物売却チェック → 次ラウンド開始
// turns.ts の confirmHandLimitDiscard からも呼ばれる
export function resolveAfterHandLimit(state: GameState, noCpu: boolean): GameState {
  let s = state
  if (s._pendingWageDeficit) {
    const { playerId, deficit } = s._pendingWageDeficit
    s = { ...s, _pendingWageDeficit: undefined }
    const sellable = getPlayer(s, playerId).ownedBuildings
      .filter(b => ALL_BUILDING_CARDS[b.name]?.canSell)
    const totalSellable = sellable.reduce((sum, b) => sum + (ALL_BUILDING_CARDS[b.name]?.assetValue ?? 0), 0)
    if (totalSellable >= deficit) {
      const options = findSellOptions(sellable, deficit)
      if (options.length === 1) {
        s = autoSellForWages(s, playerId, options[0], deficit)
        const wage = ROUND_CARDS[s.round - 1].wage
        const p = getPlayer(s, playerId)
        s = addLog(s, `${p.name}: 労働者${p.workers.length}人の賃金 $${p.workers.length * wage}→残り$${p.money}`)
        return startNextRound(s, noCpu)
      }
      return {
        ...s,
        pendingAction: { kind: 'choose-sell-buildings', playerId, deficit, sellableIds: sellable.map(b => b.id), selected: [], noCpu },
      }
    }
    s = autoSellForWages(s, playerId, sellable.map(b => b.id), deficit)
  }
  return startNextRound(s, noCpu)
}

// 人間プレイヤーが売却建物を選択・確定後に呼ばれる
export function confirmSellBuildings(state: GameState, selectedIds: string[]): GameState {
  const pa = state.pendingAction
  if (!pa || pa.kind !== 'choose-sell-buildings') return state
  const { playerId, deficit, noCpu } = pa
  let s: GameState = { ...state, pendingAction: null }
  s = autoSellForWages(s, playerId, selectedIds, deficit)
  const wage = ROUND_CARDS[s.round - 1].wage
  const p = getPlayer(s, playerId)
  s = addLog(s, `${p.name}: 労働者${p.workers.length}人の賃金 $${p.workers.length * wage}→残り$${p.money}`)
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

  // 醸造所の storedConsumption を手札に加える（次ラウンド開始時）
  for (const player of s.players) {
    for (const b of player.ownedBuildings) {
      if (b.storedConsumption && b.storedConsumption > 0) {
        const count = b.storedConsumption
        s = updatePlayer(s, player.id, p => ({
          ...p,
          ownedBuildings: p.ownedBuildings.map(ob => ob.id === b.id ? { ...ob, storedConsumption: 0 } : ob),
        }))
        for (let i = 0; i < count; i++) {
          let cId: string
          ;[s, cId] = genId(s, 'c-')
          s = updatePlayer(s, player.id, p => ({
            ...p,
            hand: [...p.hand, { kind: 'consumption' as const, id: cId }],
          }))
        }
        s = addLog(s, `${getPlayer(s, player.id).name} の醸造所から消費財${count}枚を手札に加えた`)
      }
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
  s = addLog(s, `■■ラウンド ${nextRound} 開始 (家計 $${s.household}) ■■`)

  s = { ...s, currentPlayerIndex: s.startPlayerIndex }

  if (!noCpu) s = processCpuTurns(s)
  return s
}

export function calculateScores(state: GameState): ScoreResult[] {
  return state.players.map(player => {
    let buildingValue = player.ownedBuildings.reduce((sum, b) => sum + (ALL_BUILDING_CARDS[b.name]?.assetValue ?? 0), 0)

    let bonuses = 0
    const noSellCount = player.ownedBuildings.filter(ob => !ALL_BUILDING_CARDS[ob.name]?.canSell).length
    const farmCount = player.ownedBuildings.filter(ob => ALL_BUILDING_CARDS[ob.name]?.tags.includes('farm')).length

    for (const b of player.ownedBuildings) {
      const effect = ALL_BUILDING_CARDS[b.name]?.effect
      if (!effect) continue
      switch (effect.kind) {
        // プログレス系
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
          bonuses += effect.pts * player.ownedBuildings.filter(ob => ALL_BUILDING_CARDS[ob.name]?.tags.includes('factory')).length
          break
        case 'p-per-no-sell':
          bonuses += effect.pts * noSellCount
          break
        // メセナ系：終了時条件付きボーナス（資産価値に加算）
        case 'p-if-empty-hand':
          if (player.hand.length === 0) buildingValue += effect.bonus
          break
        case 'p-if-own-n-buildings':
          if (player.ownedBuildings.length >= effect.threshold) buildingValue += effect.bonus
          break
        case 'p-if-tag-n':
          if (effect.tag === 'farm' && farmCount >= effect.threshold) buildingValue += effect.bonus
          else if (effect.tag === 'factory' && player.ownedBuildings.filter(ob => ALL_BUILDING_CARDS[ob.name]?.tags.includes('factory')).length >= effect.threshold) buildingValue += effect.bonus
          break
        case 'p-if-no-sell-n':
          if (noSellCount >= effect.threshold) buildingValue += effect.bonus
          break
      }
    }

    const forgiveBuilding = player.ownedBuildings.find(b => ALL_BUILDING_CARDS[b.name]?.effect.kind === 'p-forgive-wages')
    const forgiveMax = forgiveBuilding ? (ALL_BUILDING_CARDS[forgiveBuilding.name].effect as { kind: 'p-forgive-wages'; max: number }).max : 0
    const forgivenWages = Math.min(player.unpaidWages, forgiveMax)
    const unpaidPenalty = (player.unpaidWages - forgivenWages) * 3

    // 勝利点計算: floor(n/3)*10 + (n%3)*1。会計事務所所有で2倍
    const vp = player.victoryPoints
    const baseVpScore = Math.floor(vp / 3) * 10 + (vp % 3) * 1
    const hasKaikei = player.ownedBuildings.some(b => ALL_BUILDING_CARDS[b.name]?.effect.kind === 'p-vp-double')
    const vpScore = hasKaikei ? baseVpScore * 2 : baseVpScore

    return {
      playerId: player.id,
      money: player.money,
      buildingValue,
      bonuses,
      unpaidPenalty,
      workerCount: player.workers.length,
      actionsPlaced: 0,
      victoryPoints: vp,
      vpScore,
      total: buildingValue + player.money + bonuses + vpScore - unpaidPenalty,
    }
  })
}
