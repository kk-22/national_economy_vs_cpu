import { shallowReactive, computed, ref, toRaw } from 'vue'
import type { GameConfig, GameSeries, GameState } from '../game/types'
import { createGame, createDebugGame } from '../game/init'
import { calculateScores, confirmSellBuildings, processRoundEnd } from '../game/round'
import { getAvailablePublicWorkplaces, getAvailableOwnedBuildings } from '../game/availability'
import {
  placeWorkerOnPublic, placeWorkerOnBuilding,
  cpuOneTurnStep, consumeLastCpuNoAutoTarget, skipEmptyPlayerTurn, setDeferRoundEnd,
  selectFarmBuildTarget, confirmBuildPayment, confirmDoublePayment,
  confirmDiscard, confirmDiscardDraw, pickRevealedCard, confirmHandLimitDiscard,
  selectBuildTwoFirstCard, selectBuildTwoSecondCard, confirmBuildTwoCards, confirmFreeBuildCard, selectNoSellBuildCard,
} from '../game/turns'
import {
  selectBuildTarget, selectDoubleFirst, selectDoubleSecond,
  cancelBuildChoice, cancelBuildPayment, cancelDoubleSecond, cancelDoublePayment,
  cancelBuildTwoPayment,
  getBuildableCards, getFarmBuildableCards, getDoubleBuildableFirstCards,
  getNoSellBuildableCards, getFreeBuildableCards,
  getBuildTwoFirstCards,
} from '../game/build'
import { toggleDiscardSelection, cancelDiscardChoice, toggleHandLimitSelection } from '../game/resolution'
import { availableWorkers, ALL_BUILDING_CARDS } from '../game/primitives'
import { ROUND_CARDS } from '../game/constants'
import { GameHistory } from '../game/history'
import type { HistoryEntry } from '../game/history'
import { replayToIndex } from '../game/replay'

const SAVE_KEY = 'ne-game-save'

const state = shallowReactive<{ game: GameState | null }>({ game: null })
let history = new GameHistory(1)
let pendingEntry: HistoryEntry | null = null
const isUndoRedo = ref(false)
const replayError = ref<string | null>(null)
const cpuPaused = ref(false)
const historyVersion = ref(0)  // incremented after each history mutation to drive canUndo/canRedo reactivity

export function useGame() {

  function saveGameState(): void {
    if (!state.game) return
    try {
      const data = { game: toRaw(state.game), history: history.toObject() }
      localStorage.setItem(SAVE_KEY, JSON.stringify(data))
    } catch { /* quota超過などは無視 */ }
  }

  function hasSavedGame(): boolean {
    try {
      const raw = localStorage.getItem(SAVE_KEY)
      if (!raw) return false
      const data = JSON.parse(raw)
      return !!data?.game
    } catch { return false }
  }

  function restoreGame(): boolean {
    try {
      const raw = localStorage.getItem(SAVE_KEY)
      if (!raw) return false
      const data = JSON.parse(raw)
      if (!data?.game) return false
      state.game = data.game as GameState
      if (data.history) {
        history = GameHistory.fromObject(data.history)
      } else {
        history = new GameHistory((data.game as GameState)._rngSeed)
      }
      if (!history.initialState) {
        history.setInitialState(toRaw(state.game))
      }
      historyVersion.value++
      pendingEntry = null
      cpuPaused.value = false
      return true
    } catch { return false }
  }

  function clearSavedGame(): void {
    localStorage.removeItem(SAVE_KEY)
  }

  function startGame(config: GameConfig) {
    clearSavedGame()
    state.game = createGame(config)
    history = new GameHistory(state.game._rngSeed)
    history.setInitialState(toRaw(state.game))
    pendingEntry = null
    cpuPaused.value = false
    historyVersion.value++
  }

  function startDebugGame(cpuCount: number = 3, series: GameSeries = 'progress', playerOrder: number = 1) {
    clearSavedGame()
    state.game = createDebugGame(cpuCount, series, playerOrder)
    history = new GameHistory(state.game._rngSeed)
    history.setInitialState(toRaw(state.game))
    pendingEntry = null
    cpuPaused.value = false
    historyVersion.value++
  }

  // 安全策: プレイヤーのターンなのにワーカーが0のとき自動スキップ
  function autoAdvanceIfStuck() {
    if (!state.game) return
    state.game = skipEmptyPlayerTurn(state.game)
  }

  // バッチ実行（スキップモード用）— 1ステップずつ history に記録する
  function runCpuTurns() {
    if (!state.game || state.game.phase !== 'placement') return
    if (state.game.pendingAction) return
    const firstCurrent = state.game.players[state.game.currentPlayerIndex]
    if (!firstCurrent?.isCpu) return

    let maxSteps = 500  // 安全上限
    while (maxSteps-- > 0) {
      if (!state.game || state.game.phase !== 'placement' || state.game.pendingAction) break
      const curr = state.game.players[state.game.currentPlayerIndex]
      if (!curr?.isCpu) break

      // ワーカーを置くステップのみ history に記録（turn advance は記録しない）
      const hadWorkers = availableWorkers(curr).length > 0
      if (hadWorkers) {
        const entry: HistoryEntry = { playerId: curr.id, targetId: '__cpu__', targetName: curr.name, timestamp: Date.now() }
        history.push(entry)
        historyVersion.value++
        const next = cpuOneTurnStep(state.game)
        if (next === state.game) break  // 変化なし（安全策）
        const captured = consumeLastCpuNoAutoTarget()
        if (captured) {
          entry.cpuTargetId = captured.id
          entry.cpuTargetType = captured.type
        }
        state.game = next
      } else {
        const next = cpuOneTurnStep(state.game)
        if (next === state.game) break
        state.game = next
      }
    }
  }

  // 1ステップ実行（アニメーションあり）
  function cpuStepAction() {
    if (!state.game || state.game.phase !== 'placement') return
    if (state.game.pendingAction) return  // 保留アクション中は実行しない
    const current = state.game.players[state.game.currentPlayerIndex]
    if (!current?.isCpu) return
    const hadWorkers = availableWorkers(current).length > 0
    if (hadWorkers) {
      const entry: HistoryEntry = { playerId: current.id, targetId: '__cpu__', targetName: current.name, timestamp: Date.now() }
      history.push(entry)
      historyVersion.value++
      setDeferRoundEnd(true)
      const next = cpuOneTurnStep(state.game)
      setDeferRoundEnd(false)
      const captured = consumeLastCpuNoAutoTarget()
      if (captured) {
        entry.cpuTargetId = captured.id
        entry.cpuTargetType = captured.type
      }
      state.game = next
    } else {
      const next = cpuOneTurnStep(state.game)
      if (next !== state.game) state.game = next
    }
  }

  function triggerRoundEnd() {
    if (!state.game?._pendingRoundEnd) return
    state.game = processRoundEnd({ ...state.game, _pendingRoundEnd: undefined }, true)
  }

  const game = computed(() => state.game)
  const humanPlayer = computed(() => state.game?.players.find(p => !p.isCpu) ?? null)
  const currentPlayer = computed(() => state.game ? state.game.players[state.game.currentPlayerIndex] : null)
  const isHumanTurn = computed(() => currentPlayer.value?.isCpu === false)
  const currentWage = computed(() => state.game ? ROUND_CARDS[state.game.round - 1].wage : 0)

  const availablePublicWorkplaces = computed(() => {
    if (!state.game || !isHumanTurn.value) return []
    return getAvailablePublicWorkplaces(state.game, humanPlayer.value!.id)
  })

  const availableOwnedBuildings = computed(() => {
    if (!state.game || !isHumanTurn.value) return []
    return getAvailableOwnedBuildings(state.game, humanPlayer.value!.id)
  })

  const scores = computed(() => {
    if (!state.game || state.game.phase !== 'game-over') return null
    const raw = calculateScores(state.game)
    const actionCounts = new Map<number, number>()
    for (const entry of history.actionLog) {
      if (entry.targetId !== '__hand-limit__' && entry.targetId !== '__sell__') {
        actionCounts.set(entry.playerId, (actionCounts.get(entry.playerId) ?? 0) + 1)
      }
    }
    return raw.map(sc => ({ ...sc, actionsPlaced: actionCounts.get(sc.playerId) ?? 0 }))
  })

  const pendingAction = computed(() => state.game?.pendingAction ?? null)

  const canUndo = computed(() => { historyVersion.value; return history.canUndo })
  const canRedo = computed(() => { historyVersion.value; return history.canRedo })

  function getBuildingDef(name: string) {
    return ALL_BUILDING_CARDS[name]
  }

  // Actions
  function clickPublicWorkplace(id: string) {
    if (!state.game || !isHumanTurn.value) return
    const rawGame = toRaw(state.game)
    const wp = rawGame.publicWorkplaces.find(w => w.id === id)
    if (!wp) return
    const entry: HistoryEntry = {
      playerId: humanPlayer.value!.id,
      targetId: id,
      targetName: wp.name,
      timestamp: Date.now(),
    }
    history.push(entry)
    historyVersion.value++
    pendingEntry = entry
    state.game = placeWorkerOnPublic(state.game, humanPlayer.value!.id, id)
    maybeAutoAdvance()
  }

  function maybeAutoAdvance() {
    if (!state.game) return
    const pa = state.game.pendingAction

    if (pa?.kind === 'choose-discard') {
      const hand = state.game.players.find(p => p.id === pa.playerId)?.hand ?? []
      if (hand.length === pa.count) {
        const allIds = hand.map(c => c.id)
        if (pendingEntry) {
          pendingEntry.discardedCards = hand.map(c => ({ id: c.id, name: c.kind === 'building' ? c.name : '消費財' }))
        }
        state.game = { ...state.game, pendingAction: { ...pa, selected: allIds } }
        if (pa.gainAmount === -1) {
          state.game = confirmDiscardDraw(state.game, pa.drawCount ?? 4)
        } else {
          state.game = confirmDiscard(state.game)
        }
        return
      }
    }

    if (pa?.kind === 'choose-build-target' && buildableCards.value.length === 1) {
      clickBuildTarget(buildableCards.value[0].id)
    }
  }

  function clickOwnedBuilding(id: string) {
    if (!state.game || !isHumanTurn.value) return
    const rawGame = toRaw(state.game)
    const player = rawGame.players.find(p => !p.isCpu)
    const building = player?.ownedBuildings.find(b => b.id === id)
    if (!building) return
    const entry: HistoryEntry = {
      playerId: humanPlayer.value!.id,
      targetId: id,
      targetName: building.name,
      timestamp: Date.now(),
    }
    history.push(entry)
    historyVersion.value++
    pendingEntry = entry
    state.game = placeWorkerOnBuilding(state.game, humanPlayer.value!.id, id)
    maybeAutoAdvance()
  }

  function clickBuildTarget(cardId: string) {
    if (!state.game) return
    const pa = state.game.pendingAction
    if (!pa) return
    if (pa.kind === 'choose-build-target') {
      state.game = selectBuildTarget(state.game, cardId)
      const newPa = state.game.pendingAction
      if (newPa?.kind === 'choose-build-payment') {
        if (newPa.cost === 0) {
          if (pendingEntry) {
            pendingEntry.builtCard = { id: newPa.targetId, name: newPa.targetName }
            pendingEntry.paymentCards = []
          }
          state.game = confirmBuildPayment(state.game, [])
        } else {
          const hand = state.game.players.find(p => p.id === newPa.playerId)?.hand ?? []
          const payable = hand.filter(c => c.id !== newPa.targetId)
          if (payable.length === newPa.cost) {
            const ids = payable.map(c => c.id)
            if (pendingEntry) {
              pendingEntry.builtCard = { id: newPa.targetId, name: newPa.targetName }
              pendingEntry.paymentCards = payable.map(c => ({ id: c.id, name: c.kind === 'building' ? c.name : '消費財' }))
            }
            state.game = confirmBuildPayment(state.game, ids)
          } else {
            paymentSelectedIds.value = autoSelectConsumptionIds(payable, newPa.cost)
          }
        }
      }
    }
    else if (pa.kind === 'choose-farm-build') {
      if (pendingEntry) {
        const card = toRaw(state.game).players.find(p => p.id === pa.playerId)?.hand.find(c => c.id === cardId)
        pendingEntry.builtCard = { id: cardId, name: card?.kind === 'building' ? card.name : cardId }
      }
      state.game = selectFarmBuildTarget(state.game, cardId)
    }
    else if (pa.kind === 'choose-double-first') state.game = selectDoubleFirst(state.game, cardId)
    else if (pa.kind === 'choose-double-second') {
      state.game = selectDoubleSecond(state.game, cardId)
      const newPa = state.game.pendingAction
      if (newPa?.kind === 'choose-double-payment') {
        const hand = state.game.players.find(p => p.id === newPa.playerId)?.hand ?? []
        const payable = hand.filter(c => c.id !== newPa.firstId && c.id !== newPa.secondId)
        if (payable.length === newPa.cost) {
          const ids = payable.map(c => c.id)
          if (pendingEntry) {
            const player = state.game.players.find(p => p.id === newPa.playerId)
            const findName = (id: string) => { const c = player?.hand.find(h => h.id === id); return c?.kind === 'building' ? c.name : id }
            pendingEntry.builtCard = { id: newPa.firstId, name: findName(newPa.firstId) }
            pendingEntry.secondBuiltCard = { id: newPa.secondId, name: findName(newPa.secondId) }
            pendingEntry.paymentCards = payable.map(c => ({ id: c.id, name: c.kind === 'building' ? c.name : '消費財' }))
          }
          state.game = confirmDoublePayment(state.game, ids)
        } else {
          paymentSelectedIds.value = autoSelectConsumptionIds(payable, newPa.cost)
        }
      }
    }
  }

  function clickDoubleConfirm(firstId: string, secondId: string) {
    if (!state.game) return
    state.game = selectDoubleFirst(state.game, firstId)
    state.game = selectDoubleSecond(state.game, secondId)
    const newPa = state.game.pendingAction
    if (newPa?.kind === 'choose-double-payment') {
      const hand = state.game.players.find(p => p.id === newPa.playerId)?.hand ?? []
      const payable = hand.filter(c => c.id !== newPa.firstId && c.id !== newPa.secondId)
      if (payable.length === newPa.cost) {
        const ids = payable.map(c => c.id)
        if (pendingEntry) {
          const player = state.game.players.find(p => p.id === newPa.playerId)
          const findName = (id: string) => { const c = player?.hand.find(h => h.id === id); return c?.kind === 'building' ? c.name : id }
          pendingEntry.builtCard = { id: newPa.firstId, name: findName(newPa.firstId) }
          pendingEntry.secondBuiltCard = { id: newPa.secondId, name: findName(newPa.secondId) }
          pendingEntry.paymentCards = payable.map(c => ({ id: c.id, name: c.kind === 'building' ? c.name : '消費財' }))
        }
        state.game = confirmDoublePayment(state.game, ids)
      } else {
        paymentSelectedIds.value = autoSelectConsumptionIds(payable, newPa.cost)
      }
    }
  }

  // メセナシリーズでは消費財を最低1枚残す
  function autoSelectConsumptionIds(payable: { kind: string; id: string }[], cost: number): string[] {
    const consumptions = payable.filter(c => c.kind === 'consumption')
    const maxAutoSelect = state.game?.series === 'mecenat'
      ? Math.max(0, Math.min(cost - 1, consumptions.length - 1))
      : Math.max(0, cost - 1)
    return consumptions.slice(0, maxAutoSelect).map(c => c.id)
  }

  const paymentSelectedIds = ref<string[]>([])

  function clickPaymentCard(cardId: string) {
    if (!state.game) return
    const pa = state.game.pendingAction
    if (pa?.kind !== 'choose-build-payment' && pa?.kind !== 'choose-double-payment') return
    const idx = paymentSelectedIds.value.indexOf(cardId)
    if (idx >= 0) paymentSelectedIds.value.splice(idx, 1)
    else paymentSelectedIds.value.push(cardId)
    if (paymentSelectedIds.value.length === pa.cost) {
      const ids = [...paymentSelectedIds.value]
      paymentSelectedIds.value = []
      if (pa.kind === 'choose-build-payment') {
        if (pendingEntry) {
          pendingEntry.builtCard = { id: pa.targetId, name: pa.targetName }
          pendingEntry.paymentCards = ids.map(pid => {
            const card = state.game!.players.find(p => p.id === pa.playerId)?.hand.find(c => c.id === pid)
            return { id: pid, name: card?.kind === 'building' ? card.name : '消費財' }
          })
        }
        state.game = confirmBuildPayment(state.game, ids)
      } else {
        if (pendingEntry) {
          const player = state.game!.players.find(p => p.id === pa.playerId)
          const findName = (id: string) => {
            const c = player?.hand.find(h => h.id === id)
            return c?.kind === 'building' ? c.name : id
          }
          pendingEntry.builtCard = { id: pa.firstId, name: findName(pa.firstId) }
          pendingEntry.secondBuiltCard = { id: pa.secondId, name: findName(pa.secondId) }
          pendingEntry.paymentCards = ids.map(pid => {
            const card = player?.hand.find(c => c.id === pid)
            return { id: pid, name: card?.kind === 'building' ? card.name : '消費財' }
          })
        }
        state.game = confirmDoublePayment(state.game, ids)
      }
    }
  }

  const paymentSelected = computed(() => paymentSelectedIds.value)

  function clickDiscardCard(cardId: string) {
    if (!state.game) return
    state.game = toggleDiscardSelection(state.game, cardId)
    const pa = state.game.pendingAction
    if (!pa || pa.kind !== 'choose-discard') return
    if (pa.selected.length < pa.count) return
    if (pendingEntry) {
      pendingEntry.discardedCards = pa.selected.map(sid => {
        const card = state.game!.players.find(p => p.id === pa.playerId)?.hand.find(c => c.id === sid)
        return { id: sid, name: card?.kind === 'building' ? card.name : '消費財' }
      })
    }
    if (pa.gainAmount === -1) {
      state.game = confirmDiscardDraw(state.game, pa.drawCount ?? 4)
    } else {
      state.game = confirmDiscard(state.game)
    }
  }

  function clickCancelBuildChoice() {
    if (!state.game) return
    history.popEntry(false)
    historyVersion.value++
    pendingEntry = null
    paymentSelectedIds.value = []
    state.game = cancelBuildChoice(state.game)
  }

  function clickCancelDiscardChoice() {
    if (!state.game) return
    history.popEntry(false)
    historyVersion.value++
    pendingEntry = null
    state.game = cancelDiscardChoice(state.game)
  }

  function clickCancelBuildPayment() {
    if (!state.game) return
    paymentSelectedIds.value = []
    state.game = cancelBuildPayment(state.game)
  }

  function clickCancelDoubleSecond() {
    if (!state.game) return
    state.game = cancelDoubleSecond(state.game)
  }

  function clickCancelDoublePayment() {
    if (!state.game) return
    paymentSelectedIds.value = []
    state.game = cancelDoublePayment(state.game)
  }

  const buildableCards = computed(() => {
    if (!state.game) return []
    const pa = state.game.pendingAction
    if (!pa) return []
    if (pa.kind === 'choose-build-target') return getBuildableCards(state.game, pa.playerId, pa.discount)
    if (pa.kind === 'choose-farm-build') return getFarmBuildableCards(state.game, pa.playerId)
    if (pa.kind === 'choose-double-first' || pa.kind === 'choose-double-second') return getDoubleBuildableFirstCards(state.game, pa.playerId)
    if (pa.kind === 'choose-build-two-first') return getBuildTwoFirstCards(state.game, pa.playerId)
    if (pa.kind === 'choose-build-two-second') return getBuildTwoFirstCards(state.game, pa.playerId)
    if (pa.kind === 'choose-no-sell-build') return getNoSellBuildableCards(state.game, pa.playerId)
    if (pa.kind === 'choose-free-build') return getFreeBuildableCards(state.game, pa.playerId, pa.maxAsset)
    return []
  })

  function clickRevealedCard(cardId: string) {
    if (!state.game) return
    if (pendingEntry) {
      const pa = state.game.pendingAction
      if (pa?.kind === 'choose-from-revealed') {
        const card = pa.revealed.find(c => c.id === cardId)
        if (card) pendingEntry.pickedCard = { id: cardId, name: card.kind === 'building' ? card.name : '消費財' }
      }
    }
    state.game = pickRevealedCard(state.game, cardId)
  }

  function clickToggleSellBuilding(buildingId: string) {
    if (!state.game) return
    const pa = state.game.pendingAction
    if (!pa || pa.kind !== 'choose-sell-buildings') return
    const selected = pa.selected.includes(buildingId)
      ? pa.selected.filter(id => id !== buildingId)
      : [...pa.selected, buildingId]
    state.game = { ...state.game, pendingAction: { ...pa, selected } }
  }

  function clickSellOption(selectedIds: string[]) {
    if (!state.game) return
    const pa = state.game.pendingAction
    if (pa?.kind === 'choose-sell-buildings') {
      const entry: HistoryEntry = {
        playerId: pa.playerId,
        targetId: '__sell__',
        targetName: 'sell',
        soldBuildingIds: selectedIds,
        timestamp: Date.now(),
      }
      history.push(entry)
      historyVersion.value++
    }
    state.game = confirmSellBuildings(state.game, selectedIds)
  }

  function clickHandLimitCard(cardId: string) {
    if (!state.game) return
    state.game = toggleHandLimitSelection(state.game, cardId)
    const pa = state.game.pendingAction
    if (!pa || pa.kind !== 'choose-hand-limit') return
    if (pa.selected.length >= pa.count) {
      const entry: HistoryEntry = {
        playerId: pa.playerId,
        targetId: '__hand-limit__',
        targetName: 'hand-limit',
        handLimitDiscarded: [...pa.selected],
        timestamp: Date.now(),
      }
      history.push(entry)
      historyVersion.value++
      state.game = confirmHandLimitDiscard(state.game)
    }
  }

  // ---- メセナ用ペンディングアクション ----

  // NOTE: pendingEntry への builtCard/secondBuiltCard/paymentCards 記録は undo リプレイに必須。
  // replay.ts の resolvePending で choose-build-two-* を解決するために使われる。
  // ここでの記録漏れは「undo 後に建物選択画面に戻る」バグを引き起こす。

  function clickBuildTwoConfirm(firstId: string, secondId: string) {
    if (!state.game) return
    state.game = selectBuildTwoFirstCard(state.game, firstId)
    state.game = selectBuildTwoSecondCard(state.game, secondId)
    const newPa = state.game.pendingAction
    if (newPa?.kind === 'choose-build-two-payment') {
      // pendingEntry に建設対象を記録（undo リプレイで choose-build-two-first/second を解決するため）
      if (pendingEntry) {
        const player = state.game.players.find(p => p.id === newPa.playerId)
        const findName = (id: string) => { const c = player?.hand.find(h => h.id === id); return c?.kind === 'building' ? c.name : id }
        pendingEntry.builtCard = { id: newPa.firstId, name: findName(newPa.firstId) }
        pendingEntry.secondBuiltCard = { id: newPa.secondId, name: findName(newPa.secondId) }
      }
      const hand = state.game.players.find(p => p.id === newPa.playerId)?.hand ?? []
      const payable = hand.filter(c => c.id !== newPa.firstId && c.id !== newPa.secondId)
      if (payable.length === newPa.totalCost) {
        // 支払いカードが残り手札と一致する場合は自動確定
        if (pendingEntry) {
          pendingEntry.paymentCards = payable.map(c => ({ id: c.id, name: c.kind === 'building' ? c.name : '消費財' }))
        }
        state.game = confirmBuildTwoCards(state.game, payable.map(c => c.id))
      } else {
        paymentSelectedIds.value = autoSelectConsumptionIds(payable, newPa.totalCost)
      }
    }
  }

  function clickCancelBuildTwoPayment() {
    if (!state.game) return
    paymentSelectedIds.value = []
    state.game = cancelBuildTwoPayment(state.game)
  }

  function clickBuildTwoPayment(cardId: string) {
    if (!state.game) return
    const pa = state.game.pendingAction
    if (pa?.kind !== 'choose-build-two-payment') return
    const idx = paymentSelectedIds.value.indexOf(cardId)
    if (idx >= 0) paymentSelectedIds.value.splice(idx, 1)
    else paymentSelectedIds.value.push(cardId)
    if (paymentSelectedIds.value.length === pa.totalCost) {
      const ids = [...paymentSelectedIds.value]
      paymentSelectedIds.value = []
      // pendingEntry に建設対象と支払いを記録（undo リプレイで choose-build-two-* を解決するため）
      if (pendingEntry) {
        const player = state.game.players.find(p => p.id === pa.playerId)
        const findName = (id: string) => { const c = player?.hand.find(h => h.id === id); return c?.kind === 'building' ? c.name : id }
        pendingEntry.builtCard = { id: pa.firstId, name: findName(pa.firstId) }
        pendingEntry.secondBuiltCard = { id: pa.secondId, name: findName(pa.secondId) }
        pendingEntry.paymentCards = ids.map(pid => {
          const c = player?.hand.find(h => h.id === pid)
          return { id: pid, name: c?.kind === 'building' ? c.name : '消費財' }
        })
      }
      state.game = confirmBuildTwoCards(state.game, ids)
    }
  }

  function clickFreeBuildCard(cardId: string) {
    if (!state.game) return
    // pendingEntry に建設対象を記録（undo リプレイで choose-free-build を解決するため）
    if (pendingEntry) {
      const pa = state.game.pendingAction
      if (pa?.kind === 'choose-free-build') {
        const card = state.game.players.find(p => p.id === pa.playerId)?.hand.find(c => c.id === cardId)
        pendingEntry.builtCard = { id: cardId, name: card?.kind === 'building' ? card.name : cardId }
      }
    }
    state.game = confirmFreeBuildCard(state.game, cardId)
  }

  function clickNoSellBuildCard(cardId: string) {
    if (!state.game) return
    // pendingEntry に建設対象を記録（undo リプレイで choose-no-sell-build を解決するため）
    if (pendingEntry) {
      const pa = state.game.pendingAction
      if (pa?.kind === 'choose-no-sell-build') {
        const card = state.game.players.find(p => p.id === pa.playerId)?.hand.find(c => c.id === cardId)
        pendingEntry.builtCard = { id: cardId, name: card?.kind === 'building' ? card.name : cardId }
      }
    }
    state.game = selectNoSellBuildCard(state.game, cardId)
    const newPa = state.game.pendingAction
    if (newPa?.kind === 'choose-build-payment') {
      const hand = state.game.players.find(p => p.id === newPa.playerId)?.hand ?? []
      const payable = hand.filter(c => c.id !== newPa.targetId)
      if (payable.length === newPa.cost) {
        if (pendingEntry) {
          pendingEntry.paymentCards = payable.map(c => ({ id: c.id, name: c.kind === 'building' ? c.name : '消費財' }))
        }
        state.game = confirmBuildPayment(state.game, payable.map(c => c.id))
      } else if (newPa.cost === 0) {
        if (pendingEntry) pendingEntry.paymentCards = []
        state.game = confirmBuildPayment(state.game, [])
      } else {
        paymentSelectedIds.value = autoSelectConsumptionIds(payable, newPa.cost)
      }
    }
  }

  const MANDATORY_IDS = new Set(['__hand-limit__', '__sell__'])

  function undo() {
    if (!state.game || !history.canUndo || !history.initialState) return
    const hasHumanPlayer = state.game.players.some(p => !p.isCpu)
    const hasPending = !!state.game.pendingAction

    // ラウンド終了処理中に自動設定される強制 pending（ユーザー起因ではない）
    const isMandatoryPending = state.game.pendingAction?.kind === 'choose-sell-buildings'
      || state.game.pendingAction?.kind === 'choose-hand-limit'

    if (hasPending && !isMandatoryPending) {
      history.clearRedo()
      history.popEntry(false)
    } else if (!hasHumanPlayer) {
      history.popEntry(true)
    } else {
      // CPU・強制エントリ（__hand-limit__/__sell__）をまとめてundo対象外とし、
      // 最後の人間エントリまでを1ブロックとして取り消す
      // mandatory pending からの戻りはredoも破棄する
      if (isMandatoryPending) history.clearRedo()
      while (history.peekLastEntry()) {
        const entry = history.peekLastEntry()!
        history.popEntry(!isMandatoryPending)
        if (entry.targetId !== '__cpu__' && !MANDATORY_IDS.has(entry.targetId)) break
      }
    }

    isUndoRedo.value = true
    historyVersion.value++
    pendingEntry = null
    paymentSelectedIds.value = []
    try {
      state.game = replayToIndex(history.initialState, history.actionLog)
    } catch (e) {
      replayError.value = e instanceof Error ? e.message : String(e)
    }
    if (!hasHumanPlayer) cpuPaused.value = true
  }

  function resumeCpu() {
    cpuPaused.value = false
  }

  function redo() {
    if (!state.game || !history.canRedo || !history.initialState) return
    const hasHumanPlayer = state.game.players.some(p => !p.isCpu)

    if (!hasHumanPlayer) {
      history.pushFromRedo()
    } else {
      history.pushFromRedo()
      // CPU・強制エントリが続く限りまとめてredo（1ブロック分）
      while (['__cpu__', ...[...MANDATORY_IDS]].includes(history.peekNextRedo()?.targetId ?? '')) {
        history.pushFromRedo()
      }
    }

    isUndoRedo.value = true
    historyVersion.value++
    pendingEntry = null
    paymentSelectedIds.value = []
    try {
      state.game = replayToIndex(history.initialState, history.actionLog)
    } catch (e) {
      replayError.value = e instanceof Error ? e.message : String(e)
    }
  }

  return {
    game,
    humanPlayer,
    isHumanTurn,
    currentWage,
    availablePublicWorkplaces,
    availableOwnedBuildings,
    pendingAction,
    paymentSelected,
    buildableCards,
    scores,
    canUndo,
    canRedo,
    isUndoRedo,
    cpuPaused,
    resumeCpu,
    getBuildingDef,
    saveGameState,
    hasSavedGame,
    restoreGame,
    clearSavedGame,
    startGame,
    startDebugGame,
    runCpuTurns,
    cpuStepAction,
    triggerRoundEnd,
    autoAdvanceIfStuck,
    clickPublicWorkplace,
    clickOwnedBuilding,
    clickBuildTarget,
    clickPaymentCard,
    clickCancelBuildChoice,
    clickCancelBuildPayment,
    clickCancelDiscardChoice,
    clickCancelDoubleSecond,
    clickCancelDoublePayment,
    clickDoubleConfirm,
    clickDiscardCard,
    clickRevealedCard,
    clickHandLimitCard,
    clickToggleSellBuilding,
    clickSellOption,
    clickBuildTwoConfirm,
    clickBuildTwoPayment,
    clickCancelBuildTwoPayment,
    clickFreeBuildCard,
    clickNoSellBuildCard,
    undo,
    redo,
    replayError,
    clearReplayError: () => { replayError.value = null },
  }
}
