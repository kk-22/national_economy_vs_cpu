import { reactive, computed, ref } from 'vue'
import type { GameConfig, GameState } from '../game/types'
import {
  createGame,
  createDebugGame,
  getAvailablePublicWorkplaces,
  getAvailableOwnedBuildings,
  placeWorkerOnPublic,
  placeWorkerOnBuilding,
  selectBuildTarget,
  selectFarmBuildTarget,
  confirmBuildPayment,
  cancelBuildChoice,
  cancelBuildPayment,
  cancelDiscardChoice,
  cancelRevealedChoice,
  selectDoubleFirst,
  selectDoubleSecond,
  cancelDoubleSecond,
  confirmDoublePayment,
  cancelDoublePayment,
  toggleDiscardSelection,
  confirmDiscard,
  confirmDiscardDraw,
  pickRevealedCard,
  calculateScores,
  getBuildableCards,
  getFarmBuildableCards,
  getDoubleBuildableFirstCards,
} from '../game/engine'
import { BUILDING_CARDS, ROUND_CARDS } from '../game/constants'

const state = reactive<{ game: GameState | null }>({ game: null })

export function useGame() {
  function startGame(config: GameConfig) {
    state.game = createGame(config)
  }

  function startDebugGame(cpuCount: number = 3) {
    state.game = createDebugGame(cpuCount)
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

  const scores = computed(() => state.game?.phase === 'game-over' ? calculateScores(state.game) : null)

  const pendingAction = computed(() => state.game?.pendingAction ?? null)

  const buildDef = computed(() => {
    const pa = pendingAction.value
    if (!pa) return null
    if (pa.kind === 'choose-build-payment') return { name: pa.targetName, cost: pa.cost }
    return null
  })

  function getBuildingDef(name: string) {
    return BUILDING_CARDS[name]
  }

  // Actions
  function clickPublicWorkplace(id: string) {
    if (!state.game || !isHumanTurn.value) return
    state.game = placeWorkerOnPublic(state.game, humanPlayer.value!.id, id)
  }

  function clickOwnedBuilding(id: string) {
    if (!state.game || !isHumanTurn.value) return
    state.game = placeWorkerOnBuilding(state.game, humanPlayer.value!.id, id)
  }

  function clickBuildTarget(cardId: string) {
    if (!state.game) return
    const pa = state.game.pendingAction
    if (!pa) return
    if (pa.kind === 'choose-build-target') state.game = selectBuildTarget(state.game, cardId)
    else if (pa.kind === 'choose-farm-build') state.game = selectFarmBuildTarget(state.game, cardId)
    else if (pa.kind === 'choose-double-first') state.game = selectDoubleFirst(state.game, cardId)
    else if (pa.kind === 'choose-double-second') state.game = selectDoubleSecond(state.game, cardId)
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
      if (pa.kind === 'choose-build-payment') state.game = confirmBuildPayment(state.game, ids)
      else state.game = confirmDoublePayment(state.game, ids)
    }
  }

  const paymentSelected = computed(() => paymentSelectedIds.value)

  function clickDiscardCard(cardId: string) {
    if (!state.game) return
    state.game = toggleDiscardSelection(state.game, cardId)
  }

  function confirmDiscardAction() {
    if (!state.game) return
    const pa = state.game.pendingAction
    if (!pa || pa.kind !== 'choose-discard') return
    if (pa.gainAmount === -1) {
      state.game = confirmDiscardDraw(state.game, pa.drawCount ?? 4)
    } else {
      state.game = confirmDiscard(state.game)
    }
  }

  function clickCancelBuildChoice() {
    if (!state.game) return
    state.game = cancelBuildChoice(state.game)
  }

  function clickCancelDiscardChoice() {
    if (!state.game) return
    state.game = cancelDiscardChoice(state.game)
  }

  function clickCancelRevealedChoice() {
    if (!state.game) return
    state.game = cancelRevealedChoice(state.game)
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
    if (pa.kind === 'choose-double-first') return getDoubleBuildableFirstCards(state.game, pa.playerId)
    return []
  })

  function clickRevealedCard(cardId: string) {
    if (!state.game) return
    state.game = pickRevealedCard(state.game, cardId)
  }

  return {
    game,
    humanPlayer,
    currentPlayer,
    isHumanTurn,
    currentWage,
    availablePublicWorkplaces,
    availableOwnedBuildings,
    pendingAction,
    buildDef,
    paymentSelected,
    buildableCards,
    scores,
    getBuildingDef,
    startGame,
    startDebugGame,
    clickPublicWorkplace,
    clickOwnedBuilding,
    clickBuildTarget,
    clickPaymentCard,
    clickCancelBuildChoice,
    clickCancelBuildPayment,
    clickCancelDiscardChoice,
    clickCancelRevealedChoice,
    clickCancelDoubleSecond,
    clickCancelDoublePayment,
    clickDiscardCard,
    confirmDiscardAction,
    clickRevealedCard,
  }
}
