<script setup lang="ts">
import { ref, computed } from 'vue'
import { useGame } from '../composables/useGame'
import type { Worker, GameEffect } from '../game/types'

const props = defineProps<{
  activatedIds: string[]
  builtIds: string[]
  canPlayerAct: boolean
  tipEnter: (e: MouseEvent, text: string) => void
  tipLeave: () => void
}>()

const emit = defineEmits<{
  menuOpen: []
  openSetup: []
}>()

const {
  game, humanPlayer,
  availablePublicWorkplaces, availableOwnedBuildings,
  pendingAction, paymentSelected, buildableCards, currentWage,
  getBuildingDef,
  clickPublicWorkplace, clickOwnedBuilding,
  clickBuildTarget, clickPaymentCard, clickCancelBuildChoice, clickCancelBuildPayment,
  clickCancelDoubleSecond, clickCancelDoublePayment,
  clickDiscardCard, clickRevealedCard, clickHandLimitCard,
  undo, redo, canUndo, canRedo,
} = useGame()

const cpuPlayers = computed(() => game.value?.players.filter(p => p.isCpu) ?? [])

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

function cardLabel(card: { kind: string; name?: string }) {
  return card.kind === 'building' ? card.name! : '消費財'
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
  return effectDesc(d.effect)
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
                  <span class="hand-count">手札{{ cpu.hand.length }}</span>
                  <span v-if="game.startPlayerIndex === cpu.id" class="sp-badge">🚩SP</span>
                </div>
                <div class="cpu-cards-scroll">
                  <div class="card-wrap">
                    <div v-for="b in cpu.ownedBuildings" :key="b.id"
                      :class="['bcard', { used: b.workerHereId !== null, 'card-activated': activatedIds.includes(b.id), 'card-built': builtIds.includes(b.id) }]"
                      @mouseenter="tipEnter($event, cardTooltip(b.name))"
                      @mouseleave="tipLeave">
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

        <!-- ▼ Row 1: 公共施設 -->
        <div class="game-col" :style="{ height: rowHeights[1] + '%' }">
          <section class="section workplaces-section">
            <div class="section-label">公共施設</div>
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
              <span class="hand-count">手札{{ humanPlayer?.hand.length }}</span>
              <span v-if="game.startPlayerIndex === humanPlayer?.id" class="sp-badge">🚩SP</span>
            </div>

            <!-- Pending action -->
            <div v-if="pendingAction" class="pending-area">
              <template v-if="pendingAction.kind === 'choose-build-target' || pendingAction.kind === 'choose-farm-build' || pendingAction.kind === 'choose-double-first'">
                <span class="pending-title">
                  {{ pendingAction.kind === 'choose-farm-build' ? '農場を選択（無料）'
                   : pendingAction.kind === 'choose-double-first' ? '1棟目を選択（同コスト2棟）'
                   : '建設する建物を選択' }}
                </span>
                <div class="card-wrap">
                  <button v-for="card in buildableCards" :key="card.id"
                    class="bcard selectable"
                    @mouseenter="tipEnter($event, cardTooltip(card.name))"
                    @mouseleave="tipLeave"
                    @click="clickBuildTarget(card.id)">
                    <span class="bcard-cost">{{ getBuildingDef(card.name)?.cost }}</span>
                    <span class="bcard-name" :style="bcardNameStyle(card.name)">{{ card.name }}</span>
                    <span class="bcard-asset">{{ getBuildingDef(card.name)?.assetValue }}</span>
                  </button>
                  <span v-if="buildableCards.length === 0" class="no-options">建設できる建物がありません</span>
                </div>
                <button class="btn-cancel" @click="clickCancelBuildChoice">キャンセル</button>
              </template>

              <template v-else-if="pendingAction.kind === 'choose-double-second'">
                <span class="pending-title">2棟目を選択（コスト{{ pendingAction.firstCost }}）</span>
                <div class="card-wrap">
                  <button
                    v-for="card in humanPlayer!.hand.filter(c => c.kind === 'building' && getBuildingDef(c.name!)?.cost === (pendingAction as any).firstCost && c.id !== (pendingAction as any).firstId)"
                    :key="card.id" class="bcard selectable"
                    @mouseenter="card.kind === 'building' && tipEnter($event, cardTooltip(card.name!))"
                    @mouseleave="tipLeave"
                    @click="clickBuildTarget(card.id)">
                    <span class="bcard-cost">{{ getBuildingDef((card as any).name)?.cost }}</span>
                    <span class="bcard-name" :style="bcardNameStyle((card as any).name)">{{ (card as any).name }}</span>
                    <span class="bcard-asset">{{ getBuildingDef((card as any).name)?.assetValue }}</span>
                  </button>
                </div>
                <button class="btn-cancel" @click="clickCancelDoubleSecond">戻る</button>
              </template>

              <template v-else-if="pendingAction.kind === 'choose-build-payment' || pendingAction.kind === 'choose-double-payment'">
                <span class="pending-title">支払い {{ (pendingAction as any).cost }}枚選択 ({{ paymentSelected.length }}/{{ (pendingAction as any).cost }})</span>
                <div class="card-wrap">
                  <button
                    v-for="card in humanPlayer!.hand.filter(c => c.id !== (pendingAction as any).targetId && c.id !== (pendingAction as any).firstId && c.id !== (pendingAction as any).secondId)"
                    :key="card.id"
                    :class="['hcard', 'selectable', { selected: paymentSelected.includes(card.id) }]"
                    @click="clickPaymentCard(card.id)">
                    <span v-if="card.kind === 'building'" class="bcard-cost">{{ getBuildingDef(card.name!)?.cost }}</span>
                    <span class="bcard-name" :style="card.kind === 'building' ? bcardNameStyle(card.name!) : {}">{{ cardLabel(card) }}</span>
                    <span v-if="card.kind === 'building'" class="bcard-asset">{{ getBuildingDef(card.name!)?.assetValue }}</span>
                  </button>
                </div>
                <button class="btn-cancel" @click="pendingAction.kind === 'choose-build-payment' ? clickCancelBuildPayment() : clickCancelDoublePayment()">戻る</button>
              </template>

              <template v-else-if="pendingAction.kind === 'choose-discard'">
                <span class="pending-title">捨て札を選択 ({{ pendingAction.selected.length }}/{{ pendingAction.count }})</span>
                <div class="card-wrap">
                  <button v-for="card in humanPlayer!.hand" :key="card.id"
                    :class="['hcard', 'selectable', { selected: pendingAction.selected.includes(card.id) }]"
                    @click="clickDiscardCard(card.id)">
                    <span v-if="card.kind === 'building'" class="bcard-cost">{{ getBuildingDef(card.name!)?.cost }}</span>
                    <span class="bcard-name" :style="card.kind === 'building' ? bcardNameStyle(card.name!) : {}">{{ cardLabel(card) }}</span>
                    <span v-if="card.kind === 'building'" class="bcard-asset">{{ getBuildingDef(card.name!)?.assetValue }}</span>
                  </button>
                </div>
              </template>

              <template v-else-if="pendingAction.kind === 'choose-from-revealed'">
                <span class="pending-title">1枚選択（残りは捨て札）</span>
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
                <span class="pending-title hand-limit-title">
                  ⚠ 手札上限超過（上限{{ pendingAction.limit }}枚）：{{ pendingAction.count }}枚捨ててください
                  （{{ pendingAction.selected.length }}/{{ pendingAction.count }}）
                </span>
                <div class="card-wrap">
                  <button v-for="card in humanPlayer!.hand" :key="card.id"
                    :class="['hcard', 'selectable', { selected: pendingAction.selected.includes(card.id) }]"
                    @mouseenter="card.kind === 'building' && tipEnter($event, cardTooltip(card.name!))"
                    @mouseleave="tipLeave"
                    @click="clickHandLimitCard(card.id)">
                    <span v-if="card.kind === 'building'" class="bcard-cost">{{ getBuildingDef(card.name!)?.cost }}</span>
                    <span class="bcard-name" :style="card.kind === 'building' ? bcardNameStyle(card.name!) : {}">{{ cardLabel(card) }}</span>
                    <span v-if="card.kind === 'building'" class="bcard-asset">{{ getBuildingDef(card.name!)?.assetValue }}</span>
                  </button>
                </div>
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
                      <span class="bcard-cost">{{ getBuildingDef(b.name)?.cost }}</span>
                      <span class="bcard-name" :style="bcardNameStyle(b.name)">{{ b.name }}</span>
                      <span class="bcard-asset">{{ getBuildingDef(b.name)?.assetValue }}</span>
                    </div>
                  </div>
                </div>
              </div>
              <div class="player-subsection">
                <div class="subsection-label">手札</div>
                <div class="hand-scroll">
                  <div class="card-wrap">
                    <div v-for="card in humanPlayer?.hand" :key="card.id"
                      class="hcard"
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
          <span class="hbadge">ラウンド {{ game.round }}/9</span>
          <span class="hbadge">賃金 ${{ currentWage }}</span>
          <span class="hbadge">家計 ${{ game.household }}</span>
          <button class="btn-restart" @click="emit('openSetup')">作り直す</button>
        </div>
        <div class="log-undo-bar">
          <button class="btn-undo" :disabled="!canUndo" @click="undo">◀ 戻る</button>
          <button class="btn-redo" :disabled="!canRedo" @click="redo">進む ▶</button>
        </div>
        <div class="log-label">ログ</div>
        <div v-for="(msg, i) in [...game.log].reverse().slice(0, 80)" :key="i" class="log-line">{{ msg }}</div>
      </div>

    </div><!-- /game-body -->
  </div>
</template>
