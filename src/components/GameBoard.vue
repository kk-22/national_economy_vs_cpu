<script setup lang="ts">
import { ref, computed, onUnmounted } from 'vue'
import { useGame } from '../composables/useGame'
import type { Worker, GameEffect, HandCard } from '../game/types'

const props = defineProps<{
  activatedIds: string[]
  builtIds: string[]
  drawnIds: string[]
  canPlayerAct: boolean
  settingsPaused: boolean
  tipEnter: (e: MouseEvent, text: string) => void
  tipLeave: () => void
}>()

const emit = defineEmits<{
  menuOpen: []
  openSetup: []
  openSummary: []
  resume: []
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
  undo, redo, canUndo, canRedo, cpuPaused,
} = useGame()

const cpuPlayers = computed(() => game.value?.players.filter(p => p.isCpu) ?? [])

// ---- ログ行ハイライト ----
type HighlightKey = { type: 'player'; name: string } | { type: 'round' }

const hoveredHighlight = ref<HighlightKey | null>(null)
const selectedHighlight = ref<HighlightKey | null>(null)

const playerNames = computed(() => game.value?.players.map(p => p.name) ?? [])

function getLogPlayer(msg: string): string | null {
  for (const name of playerNames.value) {
    if (msg.startsWith(name + ':') || msg.startsWith(name + ' ')) return name
  }
  return null
}

function isRoundMarker(msg: string): boolean {
  return /ラウンド \d+ (開始|終了)/.test(msg)
}

function getLineKey(msg: string): HighlightKey | null {
  if (isRoundMarker(msg)) return { type: 'round' }
  const player = getLogPlayer(msg)
  if (player) return { type: 'player', name: player }
  return null
}

function logLineClass(msg: string, _i: number): string {
  const active = selectedHighlight.value ?? hoveredHighlight.value
  if (!active) return 'log-line'
  if (active.type === 'player') {
    if (getLogPlayer(msg) === active.name) return 'log-line log-line--highlight'
    if (getLogPlayer(msg) === null) return 'log-line'
    return 'log-line log-line--dim'
  }
  // type === 'round': ラウンドマーカー行のみハイライト
  if (isRoundMarker(msg)) return 'log-line log-line--highlight'
  return 'log-line log-line--dim'
}

function onLogMouseenter(msg: string, _i: number) {
  const key = getLineKey(msg)
  if (key) hoveredHighlight.value = key
}

function onLogMouseleave() {
  hoveredHighlight.value = null
}

function onLogClick(msg: string, _i: number) {
  const key = getLineKey(msg)
  if (!key) return
  const cur = selectedHighlight.value
  if (cur && cur.type === key.type &&
    (cur.type !== 'player' || (key.type === 'player' && cur.name === key.name))) {
    selectedHighlight.value = null
  } else {
    selectedHighlight.value = key
  }
}

// ---- 手札ソート ----
type HandSort = 'order' | 'cost'
const handSort = ref<HandSort>('order')

function sortByCost<T extends { kind: string; name?: string }>(cards: T[]): T[] {
  return [...cards].sort((a, b) => {
    const costA = a.kind === 'building' ? (getBuildingDef(a.name!)?.cost ?? 0) : 0
    const costB = b.kind === 'building' ? (getBuildingDef(b.name!)?.cost ?? 0) : 0
    if (costB !== costA) return costB - costA
    const assetA = a.kind === 'building' ? (getBuildingDef(a.name!)?.assetValue ?? 0) : 0
    const assetB = b.kind === 'building' ? (getBuildingDef(b.name!)?.assetValue ?? 0) : 0
    return assetB - assetA
  })
}

const sortedHand = computed(() => {
  const hand = humanPlayer.value?.hand ?? []
  const pa = pendingAction.value
  const consumptions = hand.filter(c => c.kind === 'consumption')
  const buildings = hand.filter(c => c.kind === 'building')
  const sortedBuildings = handSort.value === 'cost' ? sortByCost(buildings) : buildings

  const isDiscardScene = pa?.kind === 'choose-discard' ||
    pa?.kind === 'choose-build-payment' ||
    pa?.kind === 'choose-double-payment' ||
    pa?.kind === 'choose-hand-limit'

  if (isDiscardScene) {
    const selectedIds = (pa?.kind === 'choose-discard' || pa?.kind === 'choose-hand-limit')
      ? pa.selected
      : paymentSelected.value
    const selectedConsumptions = consumptions.filter(c => selectedIds.includes(c.id))
    const unselectedConsumptions = consumptions.filter(c => !selectedIds.includes(c.id))
    return [...selectedConsumptions, ...unselectedConsumptions, ...sortedBuildings]
  }

  return [...sortedBuildings, ...consumptions]
})

const sortedBuildableCards = computed(() =>
  handSort.value === 'order' ? buildableCards.value : sortByCost(buildableCards.value)
)

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

// ---- 建物売却選択 ----
const sellBuildingError = ref<string | null>(null)
function clickConfirmSellBuildings() {
  const pa = game.value?.pendingAction
  if (!pa || pa.kind !== 'choose-sell-buildings') return
  const ownedBuildings = game.value?.players.find(p => !p.isCpu)?.ownedBuildings ?? []
  const getValue = (id: string) => getBuildingDef(ownedBuildings.find(b => b.id === id)?.name ?? '')?.assetValue ?? 0
  const total = pa.selected.reduce((sum, id) => sum + getValue(id), 0)
  if (total < pa.deficit) {
    sellBuildingError.value = `合計 $${total} は不足分 $${pa.deficit} に足りません`
    return
  }
  // 最小売却チェック: 各建物の価値 > (合計 − 不足分) でなければ不要な建物が含まれている
  const slack = total - pa.deficit
  for (const id of pa.selected) {
    if (getValue(id) <= slack) {
      sellBuildingError.value = `選択された建物が多すぎます。最小限にする必要があります。`
      return
    }
  }
  sellBuildingError.value = null
  clickSellOption(pa.selected)
}

// ---- 3行リサイズ（縦3分割） ----
const gameMRef = ref<HTMLElement | null>(null)
const rowHeights = ref([33.33, 33.33, 33.34])

let resizingState: {
  dividerIdx: number; startY: number; startH0: number; startH1: number
} | null = null

function startResize(dividerIdx: number, e: MouseEvent) {
  e.preventDefault()
  resizingState = {
    dividerIdx, startY: e.clientY,
    startH0: rowHeights.value[dividerIdx],
    startH1: rowHeights.value[dividerIdx + 1],
  }
  window.addEventListener('mousemove', onResizeMove)
  window.addEventListener('mouseup', stopResize)
}
function onResizeMove(e: MouseEvent) {
  if (!resizingState || !gameMRef.value) return
  const totalH = gameMRef.value.getBoundingClientRect().height
  const dp = ((e.clientY - resizingState.startY) / totalH) * 100
  const hs = [...rowHeights.value]
  hs[resizingState.dividerIdx]     = Math.max(10, resizingState.startH0 + dp)
  hs[resizingState.dividerIdx + 1] = Math.max(10, resizingState.startH1 - dp)
  rowHeights.value = hs
}
function stopResize() {
  resizingState = null
  window.removeEventListener('mousemove', onResizeMove)
  window.removeEventListener('mouseup', stopResize)
}

onUnmounted(() => {
  window.removeEventListener('mousemove', onResizeMove)
  window.removeEventListener('mouseup', stopResize)
})

function cardLabel(card: { kind: string; name?: string }) {
  return card.kind === 'building' ? card.name! : '消費財'
}

function handCount(hand: HandCard[]): number {
  return hand.length
}
function handDetail(hand: HandCard[]): string {
  const total = hand.length
  if (total === 0) return ''
  const buildings = hand.filter(c => c.kind === 'building').length
  const consumptions = total - buildings
  if (consumptions > 0) return `（建物${buildings}+消費財${consumptions}）`
  return `（建物${buildings}）`
}
function handDisplay(hand: HandCard[]): string {
  const total = hand.length
  if (total === 0) return '0'
  const buildings = hand.filter(c => c.kind === 'building').length
  const consumptions = total - buildings
  if (consumptions > 0) return `${total}（建物${buildings}+消費財${consumptions}）`
  return `${total}（建物${buildings}）`
}
function workerNames(workerIds: string[]): string[] {
  if (!game.value) return []
  return workerIds.map(wid => {
    const p = game.value!.players.find(pl => pl.workers.some(w => w.id === wid))
    return p?.name ?? '?'
  })
}
function workerStatus(workers: Worker[]): string {
  const available = workers.filter(w => !w.isTraining && !w.placedAt).length
  return `${available}/${workers.length}`
}

function bcardNameStyle(name: string, small = false): Record<string, string> {
  const usable = small ? 46 : 64
  const base   = small ? 11 : 14
  if (!name || name.length * base <= usable) return {}
  return { fontSize: Math.max(8, Math.floor(usable / name.length)) + 'px' }
}

function effectDesc(effect: GameEffect): string {
  switch (effect.kind) {
    case 'draw':               return `山札から建物カードを${effect.n}枚引く`
    case 'draw-consumption':   return `消費財を${effect.n}枚引く`
    case 'draw-become-start':  return `カードを1枚引き、スタートプレイヤーになる`
    case 'slash-burn':         return `消費財を5枚引く。ラウンド終了時に廃棄`
    case 'gain-supply':        return `家計から $${effect.n} もらう（家計に$${effect.n}以上必要）`
    case 'reveal-pick':        return `山札から建物カード${effect.n}枚を公開し、1枚選んで手札に加える`
    case 'discard-draw':       return `手札${effect.discard}枚捨てて山札から${effect.draw}枚引く`
    case 'build':              return effect.discount > 0
                                 ? `コスト${effect.discount}割引で建設${effect.drawAfter > 0 ? `。その後${effect.drawAfter}枚引く` : ''}`
                                 : `建設する${effect.drawAfter > 0 ? `。その後${effect.drawAfter}枚引く` : ''}`
    case 'draw-consumption-to':return `消費財を計${effect.target}枚になるまで引く（手札${effect.target}枚以上なら配置不可）`
    case 'build-farm-free':    return `農場を1棟無料で建設`
    case 'discard-gain':       return `手札${effect.discard}枚捨てて家計から $${effect.gain} もらう（家計に$${effect.gain}以上必要）`
    case 'add-worker':         return `労働者を1人雇う${effect.immediate ? '（即時使用可）' : ''}`
    case 'fill-workers':       return `労働者を${effect.target}人になるまで雇う`
    case 'build-double':       return `同コストの建物を2棟同時に建設（コスト1つ分を支払う）`
    case 'draw-if-empty':      return `手札0枚なら${effect.empty}枚、手札1枚以上なら${effect.normal}枚引く`
    case 'p-hand-limit':       return `手札上限 +${effect.n}（恒久効果）`
    case 'p-worker-limit':     return `雇用できる労働者の上限 +${effect.n}（恒久効果）`
    case 'p-forgive-wages':    return `ゲーム終了時、未払い賃金を最大${effect.max}枚まで免除`
    case 'p-per-building':     return `ゲーム終了時、所有建物1棟につき +${effect.pts}点`
    case 'p-per-consumption':  return `ゲーム終了時、手札の消費財1枚につき +${effect.pts}点`
    case 'p-per-worker':       return `ゲーム終了時、労働者1人につき +${effect.pts}点`
    case 'p-per-no-sell':      return `ゲーム終了時、売却不可の建物1棟につき +${effect.pts}点`
    case 'p-per-factory':      return `ゲーム終了時、工場系建物1棟につき +${effect.pts}点`
    case 'none':               return `効果なし`
    default:                   return ''
  }
}
function cardTooltip(name: string): string {
  const d = getBuildingDef(name)
  if (!d) return ''
  const desc = effectDesc(d.effect)
  const labels: string[] = []
  if (!d.canSell) labels.push('売却不可')
  if (!d.isWorkplace) labels.push('使用不可')
  if (labels.length === 0) return desc
  return desc + '\n' + labels.join(' / ')
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
        <span class="hbadge">山札 {{ game.buildingDeck.length }}枚</span>
      </div>
      <div class="mobile-undo-bar">
        <button class="btn-undo" :disabled="!canUndo" @click="undo">◀</button>
        <button v-if="(cpuPaused && !canRedo || settingsPaused) && game?.phase !== 'game-over'" class="btn-redo" @click="emit('resume')">▶ 続ける</button>
        <button v-else class="btn-redo" :disabled="!canRedo" @click="redo">▶</button>
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
                <div class="cpu-header">
                  <span class="cpu-name">{{ cpu.name }}</span>
                  <span v-if="cpu.unpaidWages > 0" class="unpaid-badge">未払い{{ cpu.unpaidWages }}</span>
                  <span class="worker-badge">労働者{{ workerStatus(cpu.workers) }}</span>
                  <span class="cpu-money">${{ cpu.money }}</span>
                  <span class="hand-count">手札{{ handDisplay(cpu.hand) }}</span>
                  <span v-if="game.startPlayerIndex === cpu.id" class="sp-badge">🚩SP</span>
                </div>
                <div class="cpu-cards-scroll">
                  <div class="card-wrap">
                    <div v-for="b in cpu.ownedBuildings" :key="b.id"
                      :class="['bcard', { used: b.workerHereId !== null, 'card-activated': activatedIds.includes(b.id), 'card-built': builtIds.includes(b.id) }]"
                      @mouseenter="tipEnter($event, cardTooltip(b.name))"
                      @mouseleave="tipLeave">
                      <span v-if="b.workerHereId !== null" class="bcard-used-label">使用済</span>
                      <span class="bcard-cost">{{ getBuildingDef(b.name)?.cost }}</span>
                      <span class="bcard-name" :style="bcardNameStyle(b.name, true)">{{ b.name }}</span>
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
            <div class="section-label">一般職場</div>
            <div class="wp-cards-scroll">
              <div class="card-wrap">
                <div
                  v-for="wp in game.publicWorkplaces" :key="wp.id"
                  :class="['wpcard', { used: wp.workerIds.length > 0 && !wp.allowMultiple, available: canPlayerAct && availablePublicWorkplaces.some(w => w.id === wp.id), 'card-activated': activatedIds.includes(wp.id) }]"
                  @mouseenter="tipEnter($event, effectDesc(wp.effect))"
                  @mouseleave="tipLeave"
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
              <span class="worker-badge">労働者{{ humanPlayer ? workerStatus(humanPlayer.workers) : '' }}</span>
              <span class="player-money">${{ humanPlayer?.money }}</span>
              <span v-if="game.startPlayerIndex === humanPlayer?.id" class="sp-badge">🚩SP</span>
            </div>

            <!-- Pending action -->
            <div v-if="pendingAction" class="pending-area">
              <template v-if="pendingAction.kind === 'choose-build-target' || pendingAction.kind === 'choose-farm-build'">
                <div class="pending-title-row">
                  <span class="pending-title">
                    {{ pendingAction.kind === 'choose-farm-build' ? `${pendingAction.sourceName}で農場を選択（無料）`
                     : `${pendingAction.sourceName}で建設する建物を選択` }}
                  </span>
                  <select v-model="handSort" class="hand-sort-select">
                    <option value="order">入手順</option>
                    <option value="cost">コスト順</option>
                  </select>
                </div>
                <div class="card-wrap">
                  <button v-for="card in sortedBuildableCards" :key="card.id"
                    class="bcard selectable"
                    @mouseenter="tipEnter($event, cardTooltip(card.name))"
                    @mouseleave="tipLeave"
                    @click="clickBuildTarget(card.id)">
                    <span class="bcard-cost">{{ getBuildingDef(card.name)?.cost }}</span>
                    <span class="bcard-name" :style="bcardNameStyle(card.name)">{{ card.name }}</span>
                    <span class="bcard-asset">{{ getBuildingDef(card.name)?.assetValue }}</span>
                  </button>
                  <span v-if="sortedBuildableCards.length === 0" class="no-options">建設できる建物がありません</span>
                </div>
                <button class="btn-cancel" @click="clickCancelBuildChoice">キャンセル</button>
              </template>

              <template v-else-if="pendingAction.kind === 'choose-double-first' || pendingAction.kind === 'choose-double-second'">
                <div class="pending-title-row">
                  <span class="pending-title">{{ pendingAction.sourceName }}で2棟同時に選択（同コスト2棟）</span>
                  <select v-model="handSort" class="hand-sort-select">
                    <option value="order">入手順</option>
                    <option value="cost">コスト順</option>
                  </select>
                </div>
                <div class="card-wrap">
                  <button v-for="card in sortedBuildableCards" :key="card.id"
                    :class="['bcard', 'selectable', { selected: doubleSelectedIds.includes(card.id), 'card-disabled': isDoubleCardDisabled(card.id) }]"
                    @mouseenter="tipEnter($event, cardTooltip(card.name))"
                    @mouseleave="tipLeave"
                    @click="clickDoubleSelect(card.id)">
                    <span class="bcard-cost">{{ getBuildingDef(card.name)?.cost }}</span>
                    <span class="bcard-name" :style="bcardNameStyle(card.name)">{{ card.name }}</span>
                    <span class="bcard-asset">{{ getBuildingDef(card.name)?.assetValue }}</span>
                  </button>
                  <span v-if="sortedBuildableCards.length === 0" class="no-options">建設できる建物がありません</span>
                </div>
                <button class="btn-cancel" @click="cancelDoubleSelect">キャンセル</button>
              </template>

              <template v-else-if="pendingAction.kind === 'choose-build-payment' || pendingAction.kind === 'choose-double-payment'">
                <div class="pending-title-row">
                  <span class="pending-title">
                    {{ pendingAction.kind === 'choose-build-payment'
                      ? pendingAction.targetName
                      : `${(humanPlayer!.hand.find(c => c.id === (pendingAction as any).firstId) as any)?.name}と${(humanPlayer!.hand.find(c => c.id === (pendingAction as any).secondId) as any)?.name}` }}の建設コスト{{ (pendingAction as any).cost }}枚選択 ({{ paymentSelected.length }}/{{ (pendingAction as any).cost }})
                  </span>
                </div>
                <div class="card-wrap">
                  <button
                    v-for="card in sortedHand.filter(c => c.id !== (pendingAction as any).targetId && c.id !== (pendingAction as any).firstId && c.id !== (pendingAction as any).secondId)"
                    :key="card.id"
                    :class="['hcard', 'selectable', { selected: paymentSelected.includes(card.id), 'card-drawn': drawnIds.includes(card.id) }]"
                    @click="clickPaymentCard(card.id)">
                    <span v-if="card.kind === 'building'" class="bcard-cost">{{ getBuildingDef(card.name!)?.cost }}</span>
                    <span class="bcard-name" :style="card.kind === 'building' ? bcardNameStyle(card.name!) : {}">{{ cardLabel(card) }}</span>
                    <span v-if="card.kind === 'building'" class="bcard-asset">{{ getBuildingDef(card.name!)?.assetValue }}</span>
                  </button>
                </div>
                <button class="btn-cancel" @click="pendingAction.kind === 'choose-build-payment' ? clickCancelBuildPayment() : clickCancelDoublePayment()">戻る</button>
              </template>

              <template v-else-if="pendingAction.kind === 'choose-discard'">
                <div class="pending-title-row">
                  <span class="pending-title">{{ pendingAction.sourceName }}の捨て札を選択 ({{ pendingAction.selected.length }}/{{ pendingAction.count }})</span>
                  <select v-model="handSort" class="hand-sort-select">
                    <option value="order">入手順</option>
                    <option value="cost">コスト順</option>
                  </select>
                </div>
                <div class="card-wrap">
                  <button v-for="card in sortedHand" :key="card.id"
                    :class="['hcard', 'selectable', { selected: pendingAction.selected.includes(card.id), 'card-drawn': drawnIds.includes(card.id) }]"
                    @click="clickDiscardCard(card.id)">
                    <span v-if="card.kind === 'building'" class="bcard-cost">{{ getBuildingDef(card.name!)?.cost }}</span>
                    <span class="bcard-name" :style="card.kind === 'building' ? bcardNameStyle(card.name!) : {}">{{ cardLabel(card) }}</span>
                    <span v-if="card.kind === 'building'" class="bcard-asset">{{ getBuildingDef(card.name!)?.assetValue }}</span>
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
                    @mouseenter="card.kind === 'building' && tipEnter($event, cardTooltip(card.name!))"
                    @mouseleave="tipLeave"
                    @click="clickRevealedCard(card.id)">
                    <span class="bcard-name" :style="card.kind === 'building' ? bcardNameStyle(card.name!) : {}">{{ cardLabel(card) }}</span>
                  </button>
                </div>
              </template>

              <template v-else-if="pendingAction.kind === 'choose-hand-limit'">
                <div class="pending-title-row">
                  <span class="pending-title hand-limit-title">
                    ⚠ 手札上限超過（上限{{ pendingAction.limit }}枚）：{{ pendingAction.count }}枚捨ててください
                    （{{ pendingAction.selected.length }}/{{ pendingAction.count }}）
                  </span>
                </div>
                <div class="card-wrap">
                  <button v-for="card in sortedHand" :key="card.id"
                    :class="['hcard', 'selectable', { selected: pendingAction.selected.includes(card.id), 'card-drawn': drawnIds.includes(card.id) }]"
                    @mouseenter="card.kind === 'building' && tipEnter($event, cardTooltip(card.name!))"
                    @mouseleave="tipLeave"
                    @click="clickHandLimitCard(card.id)">
                    <span v-if="card.kind === 'building'" class="bcard-cost">{{ getBuildingDef(card.name!)?.cost }}</span>
                    <span class="bcard-name" :style="card.kind === 'building' ? bcardNameStyle(card.name!) : {}">{{ cardLabel(card) }}</span>
                    <span v-if="card.kind === 'building'" class="bcard-asset">{{ getBuildingDef(card.name!)?.assetValue }}</span>
                  </button>
                </div>
              </template>

              <template v-else-if="pendingAction.kind === 'choose-sell-buildings'">
                <div class="pending-title-row">
                  <span class="pending-title sell-warning">
                    ⚠ 賃金不足のため売却する建物を選択（選択中 ${{ pendingAction.selected.reduce((s, id) => s + (getBuildingDef(humanPlayer!.ownedBuildings.find(b => b.id === id)?.name ?? '')?.assetValue ?? 0), 0) }} / 必要額 ${{ pendingAction.deficit }}）
                  </span>
                </div>
                <div class="card-wrap">
                  <button
                    v-for="id in pendingAction.sellableIds" :key="id"
                    :class="['bcard', 'selectable', { selected: pendingAction.selected.includes(id) }]"
                    @mouseenter="tipEnter($event, cardTooltip(humanPlayer!.ownedBuildings.find(b => b.id === id)?.name ?? ''))"
                    @mouseleave="tipLeave"
                    @click="clickToggleSellBuilding(id)">
                    <span class="bcard-cost">{{ getBuildingDef(humanPlayer!.ownedBuildings.find(b => b.id === id)?.name ?? '')?.cost }}</span>
                    <span class="bcard-name" :style="bcardNameStyle(humanPlayer!.ownedBuildings.find(b => b.id === id)?.name ?? '')">{{ humanPlayer!.ownedBuildings.find(b => b.id === id)?.name }}</span>
                    <span class="bcard-asset">{{ getBuildingDef(humanPlayer!.ownedBuildings.find(b => b.id === id)?.name ?? '')?.assetValue }}</span>
                  </button>
                </div>
                <div v-if="sellBuildingError" class="sell-error">{{ sellBuildingError }}</div>
                <button class="btn-confirm" :disabled="pendingAction.selected.length === 0" @click="clickConfirmSellBuildings">確定</button>
              </template>
            </div>

            <!-- Normal view (no pending) -->
            <div v-else class="player-content">
              <div v-if="humanPlayer?.ownedBuildings.length" class="player-subsection">
                <div class="bld-scroll">
                  <div class="card-wrap">
                    <div v-for="b in humanPlayer.ownedBuildings" :key="b.id"
                      :class="['bcard', { used: b.workerHereId !== null, available: canPlayerAct && availableOwnedBuildings.some(x => x.id === b.id), 'card-activated': activatedIds.includes(b.id), 'card-built': builtIds.includes(b.id) }]"
                      @mouseenter="tipEnter($event, cardTooltip(b.name))"
                      @mouseleave="tipLeave"
                      @click="canPlayerAct && availableOwnedBuildings.some(x => x.id === b.id) && clickOwnedBuilding(b.id)">
                      <span v-if="b.workerHereId !== null" class="bcard-used-label">使用済</span>
                      <span class="bcard-cost">{{ getBuildingDef(b.name)?.cost }}</span>
                      <span class="bcard-name" :style="bcardNameStyle(b.name)">{{ b.name }}</span>
                      <span class="bcard-asset">{{ getBuildingDef(b.name)?.assetValue }}</span>
                    </div>
                  </div>
                </div>
              </div>
              <div class="player-subsection">
                <div class="hand-label-row">
                  <div class="subsection-label"><span class="hand-count-bold">手札{{ handCount(humanPlayer?.hand ?? []) }}</span>{{ handDetail(humanPlayer?.hand ?? []) }}</div>
                  <select v-model="handSort" class="hand-sort-select">
                    <option value="order">入手順</option>
                    <option value="cost">コスト順</option>
                  </select>
                </div>
                <div class="hand-scroll">
                  <div class="card-wrap">
                    <div v-for="card in sortedHand" :key="card.id"
                      :class="['hcard', { 'card-drawn': drawnIds.includes(card.id) }]"
                      @mouseenter="card.kind === 'building' && tipEnter($event, cardTooltip(card.name!))"
                      @mouseleave="tipLeave">
                      <span v-if="card.kind === 'building'" class="bcard-cost">{{ getBuildingDef(card.name!)?.cost }}</span>
                      <span class="bcard-name" :style="card.kind === 'building' ? bcardNameStyle(card.name!) : {}">{{ cardLabel(card) }}</span>
                      <span v-if="card.kind === 'building'" class="bcard-asset">{{ getBuildingDef(card.name!)?.assetValue }}</span>
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
          <button class="btn-restart" @click="emit('openSetup')">ゲーム設定</button>
          <button class="btn-restart" @click="emit('openSummary')">ラウンド毎の情報</button>
        </div>
        <div class="log-undo-bar">
          <button class="btn-undo" :disabled="!canUndo" @click="undo">◀ 戻る</button>
          <button v-if="(cpuPaused && !canRedo || settingsPaused) && game?.phase !== 'game-over'" class="btn-redo" @click="emit('resume')">▶ 続ける</button>
          <button v-else class="btn-redo" :disabled="!canRedo" @click="redo">進む ▶</button>
        </div>
        <div class="log-label">ログ</div>
        <div
          v-for="(msg, i) in [...game.log].reverse()"
          :key="i"
          :class="logLineClass(msg, i)"
          @mouseenter="onLogMouseenter(msg, i)"
          @mouseleave="onLogMouseleave"
          @click="onLogClick(msg, i)"
        >{{ msg }}</div>
      </div>

    </div><!-- /game-body -->
  </div>
</template>
