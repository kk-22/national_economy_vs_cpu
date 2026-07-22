import { shallowReactive, computed, ref, toRaw } from 'vue'
import type { GameConfig, GameSeries, GameState, HandCard, PendingAction } from '../game/types'
import { createGame, createDebugGame } from '../game/init'
import { calculateScores, confirmSellBuildings } from '../game/round'
import { getAvailablePublicWorkplaces, getAvailableOwnedBuildings } from '../game/availability'
import {
  placeWorkerOnPublic, placeWorkerOnBuilding,
  selectFarmBuildTarget, confirmBuildPayment, confirmDoublePayment,
  confirmDiscard, confirmDiscardDraw, pickRevealedCard, confirmHandLimitDiscard,
  selectBuildTwoFirstCard, selectBuildTwoSecondCard, confirmBuildTwoCards, confirmFreeBuildCard, selectNoSellBuildCard,
  confirmConsumptionOrDiscard,
} from '../game/turns'
import {
  selectBuildTarget, selectDoubleFirst, selectDoubleSecond,
  cancelBuildChoice, cancelBuildPayment, cancelDoublePayment,
  cancelBuildTwoPayment,
  getBuildableCards, getFarmBuildableCards, getDoubleBuildableFirstCards,
  getNoSellBuildableCards, getFreeBuildableCards,
  getBuildTwoFirstCards,
} from '../game/build'
import { toggleDiscardSelection, cancelDiscardChoice, toggleHandLimitSelection } from '../game/resolution'
import { ALL_BUILDING_CARDS } from '../game/primitives'
import { hasConsumptionValueBuilding } from '../game/effects'
import { ROUND_CARDS } from '../game/constants'
import { GameHistory } from '../game/history'
import type { HistoryEntry } from '../game/history'
import { replayToIndex } from '../game/replay'
import { useGamePersistence } from './useGamePersistence'
import { useCpuTurns } from './useCpuTurns'

const state = shallowReactive<{ game: GameState | null }>({ game: null })
let history = new GameHistory(1)
let pendingEntry: HistoryEntry | null = null
const isUndoRedo = ref(false)
const replayError = ref<string | null>(null)
const cpuPaused = ref(false)
const historyVersion = ref(0)  // incremented after each history mutation to drive canUndo/canRedo reactivity

export function useGame() {
  const { saveGameState: savePersisted, hasSavedGame, loadSavedGame, clearSavedGame } = useGamePersistence()

  function saveGameState(): void {
    savePersisted(state.game, history.toObject())
  }

  function restoreGame(): boolean {
    try {
      const loaded = loadSavedGame()
      if (!loaded) return false
      const restoredGame = loaded.game
      // 旧バージョンの保存データにないフィールドを補完
      restoredGame.players = restoredGame.players.map(p => ({
        ...p,
        money: p.money ?? 0,
        unpaidWages: p.unpaidWages ?? 0,
        victoryPoints: p.victoryPoints ?? 0,
      }))
      state.game = restoredGame
      history = loaded.historyObj ? GameHistory.fromObject(loaded.historyObj) : new GameHistory(restoredGame._rngSeed)
      if (!history.initialState) {
        history.setInitialState(toRaw(state.game))
      }
      historyVersion.value++
      pendingEntry = null
      cpuPaused.value = false
      return true
    } catch { return false }
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

  const { autoAdvanceIfStuck, runCpuTurns, cpuStepAction, triggerRoundEnd } = useCpuTurns({
    state,
    pushHistoryEntry: (entry) => { history.push(entry); historyVersion.value++ },
  })

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
        resolveSingleBuildPayment(newPa)
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
      if (newPa?.kind === 'choose-double-payment') resolveDoublePayment(newPa)
    }
  }

  function clickDoubleConfirm(firstId: string, secondId: string) {
    if (!state.game) return
    state.game = selectDoubleFirst(state.game, firstId)
    state.game = selectDoubleSecond(state.game, secondId)
    const newPa = state.game.pendingAction
    if (newPa?.kind === 'choose-double-payment') resolveDoublePayment(newPa)
  }

  // 消費財を有効活用できる建物がある場合はデフォルト選択しない
  function autoSelectConsumptionIds(payable: { kind: string; id: string }[], cost: number, playerId?: number): string[] {
    if (playerId !== undefined) {
      const player = state.game?.players.find(p => p.id === playerId)
      if (player && hasConsumptionValueBuilding(player.ownedBuildings)) return []
    }
    const consumptions = payable.filter(c => c.kind === 'consumption')
    const maxAutoSelect = state.game?.series === 'mecenat'
      ? Math.max(0, Math.min(cost - 1, consumptions.length - 1))
      : Math.max(0, cost - 1)
    return consumptions.slice(0, maxAutoSelect).map(c => c.id)
  }

  // 手札からカードの表示名を返す（支払いカード用: 建物以外は '消費財'）
  function toCardRef(hand: HandCard[], id: string): { id: string; name: string } {
    const c = hand.find(h => h.id === id)
    return { id, name: c?.kind === 'building' ? c.name : '消費財' }
  }

  // 手札からカード名を返す（建設対象名用: 見つからない場合は id をフォールバック）
  function handCardName(hand: HandCard[], id: string): string {
    const c = hand.find(h => h.id === id)
    return c?.kind === 'building' ? c.name : id
  }

  // choose-double-payment の pendingEntry 記録 + 確定
  function confirmDoublePaymentWithEntry(
    pa: Extract<PendingAction, { kind: 'choose-double-payment' }>,
    ids: string[],
  ): void {
    const hand = state.game!.players.find(p => p.id === pa.playerId)?.hand ?? []
    if (pendingEntry) {
      pendingEntry.builtCard = { id: pa.firstId, name: handCardName(hand, pa.firstId) }
      pendingEntry.secondBuiltCard = { id: pa.secondId, name: handCardName(hand, pa.secondId) }
      pendingEntry.paymentCards = ids.map(id => toCardRef(hand, id))
    }
    state.game = confirmDoublePayment(state.game!, ids)
  }

  // choose-double-payment: 自動確定 or 選択前置き
  function resolveDoublePayment(pa: Extract<PendingAction, { kind: 'choose-double-payment' }>): void {
    const hand = state.game!.players.find(p => p.id === pa.playerId)?.hand ?? []
    const payable = hand.filter(c => c.id !== pa.firstId && c.id !== pa.secondId)
    if (payable.length === pa.cost) {
      confirmDoublePaymentWithEntry(pa, payable.map(c => c.id))
    } else {
      paymentSelectedIds.value = autoSelectConsumptionIds(payable, pa.cost, pa.playerId)
    }
  }

  // choose-build-payment: 自動確定 or 選択前置き（pendingEntry.builtCard も更新）
  function resolveSingleBuildPayment(pa: Extract<PendingAction, { kind: 'choose-build-payment' }>): void {
    const hand = state.game!.players.find(p => p.id === pa.playerId)?.hand ?? []
    const payable = hand.filter(c => c.id !== pa.targetId)
    // モダニズム建設（consumptionDouble）: cost=0のみ自動確定、消費財のデフォルト選択なし
    if (pa.consumptionDouble) {
      if (pa.cost === 0) {
        if (pendingEntry) {
          pendingEntry.builtCard = { id: pa.targetId, name: pa.targetName }
          pendingEntry.paymentCards = []
        }
        state.game = confirmBuildPayment(state.game!, [])
      } else {
        paymentSelectedIds.value = []
      }
      return
    }
    if (pa.cost === 0 || payable.length === pa.cost) {
      const ids = payable.slice(0, pa.cost).map(c => c.id)
      if (pendingEntry) {
        pendingEntry.builtCard = { id: pa.targetId, name: pa.targetName }
        pendingEntry.paymentCards = ids.map(id => toCardRef(hand, id))
      }
      state.game = confirmBuildPayment(state.game!, ids)
    } else {
      paymentSelectedIds.value = autoSelectConsumptionIds(payable, pa.cost, pa.playerId)
    }
  }

  const paymentSelectedIds = ref<string[]>([])

  function clickPaymentCard(cardId: string) {
    if (!state.game) return
    const pa = state.game.pendingAction
    if (pa?.kind !== 'choose-build-payment' && pa?.kind !== 'choose-double-payment') return
    const idx = paymentSelectedIds.value.indexOf(cardId)
    if (idx >= 0) paymentSelectedIds.value.splice(idx, 1)
    else paymentSelectedIds.value.push(cardId)
    // consumptionDouble時は消費財1枚=2コストとして実効値を計算
    let effectiveValue = paymentSelectedIds.value.length
    if (pa.kind === 'choose-build-payment' && pa.consumptionDouble) {
      const hand = state.game.players.find(p => p.id === pa.playerId)?.hand ?? []
      const consumptionCount = paymentSelectedIds.value.filter(id => hand.find(c => c.id === id)?.kind === 'consumption').length
      effectiveValue = consumptionCount * 2 + (paymentSelectedIds.value.length - consumptionCount)
    }
    // consumptionDouble時は超過払い可（奇数コストを消費財のみで払う場合等）
    if (pa.kind === 'choose-build-payment' && pa.consumptionDouble ? effectiveValue >= pa.cost : effectiveValue === pa.cost) {
      const ids = [...paymentSelectedIds.value]
      paymentSelectedIds.value = []
      if (pa.kind === 'choose-build-payment') {
        const hand = state.game!.players.find(p => p.id === pa.playerId)?.hand ?? []
        if (pendingEntry) {
          pendingEntry.builtCard = { id: pa.targetId, name: pa.targetName }
          pendingEntry.paymentCards = ids.map(id => toCardRef(hand, id))
        }
        state.game = confirmBuildPayment(state.game, ids)
      } else {
        confirmDoublePaymentWithEntry(pa, ids)
      }
    }
  }

  const paymentSelected = computed(() => paymentSelectedIds.value)

  // consumptionDouble時は消費財1枚=2コストとして実効選択値を返す
  const paymentEffectiveSelected = computed(() => {
    const pa = state.game?.pendingAction
    if (pa?.kind === 'choose-build-payment' && pa.consumptionDouble) {
      const hand = state.game!.players.find(p => p.id === pa.playerId)?.hand ?? []
      const consumptionCount = paymentSelectedIds.value.filter(id => hand.find(c => c.id === id)?.kind === 'consumption').length
      return consumptionCount * 2 + (paymentSelectedIds.value.length - consumptionCount)
    }
    return paymentSelectedIds.value.length
  })

  function clickDiscardCard(cardId: string) {
    if (!state.game) return
    state.game = toggleDiscardSelection(state.game, cardId)
    const pa = state.game.pendingAction
    if (!pa || pa.kind !== 'choose-discard') return
    if (pa.selected.length < pa.count) return
    if (pendingEntry) {
      const hand = state.game!.players.find(p => p.id === pa.playerId)?.hand ?? []
      pendingEntry.discardedCards = pa.selected.map(sid => toCardRef(hand, sid))
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
        pendingEntry.pickedCard = toCardRef(pa.revealed, cardId)
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
      const hand = state.game.players.find(p => p.id === newPa.playerId)?.hand ?? []
      // pendingEntry に建設対象を記録（undo リプレイで choose-build-two-first/second を解決するため）
      if (pendingEntry) {
        pendingEntry.builtCard = { id: newPa.firstId, name: handCardName(hand, newPa.firstId) }
        pendingEntry.secondBuiltCard = { id: newPa.secondId, name: handCardName(hand, newPa.secondId) }
      }
      const payable = hand.filter(c => c.id !== newPa.firstId && c.id !== newPa.secondId)
      if (payable.length === newPa.totalCost) {
        if (pendingEntry) {
          pendingEntry.paymentCards = payable.map(c => toCardRef(hand, c.id))
        }
        state.game = confirmBuildTwoCards(state.game, payable.map(c => c.id))
      } else {
        paymentSelectedIds.value = autoSelectConsumptionIds(payable, newPa.totalCost, newPa.playerId)
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
        const hand = state.game!.players.find(p => p.id === pa.playerId)?.hand ?? []
        pendingEntry.builtCard = { id: pa.firstId, name: handCardName(hand, pa.firstId) }
        pendingEntry.secondBuiltCard = { id: pa.secondId, name: handCardName(hand, pa.secondId) }
        pendingEntry.paymentCards = ids.map(id => toCardRef(hand, id))
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
        const hand = state.game.players.find(p => p.id === pa.playerId)?.hand ?? []
        pendingEntry.builtCard = { id: cardId, name: handCardName(hand, cardId) }
      }
    }
    state.game = confirmFreeBuildCard(state.game, cardId)
  }

  function clickConsumptionOrDiscard(choice: 'consumption' | 'discard-draw') {
    if (!state.game) return
    if (pendingEntry) {
      pendingEntry.gloryChoice = choice
    }
    state.game = confirmConsumptionOrDiscard(state.game, choice)
  }

  function clickNoSellBuildCard(cardId: string) {
    if (!state.game) return
    // pendingEntry に建設対象を記録（undo リプレイで choose-no-sell-build を解決するため）
    if (pendingEntry) {
      const pa = state.game.pendingAction
      if (pa?.kind === 'choose-no-sell-build') {
        const hand = state.game.players.find(p => p.id === pa.playerId)?.hand ?? []
        pendingEntry.builtCard = { id: cardId, name: handCardName(hand, cardId) }
      }
    }
    state.game = selectNoSellBuildCard(state.game, cardId)
    const newPa = state.game.pendingAction
    if (newPa?.kind === 'choose-build-payment') resolveSingleBuildPayment(newPa)
  }

  const MANDATORY_IDS = new Set(['__hand-limit__', '__sell__'])

  function undo() {
    if (!state.game || !history.canUndo || !history.initialState) return
    const hasHumanPlayer = state.game.players.some(p => !p.isCpu)
    const hasPending = !!state.game.pendingAction

    // ラウンド終了処理中に自動設定される強制 pending（ユーザー起因ではない）
    const isMandatoryPending = state.game.pendingAction?.kind === 'choose-sell-buildings'
      || state.game.pendingAction?.kind === 'choose-hand-limit'

    const snapshot = history.snapshotForUndo()

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
      history.restoreSnapshot(snapshot)
      replayError.value = e instanceof Error ? e.message : String(e)
    }
    if (!hasHumanPlayer) cpuPaused.value = true
  }

  function resumeCpu() {
    cpuPaused.value = false
  }

  const availableRoundsForJump = computed<number[]>(() => {
    if (!state.game || !history.canUndo) return []
    return Array.from({ length: state.game.round }, (_, i) => i + 1)
  })

  const availableRedoRoundsForJump = computed<number[]>(() => {
    if (!state.game || !history.canRedo) return []
    historyVersion.value
    const currentRound = state.game.round
    const rounds: number[] = []
    let s: GameState = state.game
    let lastRound = currentRound
    for (const entry of history.redoLog) {
      try { s = replayToIndex(s, [entry]) } catch { break }
      if (s.round > lastRound) {
        if (s.round > currentRound) rounds.push(s.round)
        lastRound = s.round
      }
    }
    return rounds
  })

  // フルログ上で targetRound の最初の人間手番直前に history を分割する
  function splitAtFirstHumanOfRound(targetRound: number) {
    if (!history.initialState) return
    const full = history.fullLog
    let idx = 0
    let inTargetRound = targetRound <= 1

    for (let i = 0; i < full.length; i++) {
      if (!inTargetRound) {
        const s = replayToIndex(history.initialState, full.slice(0, i + 1))
        if (s.round >= targetRound) inTargetRound = true
        continue
      }
      const entry = full[i]
      if (entry.targetId !== '__cpu__' && !MANDATORY_IDS.has(entry.targetId)) {
        idx = i
        break
      }
      idx = i + 1
    }

    history.splitAt(idx)
  }

  function jumpToRound(targetRound: number) {
    if (!state.game || !history.initialState) return
    const snapshot = history.snapshotForUndo()
    try {
      splitAtFirstHumanOfRound(targetRound)
      isUndoRedo.value = true
      historyVersion.value++
      pendingEntry = null
      paymentSelectedIds.value = []
      cpuPaused.value = false
      state.game = replayToIndex(history.initialState, history.actionLog)
    } catch (e) {
      history.restoreSnapshot(snapshot)
      replayError.value = e instanceof Error ? e.message : String(e)
    }
  }

  function jumpToEnd() {
    if (!state.game || !history.canRedo || !history.initialState) return
    const snapshot = history.snapshotForUndo()
    history.splitAt(history.fullLog.length)
    isUndoRedo.value = true
    historyVersion.value++
    pendingEntry = null
    paymentSelectedIds.value = []
    cpuPaused.value = false
    try {
      state.game = replayToIndex(history.initialState, history.actionLog)
    } catch (e) {
      history.restoreSnapshot(snapshot)
      replayError.value = e instanceof Error ? e.message : String(e)
    }
  }

  function redo() {
    if (!state.game || !history.canRedo || !history.initialState) return
    const hasHumanPlayer = state.game.players.some(p => !p.isCpu)

    const snapshot = history.snapshotForUndo()

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
      history.restoreSnapshot(snapshot)
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
    paymentEffectiveSelected,
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
    clickConsumptionOrDiscard,
    undo,
    redo,
    availableRoundsForJump,
    availableRedoRoundsForJump,
    jumpToRound,
    jumpToEnd,
    replayError,
    clearReplayError: () => { replayError.value = null },
  }
}
