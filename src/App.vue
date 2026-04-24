<script setup lang="ts">
import { ref, onMounted, computed, watch } from 'vue'
import { useGame } from './composables/useGame'
import type { GameEffect, Worker } from './game/types'

const {
  game, humanPlayer, isHumanTurn, currentWage,
  availablePublicWorkplaces, availableOwnedBuildings,
  pendingAction, paymentSelected, buildableCards, scores, getBuildingDef,
  startGame, startDebugGame, runCpuTurns, cpuStepAction, autoAdvanceIfStuck,
  clickPublicWorkplace, clickOwnedBuilding,
  clickBuildTarget, clickPaymentCard, clickCancelBuildChoice, clickCancelBuildPayment,
  clickCancelDoubleSecond, clickCancelDoublePayment,
  clickDiscardCard, confirmDiscardAction, clickCancelDiscardChoice,
  clickRevealedCard,
  clickHandLimitCard, confirmHandLimitDiscardAction,
} = useGame()

const showSetup = ref(false)
const setupCpu = ref(3)   // 1〜3: 通常, 4: CPU4体（プレイヤーなし）
const menuOpen = ref(false)
const skipAnim = ref(false)

// ---- アニメーション管理 ----
const activatedIds = ref<string[]>([])   // 労働者が配置されたカード
const builtIds = ref<string[]>([])       // 建設されたカード
const roundAnimRound = ref<number | null>(null)

const ANIM_DURATION = 900   // カードアニメーション ms
const ROUND_ANIM_DURATION = 1200

// アニメーション中はプレイヤー操作を禁止する
const isAnimating = ref(false)
let animEndTimer: ReturnType<typeof setTimeout> | null = null

function setAnimating(totalMs: number) {
  if (skipAnim.value) return
  isAnimating.value = true
  if (animEndTimer !== null) clearTimeout(animEndTimer)
  animEndTimer = setTimeout(() => { isAnimating.value = false }, totalMs)
}

function flashActivated(id: string) {
  if (skipAnim.value) return
  activatedIds.value = [...activatedIds.value, id]
  setAnimating(ANIM_DURATION + 50)
  setTimeout(() => { activatedIds.value = activatedIds.value.filter(x => x !== id) }, ANIM_DURATION)
}
function flashBuilt(id: string) {
  if (skipAnim.value) return
  builtIds.value = [...builtIds.value, id]
  setAnimating(ANIM_DURATION + 100 + 50)
  setTimeout(() => { builtIds.value = builtIds.value.filter(x => x !== id) }, ANIM_DURATION + 100)
}
function triggerRoundAnim(round: number) {
  if (skipAnim.value) return
  roundAnimRound.value = round
  setTimeout(() => { roundAnimRound.value = null }, ROUND_ANIM_DURATION)
}

// プレイヤーが実際に操作可能かどうか
// (自分のターン・アニメーション終了済み・pendingAction なし)
const canPlayerAct = computed(() =>
  isHumanTurn.value && !isAnimating.value && !pendingAction.value
)

// カードアニメーション・ラウンドアニメーション・CPUステップを統合管理
watch(game, (newGame, oldGame) => {
  if (!newGame || !oldGame) return

  const hasRoundChange = newGame.round === oldGame.round + 1

  // ── 即時: カードアニメーション ──
  for (const newWp of newGame.publicWorkplaces) {
    const oldWp = oldGame.publicWorkplaces.find(w => w.id === newWp.id)
    if (oldWp && newWp.workerIds.length > oldWp.workerIds.length) flashActivated(newWp.id)
  }
  for (const newP of newGame.players) {
    const oldP = oldGame.players.find(p => p.id === newP.id)
    if (!oldP) continue
    for (const newB of newP.ownedBuildings) {
      const oldB = oldP.ownedBuildings.find(b => b.id === newB.id)
      if (!oldB) flashBuilt(newB.id)
      else if (newB.workerHereId !== null && oldB.workerHereId === null) flashActivated(newB.id)
    }
  }

  // ── カードアニメ終了後: ラウンドアニメーション ──
  if (hasRoundChange) {
    const roundDelay = skipAnim.value ? 0 : ANIM_DURATION + 50
    setTimeout(() => triggerRoundAnim(newGame.round), roundDelay)
    // ラウンド切り替えアニメ中もブロック
    if (!skipAnim.value) setAnimating(ANIM_DURATION + 50 + ROUND_ANIM_DURATION + 100)
  }

  // ── CPUターン or プレイヤースタック検出: アニメーション完了後に実行 ──
  if (newGame.phase === 'placement') {
    const current = newGame.players[newGame.currentPlayerIndex]

    if (current?.isCpu) {
      if (skipAnim.value) {
        // スキップ時はバッチ処理（全CPU一括）
        runCpuTurns()
      } else {
        // カードアニメ + ラウンドアニメの合計待機時間
        const cpuDelay = hasRoundChange
          ? ANIM_DURATION + 50 + ROUND_ANIM_DURATION + 100
          : ANIM_DURATION + 50
        setTimeout(() => cpuStepAction(), cpuDelay)
      }
    } else {
      // プレイヤーのターン: ワーカーが0なのに待機状態になっていたら自動スキップ
      // (advanceTurnNoCpu がプレイヤーに来てしまう稀なバグへの安全網)
      if (!newGame.pendingAction) {
        const avail = current?.workers.filter(w => !w.isTraining && w.placedAt === null) ?? []
        if (avail.length === 0) {
          const snapIndex = newGame.currentPlayerIndex
          const delay = hasRoundChange
            ? ANIM_DURATION + 50 + ROUND_ANIM_DURATION + 150
            : ANIM_DURATION + 100
          setTimeout(() => {
            // まだ同じプレイヤーインデックスで止まっていれば自動スキップ
            if (game.value?.currentPlayerIndex === snapIndex && game.value.phase === 'placement') {
              autoAdvanceIfStuck()
            }
          }, delay)
        }
      }
    }
  }
})

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

const tooltipState = ref<{ text: string; x: number; y: number } | null>(null)
function onTipEnter(e: MouseEvent, text: string) {
  if (!text) return
  tooltipState.value = { text, x: e.clientX, y: e.clientY }
}
function onTipLeave() {
  tooltipState.value = null
}

onMounted(() => {
  startGame({ humanName: 'プレイヤー', cpuCount: 3 })
})

function openSetup() { showSetup.value = true }
function beginGame() {
  if (setupCpu.value === 4) {
    startGame({ humanName: '', cpuCount: 4, cpuOnly: true })
  } else {
    startGame({ humanName: 'プレイヤー', cpuCount: setupCpu.value })
  }
  showSetup.value = false
}
function beginDebugGame() {
  // デバッグは常にプレイヤーあり（CPU最大3人）
  startDebugGame(Math.min(setupCpu.value, 3))
  showSetup.value = false
}
function replayGame() {
  const cpuCount = game.value!.players.filter(p => p.isCpu).length
  const isAllCpu = !game.value!.players.some(p => !p.isCpu)
  if (isAllCpu) {
    startGame({ humanName: '', cpuCount, cpuOnly: true })
  } else {
    startGame({ humanName: humanPlayer.value?.name ?? 'プレイヤー', cpuCount })
  }
}

const cpuPlayers = computed(() => game.value?.players.filter(p => p.isCpu) ?? [])

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

// カード幅に合わせて建物名フォントサイズを自動調整（1行に収める）
// small=true は CPU 用の小カード（58px幅）
function bcardNameStyle(name: string, small = false): Record<string, string> {
  const usable = small ? 46 : 64   // カード内の水平方向の使える幅 (px)
  const base   = small ? 11 : 14   // ベースフォントサイズ (px)
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
  <!-- Setup modal -->
  <div v-if="showSetup" class="modal-overlay">
    <div class="modal">
      <h2>ゲーム設定</h2>
      <div class="radio-group-label">CPU数</div>
      <div class="radio-group">
        <label class="radio-item">
          <input type="radio" v-model.number="setupCpu" :value="1" />
          <span>1人</span>
        </label>
        <label class="radio-item">
          <input type="radio" v-model.number="setupCpu" :value="2" />
          <span>2人</span>
        </label>
        <label class="radio-item">
          <input type="radio" v-model.number="setupCpu" :value="3" />
          <span>3人</span>
        </label>
        <label class="radio-item">
          <input type="radio" v-model.number="setupCpu" :value="4" />
          <span>4人（プレイヤーなし）</span>
        </label>
      </div>
      <label class="check-item">
        <input type="checkbox" v-model="skipAnim" />
        <span>アニメーションをスキップ</span>
      </label>
      <div class="modal-actions">
        <button class="btn-primary" @click="beginGame">ゲーム開始</button>
        <button class="btn-debug" @click="beginDebugGame">デバッグスタート</button>
        <button v-if="game" class="btn-secondary" @click="showSetup = false">キャンセル</button>
      </div>
    </div>
  </div>

  <!-- Game over -->
  <div v-else-if="game?.phase === 'game-over'" class="gameover">
    <div class="gameover-card">
      <h1>ゲーム終了</h1>
      <table>
        <thead><tr><th>プレイヤー</th><th>建物</th><th>残金</th><th>ボーナス</th><th>ペナルティ</th><th>合計</th></tr></thead>
        <tbody>
          <tr v-for="sc in scores" :key="sc.playerId"
            :class="{ winner: sc.playerId === scores!.reduce((a,b) => a.total > b.total ? a : b).playerId }">
            <td>{{ game!.players[sc.playerId].name }}</td>
            <td>${{ sc.buildingValue }}</td>
            <td>${{ sc.money }}</td>
            <td>+{{ sc.bonuses }}</td>
            <td>-{{ sc.unpaidPenalty }}</td>
            <td><strong>${{ sc.total }}</strong></td>
          </tr>
        </tbody>
      </table>
      <p class="winner-msg">🏆 {{ game!.players[scores!.reduce((a,b) => a.total > b.total ? a : b).playerId].name }} の勝利！</p>
      <div class="gameover-actions">
        <button class="btn-primary" @click="replayGame">もう一度</button>
        <button class="btn-secondary" @click="openSetup">設定を変更</button>
      </div>
    </div>
  </div>

  <!-- Main game screen -->
  <div v-else-if="game" class="game">

    <!-- Mobile header (hidden on desktop) -->
    <div class="mobile-header">
      <div class="mobile-info">
        <span class="hbadge">ラウンド {{ game.round }}/9</span>
        <span class="hbadge">賃金 ${{ currentWage }}</span>
        <span class="hbadge">家計 ${{ game.household }}</span>
      </div>
      <button class="menu-btn" @click="menuOpen = true">☰</button>
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
                </div>
                <div class="cpu-cards-scroll">
                  <div class="card-wrap">
                    <div v-for="b in cpu.ownedBuildings" :key="b.id"
                      :class="['bcard', { used: b.workerHereId !== null, 'card-activated': activatedIds.includes(b.id), 'card-built': builtIds.includes(b.id) }]"
                      @mouseenter="onTipEnter($event, cardTooltip(b.name))"
                      @mouseleave="onTipLeave">
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
                  @mouseenter="onTipEnter($event, effectDesc(wp.effect))"
                  @mouseleave="onTipLeave"
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
                    @mouseenter="onTipEnter($event, cardTooltip(card.name))"
                    @mouseleave="onTipLeave"
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
                    @mouseenter="card.kind === 'building' && onTipEnter($event, cardTooltip(card.name!))"
                    @mouseleave="onTipLeave"
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
                <button v-if="pendingAction.selected.length === pendingAction.count" class="btn-confirm" @click="confirmDiscardAction">確定</button>
                <button class="btn-cancel" @click="clickCancelDiscardChoice">キャンセル</button>
              </template>

              <template v-else-if="pendingAction.kind === 'choose-from-revealed'">
                <span class="pending-title">1枚選択（残りは捨て札）</span>
                <div class="card-wrap">
                  <button v-for="card in pendingAction.revealed" :key="card.id"
                    class="bcard selectable"
                    @mouseenter="card.kind === 'building' && onTipEnter($event, cardTooltip(card.name!))"
                    @mouseleave="onTipLeave"
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
                    @mouseenter="card.kind === 'building' && onTipEnter($event, cardTooltip(card.name!))"
                    @mouseleave="onTipLeave"
                    @click="clickHandLimitCard(card.id)">
                    <span v-if="card.kind === 'building'" class="bcard-cost">{{ getBuildingDef(card.name!)?.cost }}</span>
                    <span class="bcard-name" :style="card.kind === 'building' ? bcardNameStyle(card.name!) : {}">{{ cardLabel(card) }}</span>
                    <span v-if="card.kind === 'building'" class="bcard-asset">{{ getBuildingDef(card.name!)?.assetValue }}</span>
                  </button>
                </div>
                <button v-if="pendingAction.selected.length === pendingAction.count"
                  class="btn-confirm" @click="confirmHandLimitDiscardAction()">確定</button>
              </template>
            </div>

            <!-- Normal view (no pending) -->
            <div v-else class="player-content">
              <div v-if="humanPlayer?.ownedBuildings.length" class="player-subsection">
                <div class="subsection-label">建設済み {{ humanPlayer.ownedBuildings.length }}棟</div>
                <div class="bld-scroll">
                  <div class="card-wrap">
                    <div v-for="b in humanPlayer.ownedBuildings" :key="b.id"
                      :class="['bcard', { used: b.workerHereId !== null, available: canPlayerAct && availableOwnedBuildings.some(x => x.id === b.id), 'card-activated': activatedIds.includes(b.id), 'card-built': builtIds.includes(b.id) }]"
                      @mouseenter="onTipEnter($event, cardTooltip(b.name))"
                      @mouseleave="onTipLeave"
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
                      @mouseenter="card.kind === 'building' && onTipEnter($event, cardTooltip(card.name!))"
                      @mouseleave="onTipLeave">
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
          <button class="btn-restart" @click="openSetup">作り直す</button>
        </div>
        <div class="log-label">ログ</div>
        <div v-for="(msg, i) in [...game.log].reverse().slice(0, 80)" :key="i" class="log-line">{{ msg }}</div>
      </div>

    </div><!-- /game-body -->
  </div>

  <Teleport to="body">
    <!-- ラウンド切り替えアニメーション -->
    <Transition name="round-fade">
      <div v-if="roundAnimRound" class="round-anim-overlay">
        <div class="round-anim-card">ラウンド {{ roundAnimRound }}</div>
      </div>
    </Transition>

    <div v-if="tooltipState" class="global-tooltip"
      :style="{ left: tooltipState.x + 'px', top: (tooltipState.y - 14) + 'px' }">
      {{ tooltipState.text }}
    </div>

    <!-- Mobile drawer -->
    <template v-if="game">
      <div class="drawer-overlay" :class="{ open: menuOpen }" @click="menuOpen = false"></div>
      <div class="drawer-panel" :class="{ open: menuOpen }">
        <div class="drawer-top">
          <span class="drawer-title">メニュー</span>
          <button class="drawer-close" @click="menuOpen = false">✕</button>
        </div>
        <div class="drawer-info">
          <span class="hbadge">ラウンド {{ game.round }}/9</span>
          <span class="hbadge">賃金 ${{ currentWage }}</span>
          <span class="hbadge">家計 ${{ game.household }}</span>
          <button class="btn-restart" @click="openSetup(); menuOpen = false">作り直す</button>
        </div>
        <div class="drawer-log-label">ログ</div>
        <div v-for="(msg, i) in [...game.log].reverse().slice(0, 80)" :key="i" class="drawer-log-line">{{ msg }}</div>
      </div>
    </template>
  </Teleport>
</template>

<style scoped>
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

/* ===== Overall layout ===== */
.game {
  height: 100vh;
  display: flex;
  flex-direction: column;
  background: #f8fafc;
  font-family: system-ui, sans-serif;
  font-size: 13px;
  color: #1e293b;
  overflow: hidden;
}

/* ===== Info badges ===== */
.hbadge {
  background: #f1f5f9;
  border: 1px solid #e2e8f0;
  border-radius: 20px;
  padding: 3px 8px;
  font-size: 11px;
  font-weight: 600;
  color: #475569;
  white-space: nowrap;
}
.btn-restart {
  background: #fff; border: 1px solid #e2e8f0; border-radius: 6px;
  padding: 3px 8px; font-size: 11px; color: #64748b; cursor: pointer; white-space: nowrap; margin-top: 4px;
}
.btn-restart:hover { background: #f8fafc; border-color: #94a3b8; }

/* ===== Mobile header (hidden on desktop) ===== */
.mobile-header {
  display: none;
  flex-shrink: 0;
  align-items: center;
  justify-content: space-between;
  padding: 6px 10px;
  background: #fff;
  border-bottom: 1px solid #e2e8f0;
  gap: 6px;
}
.mobile-info { display: flex; gap: 5px; flex-wrap: wrap; align-items: center; }
.menu-btn {
  background: none;
  border: 1px solid #e2e8f0;
  border-radius: 6px;
  font-size: 18px;
  line-height: 1;
  padding: 4px 9px;
  cursor: pointer;
  color: #475569;
  flex-shrink: 0;
}
.menu-btn:hover { background: #f1f5f9; }

/* ===== Body ===== */
.game-body {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: row;
  overflow: hidden;
}

/* ===== Responsive ===== */
@media (max-width: 640px) {
  .mobile-header { display: flex; }
  .log-panel { display: none; }
  /* スマホ: 各行の高さ固定なし・ページ全体でスクロール */
  .game { height: auto; overflow: visible; }
  .game-body { overflow: visible; height: auto; }
  .game-main { overflow: visible; height: auto; }
  .game-col { height: auto !important; overflow: visible; flex-shrink: 1; }
  .col-divider { display: none; }
  .cpu-cards-scroll, .wp-cards-scroll, .bld-scroll, .hand-scroll {
    overflow: visible;
  }
}

/* ===== Left side (縦3分割 resizable) ===== */
.game-main {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  min-width: 0;
  min-height: 0;
}

/* 各行（高さ % 指定） */
.game-col {
  width: 100%;
  display: flex;
  flex-direction: column;
  overflow-y: auto;
  overflow-x: hidden;
  padding: 8px 10px;
  gap: 8px;
  flex-shrink: 0;
  min-height: 0;
}

/* ドラッグハンドル（水平） */
.col-divider {
  height: 6px;
  width: 100%;
  flex-shrink: 0;
  cursor: row-resize;
  background: transparent;
  position: relative;
}
.col-divider::after {
  content: '';
  position: absolute;
  left: 10%;
  right: 10%;
  top: 50%;
  transform: translateY(-50%);
  height: 2px;
  background: #e2e8f0;
  border-radius: 1px;
}
.col-divider:hover::after { background: #94a3b8; }

/* ===== Sections ===== */
.section {
  background: #fff;
  border: 1px solid #e2e8f0;
  border-radius: 10px;
  padding: 10px 12px;
}
.section-label, .subsection-label {
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: #94a3b8;
  margin-bottom: 7px;
}

.cpu-section { background: #f8f9ff; border-color: #c7d2fe; flex: 1; min-height: 0; display: flex; flex-direction: column; }
.workplaces-section { background: #fffbeb; border-color: #fde68a; flex: 1; min-height: 0; }

.cpu-grid {
  display: grid;
  gap: 8px;
  flex: 1;
  min-height: 0;
  grid-auto-flow: row;
  grid-auto-rows: 1fr;
}
@media (min-width: 641px) {
  .cpu-grid {
    grid-auto-flow: column;
    grid-auto-columns: 1fr;
    grid-auto-rows: unset;
  }
}
.cpu-col {
  background: #fff;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  padding: 8px 10px;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  min-height: 0;
}
.cpu-cards-scroll {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  overflow-x: hidden;
  padding: 12px;
}
.cpu-header { display: flex; align-items: center; gap: 7px; flex-wrap: wrap; margin-bottom: 6px; }
.cpu-name { font-weight: 700; color: #6366f1; font-size: 13px; }
.cpu-money { font-weight: 700; color: #059669; }
.worker-badge {
  background: #eff6ff; border: 1px solid #bfdbfe; border-radius: 10px;
  padding: 1px 7px; font-size: 11px; font-weight: 700; color: #1d4ed8;
}
.hand-count { font-size: 11px; color: #94a3b8; }
.unpaid-badge {
  background: #fef2f2; border: 1px solid #fecaca; border-radius: 10px;
  padding: 1px 7px; font-size: 11px; font-weight: 700; color: #dc2626;
}

/* ===== Card wrap ===== */
.card-wrap {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
}

.wp-cards-scroll {
  padding: 12px;
}
.bld-scroll {
  padding: 12px;
}
.hand-scroll {
  padding: 12px;
}

/* ===== Building card (bcard) ===== */
.bcard {
  position: relative;
  width: 76px;
  min-height: 80px;
  background: #fff;
  border: 1px solid #e2e8f0;
  border-radius: 7px;
  padding: 4px 5px 4px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 2px;
  cursor: default;
  user-select: none;
}
.bcard-cost {
  position: absolute;
  top: 4px;
  left: 5px;
  font-size: 16px;
  font-weight: 800;
  color: #3b82f6;
  line-height: 1;
}
.bcard-name {
  font-size: 14px;
  font-weight: 600;
  color: #374151;
  text-align: center;
  line-height: 1.2;
  margin-top: 16px;
  white-space: nowrap;
  overflow: hidden;
}
.bcard-asset {
  font-size: 17px;
  font-weight: 800;
  color: #059669;
  line-height: 1;
}

/* hand card (hcard) — same shape as bcard */
.hcard {
  position: relative;
  width: 76px;
  min-height: 80px;
  background: #fff;
  border: 1px solid #e2e8f0;
  border-radius: 7px;
  padding: 4px 5px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 2px;
  cursor: default;
  user-select: none;
}

/* ===== Workplace card ===== */
.wpcard {
  background: #fff;
  border: 1px solid #e2e8f0;
  border-radius: 7px;
  padding: 6px 10px;
  min-width: 76px;
  text-align: center;
  cursor: default;
}
.wpcard-name { font-weight: 700; font-size: 12px; color: #1e293b; }
.wpcard-workers { display: flex; flex-wrap: wrap; gap: 3px; margin-top: 3px; justify-content: center; }
.wp-wlabel {
  font-size: 10px; background: #e0e7ff; color: #4338ca;
  border-radius: 10px; padding: 1px 6px;
}
.wp-wlabel.faded { opacity: 0.4; }

/* ===== Used (worker placed, single-use) ===== */
/* !important を使わないため、available の !important に負けて青が優先される */
.bcard.used  { background: #f1f5f9; }
.wpcard.used { background: #f1f5f9; }

/* ===== Smaller cards in CPU columns ===== */
.cpu-col .bcard {
  width: 58px;
  min-height: 60px;
}
.cpu-col .bcard-cost  { font-size: 12px; }
.cpu-col .bcard-name  { font-size: 11px; margin-top: 12px; }
.cpu-col .bcard-asset { font-size: 13px; }

/* ===== Card animations ===== */
@keyframes cardActivate {
  0%   { box-shadow: 0 0 0 0 rgba(99,102,241,0.7); transform: scale(1); }
  25%  { box-shadow: 0 0 0 7px rgba(99,102,241,0.35); transform: scale(1.05); }
  100% { box-shadow: 0 0 0 0 rgba(99,102,241,0); transform: scale(1); }
}
@keyframes cardBuild {
  0%   { box-shadow: 0 0 0 0 rgba(5,150,105,0.8); transform: scale(0.93); background: #d1fae5; }
  30%  { box-shadow: 0 0 0 9px rgba(5,150,105,0.35); transform: scale(1.07); background: #a7f3d0; }
  100% { box-shadow: 0 0 0 0 rgba(5,150,105,0); transform: scale(1); background: #fff; }
}
.card-activated { animation: cardActivate 0.9s ease-out; }
.card-built     { animation: cardBuild 1.0s ease-out; }

/* ===== Available/selectable states ===== */
.available {
  border-color: #3b82f6 !important;
  background: #eff6ff !important;
  cursor: pointer !important;
}
.available:hover { background: #dbeafe !important; }
.selectable { cursor: pointer !important; }
.selectable:hover { border-color: #f59e0b !important; background: #fffbeb !important; }
.selected { border-color: #f59e0b !important; background: #fef3c7 !important; }

/* ===== Player area ===== */
.player-area {
  flex: 1;
  min-height: 0;
  background: #f0fdf4;
  border: 1px solid #86efac;
  border-radius: 10px;
  padding: 8px 12px;
}
.player-header {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  margin-bottom: 6px;
}
.player-name { font-weight: 700; color: #059669; font-size: 15px; }
.player-money { font-weight: 700; color: #0369a1; font-size: 15px; }
.player-content { display: flex; flex-direction: column; gap: 6px; }
.player-subsection {}

/* ===== Pending area ===== */
.pending-area {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 7px;
  padding: 4px 0;
}
.pending-title {
  font-weight: 700; color: #92400e; font-size: 12px; white-space: nowrap;
}
.hand-limit-title {
  color: #b91c1c;
  background: #fef2f2;
  border: 1px solid #fecaca;
  border-radius: 6px;
  padding: 3px 8px;
  white-space: normal;
}
.no-options { font-size: 11px; color: #ef4444; }
.btn-confirm {
  background: #3b82f6; color: #fff; border: none; border-radius: 6px;
  padding: 4px 12px; font-weight: 700; cursor: pointer; font-size: 12px;
}
.btn-cancel {
  background: #fff; color: #64748b; border: 1px solid #e2e8f0; border-radius: 6px;
  padding: 4px 10px; cursor: pointer; font-size: 12px;
}
.btn-cancel:hover { background: #f8fafc; }

/* ===== Tooltip (rendered via Teleport in <body>, styled globally) ===== */

/* ===== Log panel ===== */
.log-info {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding-bottom: 8px;
  border-bottom: 1px solid #e2e8f0;
  margin-bottom: 6px;
}
.log-panel {
  width: 180px;
  flex-shrink: 0;
  overflow-y: auto;
  overflow-x: hidden;
  background: #fff;
  border-left: 1px solid #e2e8f0;
  padding: 10px 8px;
}
.log-label {
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: #94a3b8;
  margin-bottom: 6px;
}
.log-line {
  font-size: 11px;
  color: #64748b;
  padding: 3px 0;
  border-bottom: 1px solid #f1f5f9;
  line-height: 1.4;
  word-break: break-all;
}

/* ===== Setup modal ===== */
.modal-overlay {
  position: fixed; inset: 0;
  background: rgba(0,0,0,0.35);
  display: flex; align-items: center; justify-content: center;
  z-index: 200;
}
.modal {
  background: #fff; border-radius: 12px; padding: 28px 32px;
  min-width: 260px; box-shadow: 0 8px 32px rgba(0,0,0,0.18);
  display: flex; flex-direction: column; gap: 14px;
}
.modal h2 { font-size: 18px; color: #1e293b; }
.check-item {
  display: flex; align-items: center; gap: 8px;
  font-size: 12px; color: #64748b; cursor: pointer; padding: 2px 0;
}
.check-item input[type="checkbox"] { accent-color: #3b82f6; width: 14px; height: 14px; cursor: pointer; }
.radio-group-label { font-size: 13px; color: #475569; font-weight: 600; margin-bottom: 6px; }
.radio-group { display: flex; flex-direction: column; gap: 6px; }
.radio-item {
  display: flex; align-items: center; gap: 8px;
  font-size: 13px; color: #374151; cursor: pointer;
  padding: 6px 10px; border: 1px solid #e2e8f0; border-radius: 7px;
  background: #f8fafc; transition: background 0.1s;
}
.radio-item:hover { background: #eff6ff; border-color: #bfdbfe; }
.radio-item input[type="radio"] { accent-color: #3b82f6; width: 15px; height: 15px; cursor: pointer; }
.radio-item:has(input:checked) { background: #eff6ff; border-color: #3b82f6; color: #1d4ed8; font-weight: 600; }
.modal-actions { display: flex; flex-direction: column; gap: 6px; margin-top: 4px; }
.btn-primary {
  background: #3b82f6; color: #fff; border: none; border-radius: 7px;
  padding: 9px 20px; font-weight: 700; cursor: pointer; font-size: 13px;
}
.btn-primary:hover { background: #2563eb; }
.btn-debug {
  background: #374151; color: #9ca3af; border: none; border-radius: 7px;
  padding: 7px 20px; cursor: pointer; font-size: 12px;
}
.btn-debug:hover { background: #1f2937; color: #d1d5db; }
.btn-secondary {
  background: #fff; color: #64748b; border: 1px solid #e2e8f0; border-radius: 7px;
  padding: 7px 14px; cursor: pointer; font-size: 13px; text-align: center;
}
.btn-secondary:hover { background: #f8fafc; }

/* ===== Game over ===== */
.gameover {
  min-height: 100vh; background: #f1f5f9;
  display: flex; align-items: center; justify-content: center; padding: 24px;
}
.gameover-card {
  background: #fff; border-radius: 12px; padding: 32px;
  max-width: 600px; width: 100%; box-shadow: 0 4px 24px rgba(0,0,0,0.1);
}
.gameover-card h1 { font-size: 22px; margin-bottom: 16px; }
.gameover-card table { width: 100%; border-collapse: collapse; margin-bottom: 16px; }
.gameover-card th, .gameover-card td { padding: 8px 12px; border: 1px solid #e2e8f0; text-align: center; font-size: 13px; }
.gameover-card th { background: #f8fafc; color: #64748b; font-weight: 600; }
.gameover-card tr.winner td { background: #eff6ff; font-weight: 700; }
.winner-msg { font-size: 16px; font-weight: 700; color: #1d4ed8; margin-bottom: 16px; }
.gameover-actions { display: flex; gap: 8px; }
</style>

<style>
/* ===== Mobile drawer ===== */
.drawer-overlay {
  display: none;
  position: fixed;
  inset: 0;
  background: rgba(0,0,0,0.35);
  z-index: 900;
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.25s ease;
}
.drawer-overlay.open { opacity: 1; pointer-events: auto; }
.drawer-panel {
  position: fixed;
  top: 0;
  right: 0;
  height: 100dvh;
  width: 260px;
  max-width: 85vw;
  background: #fff;
  box-shadow: -4px 0 24px rgba(0,0,0,0.15);
  z-index: 901;
  transform: translateX(100%);
  transition: transform 0.25s ease;
  overflow-y: auto;
  padding: 14px 14px 24px;
  flex-direction: column;
  gap: 0;
  box-sizing: border-box;
  /* display controlled by media query below */
  display: none;
}
.drawer-panel { pointer-events: none; }
.drawer-panel.open { transform: translateX(0); pointer-events: auto; }
.drawer-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
}
.drawer-title { font-size: 14px; font-weight: 700; color: #1e293b; }
.drawer-close {
  background: none;
  border: none;
  font-size: 16px;
  color: #94a3b8;
  cursor: pointer;
  padding: 4px 6px;
  line-height: 1;
}
.drawer-close:hover { color: #475569; }
.drawer-info {
  display: flex;
  flex-direction: column;
  gap: 5px;
  padding-bottom: 10px;
  border-bottom: 1px solid #e2e8f0;
  margin-bottom: 8px;
}
.drawer-info .hbadge { font-size: 12px; padding: 4px 10px; }
.drawer-info .btn-restart { font-size: 12px; padding: 5px 10px; margin-top: 2px; }
.drawer-log-label {
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: #94a3b8;
  margin-bottom: 6px;
}
.drawer-log-line {
  font-size: 11px;
  color: #64748b;
  padding: 3px 0;
  border-bottom: 1px solid #f1f5f9;
  line-height: 1.4;
  word-break: break-all;
}

@media (max-width: 640px) {
  .drawer-overlay,
  .drawer-panel { display: flex; }
  .drawer-panel { flex-direction: column; }

  html, body, #app {
    height: auto;
    min-height: 100%;
    overflow-y: auto;
  }
}

/* ===== Round animation ===== */
@keyframes roundPop {
  0%   { opacity: 0; transform: scale(0.7); }
  18%  { opacity: 1; transform: scale(1.04); }
  35%  { transform: scale(1); }
  78%  { opacity: 1; transform: scale(1); }
  100% { opacity: 0; transform: scale(1.06); }
}
.round-anim-overlay {
  position: fixed;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  pointer-events: none;
  z-index: 500;
}
.round-anim-card {
  background: rgba(15, 23, 42, 0.88);
  color: #f1f5f9;
  padding: 22px 56px;
  border-radius: 18px;
  font-size: 28px;
  font-weight: 800;
  letter-spacing: 0.05em;
  box-shadow: 0 8px 36px rgba(0, 0, 0, 0.35);
  animation: roundPop 1.2s ease-in-out forwards;
}
.round-fade-enter-active, .round-fade-leave-active { transition: opacity 0.15s; }
.round-fade-enter-from, .round-fade-leave-to { opacity: 0; }

/* ===== Global tooltip ===== */
.global-tooltip {
  position: fixed;
  transform: translate(-50%, -100%);
  background: #1e293b;
  color: #f1f5f9;
  padding: 5px 9px;
  border-radius: 6px;
  font-size: 11px;
  white-space: nowrap;
  z-index: 9999;
  pointer-events: none;
  box-shadow: 0 2px 8px rgba(0,0,0,0.2);
}
</style>
