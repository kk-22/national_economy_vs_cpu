<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import { useGame } from './composables/useGame'
import type { GameEffect, Worker } from './game/types'

const {
  game, humanPlayer, isHumanTurn, currentWage,
  availablePublicWorkplaces, availableOwnedBuildings,
  pendingAction, paymentSelected, buildableCards, scores, getBuildingDef,
  startGame, startDebugGame, clickPublicWorkplace, clickOwnedBuilding,
  clickBuildTarget, clickPaymentCard, clickCancelBuildChoice, clickCancelBuildPayment,
  clickCancelDoubleSecond, clickCancelDoublePayment,
  clickDiscardCard, confirmDiscardAction, clickCancelDiscardChoice,
  clickRevealedCard,
} = useGame()

const showSetup = ref(false)
const setupCpu = ref(3)   // 1〜3: 通常, 4: CPU4体（プレイヤーなし）
const menuOpen = ref(false)

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
function buildingWorkerName(workerHereId: string | null): string | null {
  if (!workerHereId || !game.value) return null
  const p = game.value.players.find(pl => pl.workers.some(w => w.id === workerHereId))
  return p?.name ?? null
}
function workerStatus(workers: Worker[]): string {
  const available = workers.filter(w => !w.isTraining && !w.placedAt).length
  return `${available}/${workers.length}`
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

      <!-- Left: sections + fixed-bottom player -->
      <div class="game-main">

        <!-- CPU section -->
        <section class="section cpu-section">
          <div class="cpu-grid" :style="{ gridTemplateColumns: `repeat(${cpuPlayers.length}, 1fr)` }">
            <div v-for="cpu in cpuPlayers" :key="cpu.id" class="cpu-col">
              <div class="cpu-header">
                <span class="cpu-name">{{ cpu.name }}</span>
                <span class="cpu-money">${{ cpu.money }}</span>
                <span v-if="cpu.unpaidWages > 0" class="unpaid-badge">未払い{{ cpu.unpaidWages }}</span>
                <span class="worker-badge">{{ workerStatus(cpu.workers) }}</span>
                <span class="hand-count">手札{{ cpu.hand.length }}</span>
              </div>
              <div class="cpu-cards-scroll">
                <div class="card-wrap">
                  <div v-for="b in cpu.ownedBuildings" :key="b.id"
                    class="bcard"
                    @mouseenter="onTipEnter($event, cardTooltip(b.name))"
                    @mouseleave="onTipLeave">
                    <span class="bcard-cost">{{ getBuildingDef(b.name)?.cost }}</span>
                    <span class="bcard-name">{{ b.name }}</span>
                    <span class="bcard-asset">{{ getBuildingDef(b.name)?.assetValue }}</span>
                    <span v-if="buildingWorkerName(b.workerHereId)" class="bcard-worker-dot"></span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        <!-- Public workplaces section -->
        <section class="section workplaces-section">
          <div class="section-label">公共施設</div>
          <div class="wp-cards-scroll">
            <div class="card-wrap">
              <div
                v-for="wp in game.publicWorkplaces" :key="wp.id"
                :class="['wpcard', { available: !pendingAction && isHumanTurn && availablePublicWorkplaces.some(w => w.id === wp.id) }]"
                @mouseenter="onTipEnter($event, effectDesc(wp.effect))"
                @mouseleave="onTipLeave"
                @click="!pendingAction && isHumanTurn && availablePublicWorkplaces.some(w => w.id === wp.id) && clickPublicWorkplace(wp.id)"
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

        <!-- Player area: fixed at bottom (hidden in CPU-only mode) -->
        <div v-if="humanPlayer" class="player-area">

          <!-- Player header -->
          <div class="player-header">
            <span class="player-name">{{ humanPlayer?.name }}</span>
            <span class="player-money">${{ humanPlayer?.money }}</span>
            <span v-if="humanPlayer?.unpaidWages" class="unpaid-badge">未払い{{ humanPlayer.unpaidWages }}</span>
            <span class="worker-badge">{{ humanPlayer ? workerStatus(humanPlayer.workers) : '' }}</span>
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
                  <span class="bcard-name">{{ card.name }}</span>
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
                  <span class="bcard-name">{{ (card as any).name }}</span>
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
                  <span class="bcard-name">{{ cardLabel(card) }}</span>
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
                  <span class="bcard-name">{{ cardLabel(card) }}</span>
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
                  <span class="bcard-name">{{ cardLabel(card) }}</span>
                </button>
              </div>
            </template>
          </div>

          <!-- Normal view (no pending) -->
          <div v-else class="player-content">
            <div v-if="humanPlayer?.ownedBuildings.length" class="player-subsection">
              <div class="subsection-label">建設済み {{ humanPlayer.ownedBuildings.length }}棟</div>
              <div class="bld-scroll">
                <div class="card-wrap">
                  <div v-for="b in humanPlayer.ownedBuildings" :key="b.id"
                    :class="['bcard', { available: !pendingAction && isHumanTurn && availableOwnedBuildings.some(x => x.id === b.id) }]"
                    @mouseenter="onTipEnter($event, cardTooltip(b.name))"
                    @mouseleave="onTipLeave"
                    @click="!pendingAction && isHumanTurn && availableOwnedBuildings.some(x => x.id === b.id) && clickOwnedBuilding(b.id)">
                    <span class="bcard-cost">{{ getBuildingDef(b.name)?.cost }}</span>
                    <span class="bcard-name">{{ b.name }}</span>
                    <span class="bcard-asset">{{ getBuildingDef(b.name)?.assetValue }}</span>
                    <span v-if="buildingWorkerName(b.workerHereId)" class="bcard-worker-dot"></span>
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
                    <span class="bcard-name">{{ cardLabel(card) }}</span>
                    <span v-if="card.kind === 'building'" class="bcard-asset">{{ getBuildingDef(card.name!)?.assetValue }}</span>
                  </div>
                </div>
              </div>
            </div>
          </div>

        </div><!-- /player-area -->
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
}

/* ===== Left side ===== */
.game-main {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  min-width: 0;
  min-height: 0;
  padding: 8px 10px 0;
  gap: 8px;
}

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

.cpu-section { background: #f8f9ff; border-color: #c7d2fe; flex-shrink: 0; }
.workplaces-section { background: #fffbeb; border-color: #fde68a; flex: 1; min-height: 0; display: flex; flex-direction: column; }

.cpu-grid { display: grid; gap: 8px; }
.cpu-col {
  background: #fff;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  padding: 8px 10px;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.cpu-cards-scroll {
  overflow-y: auto;
  overflow-x: hidden;
  max-height: 200px;
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
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  overflow-x: hidden;
}
.bld-scroll {
  overflow-y: auto;
  overflow-x: hidden;
  max-height: 175px;
}
.hand-scroll {
  overflow-y: auto;
  overflow-x: hidden;
  max-height: 135px;
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
  word-break: break-all;
}
.bcard-asset {
  font-size: 17px;
  font-weight: 800;
  color: #059669;
  line-height: 1;
}
.bcard-worker-dot {
  position: absolute;
  top: 4px;
  right: 5px;
  width: 7px;
  height: 7px;
  background: #f59e0b;
  border-radius: 50%;
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

/* ===== Player area (fixed at bottom of game-main) ===== */
.player-area {
  flex-shrink: 0;
  overflow: hidden;
  background: #f0fdf4;
  border-top: 2px solid #86efac;
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
}

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
