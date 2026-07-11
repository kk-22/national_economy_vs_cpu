<script setup lang="ts">
import { ref, computed } from 'vue'
import { useGame } from '../composables/useGame'
import { useLogHighlight } from '../composables/useLogHighlight'
import { useRowResize } from '../composables/useRowResize'
import { useLongPressAction } from '../composables/useLongPressAction'
import { useWorkplaceSort } from '../composables/useWorkplaceSort'
import { useHandSort } from '../composables/useHandSort'
import { regularWorkers, automatons, workerAvailable, automatonAvailable, workerUnderCapacity } from '../utils/workerDisplay'
import { bcardNameStyle, cardLabel, handCount, handDetail, tagBadgeClass } from '../utils/cardDisplay'
import { cardTypeTags, cardTooltip, workplaceTooltip } from '../utils/cardTooltip'
import { ROUND_CARDS, FREE_BUILD_ANY_LIMIT } from '../game/constants'
import { ALL_BUILDING_CARDS } from '../game/primitives'
import { getBuildTwoSecondCards, getConstructionDiscount } from '../game/build'
import HandSortHeader from './HandSortHeader.vue'
import HCard from './HCard.vue'
import RoundJumpDialog from './RoundJumpDialog.vue'

const props = defineProps<{
  activatedIds: string[]
  builtIds: string[]
  drawnIds: string[]
  canPlayerAct: boolean
  settingsPaused: boolean
  cpuThinkingPlayerId: number | null
  tipEnter: (e: MouseEvent, text: string) => void
  tipLeave: () => void
  tipTouchStart: (e: TouchEvent, text: string) => void
  tipTouchEnd: () => void
  tipTouchMove: (e: TouchEvent) => void
}>()

const emit = defineEmits<{
  menuOpen: []
  openSetup: []
  openSummary: []
  openManual: []
  resume: []
  openResult: []
}>()

const {
  game, humanPlayer,
  availablePublicWorkplaces, availableOwnedBuildings,
  pendingAction, paymentSelected, buildableCards, currentWage,
  getBuildingDef,
  clickPublicWorkplace, clickOwnedBuilding,
  clickBuildTarget, clickPaymentCard, clickCancelBuildChoice, clickCancelBuildPayment,
  clickCancelDoublePayment, clickDoubleConfirm,
  clickDiscardCard, clickCancelDiscardChoice, clickRevealedCard, clickHandLimitCard, clickToggleSellBuilding, clickSellOption,
  clickBuildTwoConfirm, clickBuildTwoPayment, clickCancelBuildTwoPayment, clickFreeBuildCard, clickNoSellBuildCard,
  clickConsumptionOrDiscard,
  undo, redo, canUndo, canRedo, cpuPaused,
  availableRoundsForJump, availableRedoRoundsForJump, jumpToRound, jumpToEnd,
} = useGame()

// ---- 戻る 長押し ----
const {
  showDialog: showRoundJumpDialog,
  startLongPress, cancelLongPress, handleTouchEnd,
  handleClick: handleUndoClick,
} = useLongPressAction(canUndo, undo)

function handleRoundJump(round: number) {
  showRoundJumpDialog.value = false
  jumpToRound(round)
}

// ---- 次へ 長押し ----
const {
  showDialog: showRedoJumpDialog,
  startLongPress: startRedoLongPress, cancelLongPress: cancelRedoLongPress, handleTouchEnd: handleRedoTouchEnd,
  handleClick: handleRedoClick,
} = useLongPressAction(canRedo, redo)

function handleRedoRoundJump(round: number) {
  showRedoJumpDialog.value = false
  jumpToRound(round)
}

function handleRedoJumpEnd() {
  showRedoJumpDialog.value = false
  jumpToEnd()
}

const cpuPlayers = computed(() => game.value?.players.filter(p => p.isCpu) ?? [])

const publicWorkplacesLabel = computed(() => {
  const round = game.value?.round ?? 1
  if (round >= 9) return '一般職場（最終ラウンド）'
  const nextCard = ROUND_CARDS[round]
  if (!nextCard) return '一般職場'
  const names = nextCard.workplaces.map(wp => wp.name).join('・')
  return `一般職場（次ラウンド：${names}）`
})

// ---- 一般職場ソート ----
const { wpSortOrder, sortedPublicWorkplaces } = useWorkplaceSort(game)

// ---- ログ行ハイライト ----
const { getLogState, onLogMouseenter, onLogMouseleave, onLogClick } = useLogHighlight(
  () => game.value?.players.map(p => p.name) ?? []
)

function logLineClass(msg: string): string {
  const s = getLogState(msg)
  if (s === 'highlight') return 'log-line log-line--highlight'
  if (s === 'dim') return 'log-line log-line--dim'
  return 'log-line'
}

// ---- 手札ソート ----
const { handSort, sortedHand } = useHandSort(humanPlayer, getBuildingDef)


// ---- ニコイチ建設 2枚同時選択 ----
const doubleSelectedIds = ref<string[]>([])

function clickDoubleSelect(cardId: string) {
  const idx = doubleSelectedIds.value.indexOf(cardId)
  if (idx >= 0) {
    doubleSelectedIds.value.splice(idx, 1)
    return
  }
  if (doubleSelectedIds.value.length === 0) {
    doubleSelectedIds.value = [cardId]
    return
  }
  const firstId = doubleSelectedIds.value[0]
  const firstCost = getBuildingDef(buildableCards.value.find(c => c.id === firstId)?.name ?? '')?.cost
  const thisCost = getBuildingDef(buildableCards.value.find(c => c.id === cardId)?.name ?? '')?.cost
  if (firstCost !== undefined && firstCost === thisCost) {
    doubleSelectedIds.value = []
    clickDoubleConfirm(firstId, cardId)
  } else {
    doubleSelectedIds.value = [cardId]
  }
}

function isDoubleCardDisabled(cardId: string): boolean {
  if (!buildableCards.value.some(b => b.id === cardId)) return true
  if (doubleSelectedIds.value.length === 0) return false
  if (doubleSelectedIds.value.includes(cardId)) return false
  const firstId = doubleSelectedIds.value[0]
  const firstCost = getBuildingDef(buildableCards.value.find(c => c.id === firstId)?.name ?? '')?.cost
  const thisCost = getBuildingDef(buildableCards.value.find(c => c.id === cardId)?.name ?? '')?.cost
  return firstCost !== thisCost
}

function cancelDoubleSelect() {
  doubleSelectedIds.value = []
  clickCancelBuildChoice()
}

// ---- 地球建設 2枚同時選択 ----
const buildTwoSelectedIds = ref<string[]>([])

function isBuildTwoCardDisabled(cardId: string): boolean {
  if (buildTwoSelectedIds.value.includes(cardId)) return false
  if (buildTwoSelectedIds.value.length === 0) {
    return !buildableCards.value.some(b => b.id === cardId)
  }
  const pa = pendingAction.value
  if (!pa || pa.kind !== 'choose-build-two-first' || !game.value) return true
  const firstId = buildTwoSelectedIds.value[0]
  const firstCard = humanPlayer.value?.hand.find(c => c.id === firstId)
  if (!firstCard || firstCard.kind !== 'building') return true
  const def = ALL_BUILDING_CARDS[firstCard.name]
  if (!def) return true
  const firstCost = Math.max(0, def.cost - getConstructionDiscount(game.value, pa.playerId, firstCard.name))
  return !getBuildTwoSecondCards(game.value, pa.playerId, firstId, firstCost).some(b => b.id === cardId)
}

function clickBuildTwoSelect(cardId: string) {
  if (isBuildTwoCardDisabled(cardId)) return
  const idx = buildTwoSelectedIds.value.indexOf(cardId)
  if (idx >= 0) {
    buildTwoSelectedIds.value.splice(idx, 1)
    return
  }
  if (buildTwoSelectedIds.value.length === 0) {
    buildTwoSelectedIds.value = [cardId]
    return
  }
  const firstId = buildTwoSelectedIds.value[0]
  buildTwoSelectedIds.value = []
  clickBuildTwoConfirm(firstId, cardId)
}

function handCardName(cardId: string): string {
  const card = humanPlayer.value?.hand.find(c => c.id === cardId)
  return card?.kind === 'building' ? card.name : ''
}

// 建設コスト支払い選択の表示情報（choose-build-payment / choose-double-payment 共通）
const paymentInfo = computed(() => {
  const pa = pendingAction.value
  if (pa?.kind === 'choose-build-payment') {
    return { title: pa.targetName, cost: pa.cost, disabledIds: [pa.targetId] }
  }
  if (pa?.kind === 'choose-double-payment') {
    return { title: `${handCardName(pa.firstId)}と${handCardName(pa.secondId)}`, cost: pa.cost, disabledIds: [pa.firstId, pa.secondId] }
  }
  return null
})

// ---- 建物売却選択 ----
const sellBuildingError = ref<string | null>(null)

function sellBuildingName(id: string): string {
  return humanPlayer.value?.ownedBuildings.find(b => b.id === id)?.name ?? ''
}

const sellSelectedTotal = computed(() => {
  const pa = pendingAction.value
  if (!pa || pa.kind !== 'choose-sell-buildings') return 0
  return pa.selected.reduce((s, id) => s + (getBuildingDef(sellBuildingName(id))?.assetValue ?? 0), 0)
})

// 賃金不足売却選択中は賃金支払い前の所持金を表示する
const displayMoney = computed(() => {
  const pa = pendingAction.value
  const player = humanPlayer.value
  if (!player) return 0
  if (pa?.kind === 'choose-sell-buildings') {
    return (regularWorkers(player.workers).length * currentWage.value) - pa.deficit
  }
  return player.money
})

function clickConfirmSellBuildings() {
  const pa = game.value?.pendingAction
  if (!pa || pa.kind !== 'choose-sell-buildings') return
  const total = sellSelectedTotal.value
  if (total < pa.deficit) {
    sellBuildingError.value = `合計 $${total} は不足分 $${pa.deficit} に足りません`
    return
  }
  // 最小売却チェック: 各建物の価値 > (合計 − 不足分) でなければ不要な建物が含まれている
  const slack = total - pa.deficit
  for (const id of pa.selected) {
    if ((getBuildingDef(sellBuildingName(id))?.assetValue ?? 0) <= slack) {
      sellBuildingError.value = `選択された建物が多すぎます。最小限にする必要があります。`
      return
    }
  }
  sellBuildingError.value = null
  clickSellOption(pa.selected)
}

// ---- 3行リサイズ（縦3分割） ----
const gameMRef = ref<HTMLElement | null>(null)
const { rowHeights, startResize } = useRowResize(gameMRef)

function workerNames(workerIds: string[]): string[] {
  if (!game.value) return []
  return workerIds.map(wid => {
    const p = game.value!.players.find(pl => pl.workers.some(w => w.id === wid))
    return p?.name ?? '?'
  })
}



function effectiveCost(playerId: number, cardName: string): number {
  const base = getBuildingDef(cardName)?.cost ?? 0
  if (!game.value) return base
  return Math.max(0, base - getConstructionDiscount(game.value, playerId, cardName))
}

function isDiscounted(playerId: number, cardName: string): boolean {
  if (!game.value) return false
  return getConstructionDiscount(game.value, playerId, cardName) > 0
}

function tipOn(text: string | false | null | undefined) {
  if (!text) return {}
  return {
    onMouseenter: (e: MouseEvent) => props.tipEnter(e, text),
    onMouseleave: props.tipLeave,
    onTouchstart: (e: TouchEvent) => props.tipTouchStart(e, text),
    onTouchend: props.tipTouchEnd,
    onTouchcancel: props.tipTouchEnd,
    onTouchmove: (e: TouchEvent) => props.tipTouchMove(e),
  }
}
</script>

<template>
  <div v-if="game" class="game">

    <!-- Mobile header (hidden on desktop) -->
    <div class="mobile-header">
      <div class="mobile-info">
        <span class="hbadge">ラウンド {{ game.round }}/9</span>
        <span class="hbadge">賃金 ${{ currentWage }}</span>
        <span class="hbadge">家計 ${{ game.household }}</span>
      </div>
      <div class="mobile-undo-bar">
        <button
          class="btn-undo"
          :disabled="!canUndo"
          @mousedown="startLongPress"
          @mouseup="cancelLongPress"
          @mouseleave="cancelLongPress"
          @touchstart="startLongPress"
          @touchend.prevent="handleTouchEnd"
          @click="handleUndoClick"
        >◀</button>
        <button v-if="game?.phase === 'game-over'" class="btn-redo" @click="emit('openResult')">結果表示</button>
        <button v-else-if="(cpuPaused && !canRedo || settingsPaused)" class="btn-redo" @click="emit('resume')">▶ 続ける</button>
        <button
          v-else
          class="btn-redo"
          :disabled="!canRedo"
          @mousedown="startRedoLongPress"
          @mouseup="cancelRedoLongPress"
          @mouseleave="cancelRedoLongPress"
          @touchstart="startRedoLongPress"
          @touchend.prevent="handleRedoTouchEnd"
          @click="handleRedoClick"
        >次へ ▶</button>
      </div>
      <button class="menu-btn" @click="emit('menuOpen')">☰</button>
    </div>

    <!-- Body: left content + right log -->
    <div class="game-body">

      <!-- 3カラム リサイズ可能レイアウト -->
      <div class="game-main" ref="gameMRef">

        <!-- ▼ Row 0: CPU -->
        <div class="game-col" :style="{ height: rowHeights[0] + '%' }">
          <section class="section cpu-section">
            <div class="cpu-grid">
              <div v-for="cpu in cpuPlayers" :key="cpu.id" class="cpu-col">
                <div v-if="props.cpuThinkingPlayerId === cpu.id" class="cpu-thinking-overlay">
                  <span class="cpu-thinking-spinner"></span>思考中・・・
                </div>
                <div class="cpu-header">
                  <span class="cpu-name">{{ cpu.name }}</span>
                  <span v-if="cpu.unpaidWages > 0" class="unpaid-badge">未払い{{ cpu.unpaidWages }}</span>
                  <span v-if="cpu.victoryPoints > 0" class="vp-badge">勝利点{{ cpu.victoryPoints }}枚</span>
                  <span class="worker-badge">労働者{{ workerAvailable(cpu.workers) }}/<span :class="{ 'worker-limit-alert': workerUnderCapacity(cpu) }">{{ regularWorkers(cpu.workers).length }}</span><template v-if="automatons(cpu.workers).length > 0"> 機械人形{{ automatonAvailable(cpu.workers) }}/{{ automatons(cpu.workers).length }}</template></span>
                  <span class="cpu-money">${{ cpu.money }}</span>
                  <span class="hand-count"><span class="hand-count-bold">手札{{ handCount(cpu.hand) }}</span>{{ handDetail(cpu.hand) }}</span>
                  <span v-if="game.startPlayerIndex === cpu.id" class="sp-badge">🚩SP</span>
                </div>
                <div class="cpu-cards-scroll">
                  <div class="card-wrap">
                    <div v-for="b in cpu.ownedBuildings" :key="b.id"
                      :class="['bcard', { used: b.workerHereId !== null, 'card-activated': activatedIds.includes(b.id), 'card-built': builtIds.includes(b.id) }]"
                                            v-bind="tipOn(cardTooltip(b.name))">
                      <span v-if="b.workerHereId !== null && game.phase !== 'game-over'" class="bcard-used-label">使用済</span>
                      <span :class="['bcard-cost', { 'bcard-cost--discounted': isDiscounted(cpu.id, b.name) }]">{{ effectiveCost(cpu.id, b.name) }}</span>
                      <span class="bcard-name" :style="bcardNameStyle(b.name, true)">{{ b.name }}</span>
                      <span v-if="cardTypeTags(b.name).length" class="bcard-type-badges">
                        <span v-for="t in cardTypeTags(b.name)" :key="t" :class="['bcard-type-badge', tagBadgeClass(t)]">{{ t }}</span>
                      </span>
                      <span class="bcard-asset">{{ getBuildingDef(b.name)?.assetValue }}</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </section>
        </div>

        <!-- ▼ Divider 0 -->
        <div class="col-divider" @mousedown.prevent="startResize(0, $event)"></div>

        <!-- ▼ Row 1: 一般職場 -->
        <div class="game-col" :style="{ height: rowHeights[1] + '%' }">
          <section class="section workplaces-section">
            <div class="wp-section-header">
              <div class="section-label public-workplaces-label">{{ publicWorkplacesLabel }}</div>
              <select v-model="wpSortOrder" class="wp-sort-select">
                <option value="added">追加順</option>
                <option value="cost">コスト順</option>
                <option value="role">役割順</option>
              </select>
            </div>
            <div class="wp-cards-scroll">
              <div class="card-wrap">
                <div
                  v-for="wp in sortedPublicWorkplaces" :key="wp.id"
                  :class="['wpcard', { used: wp.workerIds.length > 0 && !wp.allowMultiple, available: canPlayerAct && availablePublicWorkplaces.some(w => w.id === wp.id), 'card-activated': activatedIds.includes(wp.id), 'card-built': builtIds.includes(wp.id) }]"
                                    v-bind="tipOn(workplaceTooltip(wp.name, wp.effect))"
                  @click="canPlayerAct && availablePublicWorkplaces.some(w => w.id === wp.id) && clickPublicWorkplace(wp.id)"
                >
                  <div class="wpcard-name">{{ wp.name }}</div>
                  <div class="wpcard-workers">
                    <span v-for="(name, i) in workerNames(wp.workerIds)" :key="i"
                      :class="['wp-wlabel', { faded: wp.allowMultiple }]">{{ name }}</span>
                  </div>
                </div>
              </div>
            </div>
          </section>
        </div>

        <!-- ▼ Divider 1 -->
        <div class="col-divider" @mousedown.prevent="startResize(1, $event)"></div>

        <!-- ▼ Row 2: プレイヤー -->
        <div class="game-col" :style="{ height: rowHeights[2] + '%' }">
          <div v-if="humanPlayer" class="player-area">

            <!-- Player header -->
            <div class="player-header">
              <span class="player-name">{{ humanPlayer?.name }}</span>
              <span v-if="humanPlayer?.unpaidWages" class="unpaid-badge">未払い{{ humanPlayer.unpaidWages }}</span>
              <span v-if="(humanPlayer?.victoryPoints ?? 0) > 0" class="vp-badge">勝利点{{ humanPlayer!.victoryPoints }}枚</span>
              <span class="worker-badge">労働者{{ humanPlayer ? workerAvailable(humanPlayer.workers) : '' }}/<span :class="{ 'worker-limit-alert': humanPlayer != null && workerUnderCapacity(humanPlayer) }">{{ humanPlayer ? regularWorkers(humanPlayer.workers).length : '' }}</span><template v-if="humanPlayer && automatons(humanPlayer.workers).length > 0"> 機械人形{{ automatonAvailable(humanPlayer.workers) }}/{{ automatons(humanPlayer.workers).length }}</template></span>
              <span class="wage-summary">
                所持金${{ displayMoney }} -
                <span :class="displayMoney >= (humanPlayer ? regularWorkers(humanPlayer.workers).length : 0) * currentWage ? 'wage-cost wage-cost--ok' : 'wage-cost'">賃金${{ (humanPlayer ? regularWorkers(humanPlayer.workers).length : 0) * currentWage }}</span>
              </span>
              <span v-if="game.startPlayerIndex === humanPlayer?.id" class="sp-badge">🚩SP</span>
            </div>

            <!-- Pending action -->
            <div v-if="pendingAction" class="pending-area">
              <template v-if="pendingAction.kind === 'choose-build-target' || pendingAction.kind === 'choose-farm-build'">
                <div class="hand-label-row">
                  <HandSortHeader v-model="handSort" :hand="humanPlayer?.hand ?? []" />
                  <span class="pending-title">
                    {{ pendingAction.kind === 'choose-farm-build' ? `${pendingAction.sourceName}で農場を選択（無料）`
                     : `${pendingAction.sourceName}で建設する建物を選択` }}
                  </span>
                </div>
                <div class="card-wrap">
                  <button v-for="card in sortedHand" :key="card.id"
                    :class="['hcard', 'selectable', { 'card-disabled': !buildableCards.some(b => b.id === card.id) }]"
                                        v-bind="tipOn(card.kind === 'building' ? cardTooltip(card.name!) : '')"
                    @click="clickBuildTarget(card.id)">
                    <HCard :card="card" />
                  </button>
                  <span v-if="buildableCards.length === 0" class="no-options">建設できる建物がありません</span>
                </div>
                <button class="btn-cancel" @click="clickCancelBuildChoice">キャンセル</button>
              </template>

              <template v-else-if="pendingAction.kind === 'choose-double-first' || pendingAction.kind === 'choose-double-second'">
                <div class="hand-label-row">
                  <HandSortHeader v-model="handSort" :hand="humanPlayer?.hand ?? []" />
                  <span class="pending-title">{{ pendingAction.sourceName }}で2棟同時に選択（同コスト2棟）</span>
                </div>
                <div class="card-wrap">
                  <button v-for="card in sortedHand" :key="card.id"
                    :class="['hcard', 'selectable', { selected: doubleSelectedIds.includes(card.id), 'card-disabled': isDoubleCardDisabled(card.id) }]"
                                        v-bind="tipOn(card.kind === 'building' ? cardTooltip(card.name!) : '')"
                    @click="clickDoubleSelect(card.id)">
                    <HCard :card="card" />
                  </button>
                  <span v-if="buildableCards.length === 0" class="no-options">建設できる建物がありません</span>
                </div>
                <button class="btn-cancel" @click="cancelDoubleSelect">キャンセル</button>
              </template>

              <template v-else-if="pendingAction.kind === 'choose-build-payment' || pendingAction.kind === 'choose-double-payment'">
                <div class="hand-label-row">
                  <HandSortHeader v-model="handSort" :hand="humanPlayer?.hand ?? []" />
                  <span class="pending-title">
                    {{ paymentInfo?.title }}の建設コスト{{ paymentInfo?.cost }}枚選択 ({{ paymentSelected.length }}/{{ paymentInfo?.cost }})
                  </span>
                </div>
                <div class="card-wrap">
                  <button
                    v-for="card in sortedHand"
                    :key="card.id"
                    :class="['hcard', 'selectable', {
                      selected: paymentSelected.includes(card.id),
                      'card-drawn': drawnIds.includes(card.id),
                      'card-disabled': paymentInfo?.disabledIds.includes(card.id)
                    }]"
                                        v-bind="tipOn(card.kind === 'building' ? cardTooltip(card.name!) : '')"
                    @click="clickPaymentCard(card.id)">
                    <HCard :card="card" />
                  </button>
                </div>
                <button class="btn-cancel" @click="pendingAction.kind === 'choose-build-payment' ? clickCancelBuildPayment() : clickCancelDoublePayment()">戻る</button>
              </template>

              <template v-else-if="pendingAction.kind === 'choose-discard'">
                <div class="hand-label-row">
                  <HandSortHeader v-model="handSort" :hand="humanPlayer?.hand ?? []" />
                  <span class="pending-title">{{ pendingAction.sourceName }}の捨て札を選択 ({{ pendingAction.selected.length }}/{{ pendingAction.count }})</span>
                </div>
                <div class="card-wrap">
                  <button v-for="card in sortedHand" :key="card.id"
                    :class="['hcard', 'selectable', {
                      selected: pendingAction.selected.includes(card.id),
                      'card-drawn': drawnIds.includes(card.id),
                      'card-disabled': (!pendingAction.selected.includes(card.id) && pendingAction.selected.length >= pendingAction.count)
                                    || (pendingAction.consumptionOnly && card.kind !== 'consumption')
                    }]"
                    :disabled="pendingAction.consumptionOnly && card.kind !== 'consumption'"
                                        v-bind="tipOn(card.kind === 'building' ? cardTooltip(card.name!) : '')"
                    @click="clickDiscardCard(card.id)">
                    <HCard :card="card" />
                  </button>
                </div>
                <button class="btn-cancel" @click="clickCancelDiscardChoice">キャンセル</button>
              </template>

              <template v-else-if="pendingAction.kind === 'choose-from-revealed'">
                <div class="pending-title-row">
                  <span class="pending-title">{{ pendingAction.sourceName }}により1枚選択（残りは捨て札）</span>
                </div>
                <div class="card-wrap">
                  <button v-for="card in pendingAction.revealed" :key="card.id"
                    class="bcard selectable"
                                        v-bind="tipOn(card.kind === 'building' ? cardTooltip(card.name!) : '')"
                    @click="clickRevealedCard(card.id)">
                    <HCard :card="card" />
                  </button>
                </div>
                <div v-if="humanPlayer?.ownedBuildings.length" class="hand-label-row" style="margin-top: 6px;">
                  <div class="subsection-label"><span class="hand-count-bold">建物{{ humanPlayer.ownedBuildings.length }}枚</span>（参照用）</div>
                </div>
                <div v-if="humanPlayer?.ownedBuildings.length" class="card-wrap">
                  <div v-for="b in humanPlayer.ownedBuildings" :key="b.id"
                    class="bcard card-disabled"
                                        v-bind="tipOn(cardTooltip(b.name))">
                    <span :class="['bcard-cost', { 'bcard-cost--discounted': isDiscounted(humanPlayer!.id, b.name) }]">{{ effectiveCost(humanPlayer!.id, b.name) }}</span>
                    <span class="bcard-name" :style="bcardNameStyle(b.name)">{{ b.name }}</span>
                    <span class="bcard-asset">{{ getBuildingDef(b.name)?.assetValue }}</span>
                    <span v-if="cardTypeTags(b.name).length" class="bcard-type-badges">
                      <span v-for="t in cardTypeTags(b.name)" :key="t" :class="['bcard-type-badge', tagBadgeClass(t)]">{{ t }}</span>
                    </span>
                  </div>
                </div>
                <div v-if="humanPlayer?.hand.length" class="hand-label-row" style="margin-top: 6px;">
                  <div class="subsection-label"><span class="hand-count-bold">手札{{ handCount(humanPlayer?.hand ?? []) }}</span>{{ handDetail(humanPlayer?.hand ?? []) }}（参照用）</div>
                </div>
                <div v-if="humanPlayer?.hand.length" class="card-wrap">
                  <div v-for="card in sortedHand" :key="card.id" class="hcard card-disabled"
                                        v-bind="tipOn(card.kind === 'building' ? cardTooltip(card.name!) : '')">
                    <HCard :card="card" />
                  </div>
                </div>
              </template>

              <template v-else-if="pendingAction.kind === 'choose-hand-limit'">
                <div class="hand-label-row">
                  <HandSortHeader v-model="handSort" :hand="humanPlayer?.hand ?? []" />
                  <span class="pending-title hand-limit-title">
                    ⚠ 手札上限超過（上限{{ pendingAction.limit }}枚）：{{ pendingAction.count }}枚捨ててください
                    （{{ pendingAction.selected.length }}/{{ pendingAction.count }}）
                  </span>
                </div>
                <div class="card-wrap">
                  <button v-for="card in sortedHand" :key="card.id"
                    :class="['hcard', 'selectable', {
                      selected: pendingAction.selected.includes(card.id),
                      'card-drawn': drawnIds.includes(card.id),
                      'card-disabled': !pendingAction.selected.includes(card.id) && pendingAction.selected.length >= pendingAction.count
                    }]"
                                        v-bind="tipOn(card.kind === 'building' ? cardTooltip(card.name!) : '')"
                    @click="clickHandLimitCard(card.id)">
                    <HCard :card="card" />
                  </button>
                </div>
              </template>

              <template v-else-if="pendingAction.kind === 'choose-sell-buildings'">
                <div class="pending-title-row">
                  <span :class="['pending-title', sellSelectedTotal >= pendingAction.deficit ? 'sell-ok' : 'sell-warning']">
                    ⚠ 賃金不足のため売却する建物を選択（選択中 ${{ sellSelectedTotal }} / 必要額 ${{ pendingAction.deficit }}）
                  </span>
                  <button class="btn-confirm" :disabled="pendingAction.selected.length === 0" @click="clickConfirmSellBuildings">確定</button>
                </div>
                <div v-if="sellBuildingError" class="sell-error">{{ sellBuildingError }}</div>
                <div class="sell-buildings-row">
                  <div class="card-wrap">
                    <button
                      v-for="b in humanPlayer?.ownedBuildings ?? []" :key="b.id"
                      :class="['bcard', pendingAction.sellableIds.includes(b.id) ? 'selectable' : 'card-disabled', { selected: pendingAction.selected.includes(b.id) }]"
                      :disabled="!pendingAction.sellableIds.includes(b.id)"
                                            v-bind="tipOn(cardTooltip(b.name))"
                      @click="pendingAction.sellableIds.includes(b.id) && clickToggleSellBuilding(b.id)">
                      <span :class="['bcard-cost', { 'bcard-cost--discounted': isDiscounted(humanPlayer!.id, b.name) }]">{{ effectiveCost(humanPlayer!.id, b.name) }}</span>
                      <span class="bcard-name" :style="bcardNameStyle(b.name)">{{ b.name }}</span>
                      <span class="bcard-asset">{{ getBuildingDef(b.name)?.assetValue }}</span>
                      <span v-if="cardTypeTags(b.name).length" class="bcard-type-badges">
                        <span v-for="t in cardTypeTags(b.name)" :key="t" :class="['bcard-type-badge', tagBadgeClass(t)]">{{ t }}</span>
                      </span>
                    </button>
                  </div>
                </div>
                <div v-if="humanPlayer?.hand.length" class="hand-label-row" style="margin-top: 6px;">
                  <div class="subsection-label"><span class="hand-count-bold">手札{{ handCount(humanPlayer?.hand ?? []) }}</span>{{ handDetail(humanPlayer?.hand ?? []) }}（売却不可）</div>
                </div>
                <div v-if="humanPlayer?.hand.length" class="card-wrap">
                  <div v-for="card in sortedHand" :key="card.id" class="hcard card-disabled"
                                        v-bind="tipOn(card.kind === 'building' ? cardTooltip(card.name!) : '')">
                    <HCard :card="card" />
                  </div>
                </div>
              </template>

              <!-- 地球建設: 2棟同時選択 -->
              <template v-else-if="pendingAction.kind === 'choose-build-two-first'">
                <div class="hand-label-row">
                  <HandSortHeader v-model="handSort" :hand="humanPlayer?.hand ?? []" />
                  <span class="pending-title">
                    {{ pendingAction.sourceName }}：建設する建物を2棟選択
                    ({{ buildTwoSelectedIds.length }}/2)
                  </span>
                </div>
                <div class="card-wrap">
                  <button v-for="card in sortedHand" :key="card.id"
                    :class="['hcard', 'selectable', {
                      selected: buildTwoSelectedIds.includes(card.id),
                      'card-disabled': isBuildTwoCardDisabled(card.id),
                    }]"
                                        v-bind="tipOn(card.kind === 'building' ? cardTooltip(card.name!) : '')"
                    @click="clickBuildTwoSelect(card.id)">
                    <HCard :card="card" />
                  </button>
                </div>
                <button class="btn-cancel" @click="clickCancelBuildChoice">キャンセル</button>
              </template>

              <!-- 地球建設: 支払い選択 -->
              <template v-else-if="pendingAction.kind === 'choose-build-two-payment'">
                <div class="hand-label-row">
                  <HandSortHeader v-model="handSort" :hand="humanPlayer?.hand ?? []" />
                  <span class="pending-title">
                    {{ handCardName(pendingAction.firstId) }}と{{ handCardName(pendingAction.secondId) }}の建設コスト合計{{ pendingAction.totalCost }}枚を選択
                    ({{ paymentSelected.length }}/{{ pendingAction.totalCost }})
                  </span>
                </div>
                <div class="card-wrap">
                  <button v-for="card in sortedHand" :key="card.id"
                    :class="['hcard', 'selectable', {
                      selected: paymentSelected.includes(card.id),
                      'card-disabled': card.id === pendingAction.firstId || card.id === pendingAction.secondId
                    }]"
                                        v-bind="tipOn(card.kind === 'building' ? cardTooltip(card.name!) : '')"
                    @click="clickBuildTwoPayment(card.id)">
                    <HCard :card="card" />
                  </button>
                </div>
                <button class="btn-cancel" @click="clickCancelBuildTwoPayment">戻る</button>
              </template>

              <!-- 農村: 消費財引く or 消費財捨てて建物引く -->
              <template v-else-if="pendingAction.kind === 'choose-consumption-or-discard'">
                <div class="pending-title-row">
                  <span class="pending-title">{{ pendingAction.sourceName }}：効果を選択</span>
                </div>
                <div class="glory-choice-area">
                  <button class="btn-confirm" @click="clickConsumptionOrDiscard('consumption')">
                    消費財{{ pendingAction.n }}枚引く
                  </button>
                  <button class="btn-confirm"
                    :disabled="(humanPlayer?.hand.filter(c => c.kind === 'consumption').length ?? 0) < pendingAction.n"
                    @click="clickConsumptionOrDiscard('discard-draw')">
                    消費財{{ pendingAction.n }}枚捨て→建物{{ pendingAction.n + 1 }}枚引く
                  </button>
                </div>
              </template>

              <!-- プレハブ工務店 / 転送装置: 建物を無料建設 -->
              <template v-else-if="pendingAction.kind === 'choose-free-build'">
                <div class="hand-label-row">
                  <HandSortHeader v-model="handSort" :hand="humanPlayer?.hand ?? []" />
                  <span class="pending-title">
                    {{ pendingAction.sourceName }}：{{ pendingAction.maxAsset >= FREE_BUILD_ANY_LIMIT ? '建物を無料建設' : `資産価値${pendingAction.maxAsset}以下の建物を無料建設` }}
                  </span>
                </div>
                <div class="card-wrap">
                  <button v-for="card in sortedHand" :key="card.id"
                    :class="['hcard', 'selectable', { 'card-disabled': !buildableCards.some(b => b.id === card.id) }]"
                                        v-bind="tipOn(card.kind === 'building' ? cardTooltip(card.name!) : '')"
                    @click="clickFreeBuildCard(card.id)">
                    <HCard :card="card" />
                  </button>
                </div>
                <button class="btn-cancel" @click="clickCancelBuildChoice">キャンセル</button>
              </template>

              <!-- 建築会社: 売却禁止建物を選択して建設 -->
              <template v-else-if="pendingAction.kind === 'choose-no-sell-build'">
                <div class="hand-label-row">
                  <HandSortHeader v-model="handSort" :hand="humanPlayer?.hand ?? []" />
                  <span class="pending-title">{{ pendingAction.sourceName }}：売却不可の建物を選択して建設</span>
                </div>
                <div class="card-wrap">
                  <button v-for="card in sortedHand" :key="card.id"
                    :class="['hcard', 'selectable', { 'card-disabled': !buildableCards.some(b => b.id === card.id) }]"
                                        v-bind="tipOn(card.kind === 'building' ? cardTooltip(card.name!) : '')"
                    @click="clickNoSellBuildCard(card.id)">
                    <HCard :card="card" />
                  </button>
                </div>
                <button class="btn-cancel" @click="clickCancelBuildChoice">キャンセル</button>
              </template>

            </div>

            <!-- Normal view (no pending) -->
            <div v-else class="player-content">
              <div v-if="humanPlayer?.ownedBuildings.length" class="player-subsection">
                <div class="bld-scroll">
                  <div class="card-wrap">
                    <div v-for="b in humanPlayer.ownedBuildings" :key="b.id"
                      :class="['bcard', { used: b.workerHereId !== null, available: canPlayerAct && availableOwnedBuildings.some(x => x.id === b.id), 'card-activated': activatedIds.includes(b.id), 'card-built': builtIds.includes(b.id) }]"
                                            v-bind="tipOn(cardTooltip(b.name))"
                      @click="canPlayerAct && availableOwnedBuildings.some(x => x.id === b.id) && clickOwnedBuilding(b.id)">
                      <span v-if="b.workerHereId !== null" class="bcard-used-label">使用済</span>
                      <span :class="['bcard-cost', { 'bcard-cost--discounted': isDiscounted(humanPlayer!.id, b.name) }]">{{ effectiveCost(humanPlayer!.id, b.name) }}</span>
                      <span class="bcard-name" :style="bcardNameStyle(b.name)">{{ b.name }}</span>
                      <span v-if="cardTypeTags(b.name).length" class="bcard-type-badges">
                        <span v-for="t in cardTypeTags(b.name)" :key="t" :class="['bcard-type-badge', tagBadgeClass(t)]">{{ t }}</span>
                      </span>
                      <span class="bcard-asset">{{ getBuildingDef(b.name)?.assetValue }}</span>
                    </div>
                  </div>
                </div>
              </div>
              <div class="player-subsection">
                <div class="hand-label-row">
                  <HandSortHeader v-model="handSort" :hand="humanPlayer?.hand ?? []" />
                </div>
                <div class="hand-scroll">
                  <div class="card-wrap">
                    <div v-for="card in sortedHand" :key="card.id"
                      :class="['hcard', { 'card-drawn': drawnIds.includes(card.id) }]"
                                            v-bind="tipOn(card.kind === 'building' ? cardTooltip(card.name!) : '')">
                      <span v-if="card.kind === 'building'" :class="['bcard-cost', { 'bcard-cost--discounted': isDiscounted(humanPlayer!.id, card.name!) }]">{{ effectiveCost(humanPlayer!.id, card.name!) }}</span>
                      <span class="bcard-name" :style="card.kind === 'building' ? bcardNameStyle(card.name!) : {}">{{ cardLabel(card) }}</span>
                      <span v-if="card.kind === 'building'" class="bcard-asset">{{ getBuildingDef(card.name!)?.assetValue }}</span>
                      <span v-if="card.kind === 'building' && cardTypeTags(card.name!).length" class="bcard-type-badges">
                        <span v-for="t in cardTypeTags(card.name!)" :key="t" :class="['bcard-type-badge', tagBadgeClass(t)]">{{ t }}</span>
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </div>

          </div><!-- /player-area -->
        </div><!-- /game-col player -->

      </div><!-- /game-main -->

      <!-- Right: log panel -->
      <div class="log-panel">
        <div class="log-info">
          <div class="log-info-row">
            <span class="hbadge">ラウンド {{ game.round }}/9</span>
            <span class="hbadge">山札 {{ game.buildingDeck.length }}枚</span>
          </div>
          <div class="log-info-row">
            <span class="hbadge">家計 ${{ game.household }}</span>
            <span class="hbadge">賃金 ${{ currentWage }}</span>
          </div>
          <button class="btn-restart" @click="emit('openManual')">📖 説明書</button>
          <button class="btn-restart" @click="emit('openSetup')">⚙️ ゲーム設定</button>
          <button class="btn-restart" @click="emit('openSummary')">📋 ラウンド毎の情報</button>
        </div>
        <div class="log-undo-bar">
          <button
            class="btn-undo"
            :disabled="!canUndo"
            @mousedown="startLongPress"
            @mouseup="cancelLongPress"
            @mouseleave="cancelLongPress"
            @touchstart="startLongPress"
            @touchend.prevent="handleTouchEnd"
            @click="handleUndoClick"
          >◀ 戻る</button>
          <button v-if="game?.phase === 'game-over'" class="btn-redo" @click="emit('openResult')">結果表示</button>
          <button v-else-if="(cpuPaused && !canRedo || settingsPaused)" class="btn-redo" @click="emit('resume')">▶ 続ける</button>
          <button
          v-else
          class="btn-redo"
          :disabled="!canRedo"
          @mousedown="startRedoLongPress"
          @mouseup="cancelRedoLongPress"
          @mouseleave="cancelRedoLongPress"
          @touchstart="startRedoLongPress"
          @touchend.prevent="handleRedoTouchEnd"
          @click="handleRedoClick"
        >次へ ▶</button>
        </div>
        <div class="log-label">ログ</div>
        <div class="log-scroll">
          <div
            v-for="(msg, i) in [...game.log].reverse()"
            :key="i"
            :class="logLineClass(msg)"
            @mouseenter="onLogMouseenter(msg)"
            @mouseleave="onLogMouseleave"
            @click="onLogClick(msg)"
          >{{ msg }}</div>
        </div>
      </div>

    </div><!-- /game-body -->
  </div>

  <RoundJumpDialog
    v-if="showRoundJumpDialog"
    :available-rounds="availableRoundsForJump"
    @close="showRoundJumpDialog = false"
    @jump="handleRoundJump"
  />
  <RoundJumpDialog
    v-if="showRedoJumpDialog"
    mode="redo"
    :available-rounds="availableRedoRoundsForJump"
    @close="showRedoJumpDialog = false"
    @jump="handleRedoRoundJump"
    @jump-end="handleRedoJumpEnd"
  />
</template>

<style scoped>
.wp-section-header {
  display: flex;
  align-items: center;
  gap: 6px;
  line-height: 1;
}

.wp-section-header .section-label {
  margin: 0;
  line-height: 1;
}

.wp-sort-select {
  font-size: 0.72rem;
  padding: 1px 4px;
  border: 1px solid #ccc;
  border-radius: 3px;
  background: #fff;
  cursor: pointer;
  flex-shrink: 0;
  vertical-align: middle;
}
</style>
