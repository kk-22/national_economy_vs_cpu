<script setup lang="ts">
import './App.css'
import { ref, onMounted, computed, watch, watchEffect, nextTick } from 'vue'
import { useGame } from './composables/useGame'
import { useLogHighlight } from './composables/useLogHighlight'
import type { CpuStrategy } from './game/types'
import GameSetup from './components/GameSetup.vue'
import GameResult from './components/GameResult.vue'
import GameBoard from './components/GameBoard.vue'
import ManualDialog from './components/ManualDialog.vue'

const {
  game, humanPlayer, isHumanTurn, currentWage,
  pendingAction, scores,
  startGame, startDebugGame, runCpuTurns, cpuStepAction, triggerRoundEnd, autoAdvanceIfStuck,
  saveGameState, hasSavedGame, restoreGame,
  undo, canUndo, isUndoRedo, cpuPaused, resumeCpu,
  replayError, clearReplayError,
} = useGame()

// ---- ドロワーログ ハイライト ----
const { getLogState: drawerLogState, onLogClick: drawerLogClick } = useLogHighlight(
  () => game.value?.players.map(p => p.name) ?? []
)
function drawerLineClass(msg: string): string {
  const s = drawerLogState(msg)
  if (s === 'highlight') return 'log-line log-line--highlight'
  if (s === 'dim') return 'log-line log-line--dim'
  return 'log-line'
}

// ---- セットアップ状態 ----
const showSetup = ref(false)
const setupTotal = ref(4)       // 総プレイヤー数 (2-4)
const setupHasPlayer = ref(true) // 人間プレイヤーあり
const setupPlayerOrder = ref(1)
const setupCpuStrategies = ref<CpuStrategy[]>(['random', 'random', 'random', 'random'])
const menuOpen = ref(false)
const showSummary = ref(false)
const showManual = ref(false)
const animSpeed = ref<'none' | 'short' | 'long'>('short')
const lastStartedDebug = ref(false)
const settingsPaused = ref(false)
const cpuThinkingPlayerId = ref<number | null>(null)

watchEffect(() => {
  const lock = (showManual.value || showSummary.value || !!replayError.value) ? 'hidden' : ''
  document.documentElement.style.overflow = lock
  document.body.style.overflow = lock
})

watchEffect(() => {
  const factor = animSpeed.value === 'long' ? 2 : 1
  const root = document.documentElement
  root.style.setProperty('--card-anim-dur', `${0.9 * factor}s`)
  root.style.setProperty('--card-build-dur', `${1.0 * factor}s`)
  root.style.setProperty('--round-anim-dur', `${1.2 * factor}s`)
})

const setupCpu = computed(() => setupHasPlayer.value ? setupTotal.value - 1 : setupTotal.value)

function syncSetupFromGame(g: typeof game.value) {
  if (!g) return
  setupTotal.value = g.players.length
  setupHasPlayer.value = g.players.some(p => !p.isCpu)
  const cpuStrategies = g.players.filter(p => p.isCpu).map(p => p.cpuStrategy)
  const next = [...setupCpuStrategies.value]
  cpuStrategies.forEach((s, i) => { next[i] = s })
  setupCpuStrategies.value = next
}

onMounted(() => {
  const order = Number(localStorage.getItem('ne-setup-order'))
  if (order >= 0 && order <= 4) setupPlayerOrder.value = order

  const savedSpeed = localStorage.getItem('ne-setup-anim-speed')
  if (savedSpeed === 'none' || savedSpeed === 'short' || savedSpeed === 'long') {
    animSpeed.value = savedSpeed
  } else if (localStorage.getItem('ne-setup-skip-anim') === 'true') {
    animSpeed.value = 'none'
  }
  lastStartedDebug.value = localStorage.getItem('ne-setup-debug') === 'true'

  if (!localStorage.getItem('ne-manual-seen')) {
    showManual.value = true
  }

  // セーブデータがあれば続きから再開（デバッグモードも含む）
  if (hasSavedGame()) {
    suppressHandAnim = true
    const restored = restoreGame()
    if (restored) {
      syncSetupFromGame(game.value)
      if (game.value?.phase === 'placement') scheduleInitialCpuRun()
      return
    }
  }

  if (lastStartedDebug.value) {
    startDebugGame(Math.min(setupCpu.value, 3))
  } else if (!setupHasPlayer.value) {
    startGame({ humanName: '', cpuCount: setupCpu.value, cpuOnly: true, cpuStrategies: setupCpuStrategies.value.slice(0, setupCpu.value) })
    scheduleInitialCpuRun()
  } else {
    startGame({
      humanName: 'プレイヤー',
      cpuCount: setupCpu.value,
      playerOrder: setupPlayerOrder.value,
      cpuStrategies: setupCpuStrategies.value.slice(0, setupCpu.value),
    })
    // watch が oldGame=null で早期 return するため、初回起動時は手動でCPUを起動する
    scheduleInitialCpuRun()
  }
})

watch(setupTotal, (newVal) => {
  if (setupPlayerOrder.value > newVal) setupPlayerOrder.value = newVal
})
watch(setupPlayerOrder, (newVal) => { localStorage.setItem('ne-setup-order', String(newVal)) })
watch(animSpeed, (newVal) => { localStorage.setItem('ne-setup-anim-speed', newVal) })

// ---- アニメーション管理 ----
const activatedIds = ref<string[]>([])
const builtIds = ref<string[]>([])
const drawnIds = ref<string[]>([])
const roundAnimRound = ref<number | null>(null)

const ANIM_DURATION = computed(() => animSpeed.value === 'long' ? 1800 : 900)
const ROUND_ANIM_DURATION = computed(() => animSpeed.value === 'long' ? 2400 : 1200)

const isAnimating = ref(false)
let animEndTimer: ReturnType<typeof setTimeout> | null = null
let cpuRevision = 0  // undo/redo 時にインクリメントしてスケジュール済みの CPU タイムアウトを無効化
let suppressHandAnim = false  // ゲーム開始直後の初期手札アニメーション抑制

function setAnimating(totalMs: number) {
  if (animSpeed.value === 'none') return
  isAnimating.value = true
  if (animEndTimer !== null) clearTimeout(animEndTimer)
  animEndTimer = setTimeout(() => { isAnimating.value = false }, totalMs)
}

function flashActivated(id: string) {
  if (animSpeed.value === 'none') return
  activatedIds.value = [...activatedIds.value, id]
  setAnimating(ANIM_DURATION.value + 50)
  setTimeout(() => { activatedIds.value = activatedIds.value.filter(x => x !== id) }, ANIM_DURATION.value)
}
function flashBuilt(id: string) {
  if (animSpeed.value === 'none') return
  builtIds.value = [...builtIds.value, id]
  setAnimating(ANIM_DURATION.value + 100 + 50)
  setTimeout(() => { builtIds.value = builtIds.value.filter(x => x !== id) }, ANIM_DURATION.value + 100)
}
function flashDrawn(id: string) {
  if (animSpeed.value === 'none' || suppressHandAnim) return
  drawnIds.value = [...drawnIds.value, id]
  setAnimating(ANIM_DURATION.value + 50)
  setTimeout(() => { drawnIds.value = drawnIds.value.filter(x => x !== id) }, ANIM_DURATION.value)
}
function triggerRoundAnim(round: number) {
  if (animSpeed.value === 'none') return
  roundAnimRound.value = round
  setTimeout(() => { roundAnimRound.value = null }, ROUND_ANIM_DURATION.value)
}

const canPlayerAct = computed(() =>
  isHumanTurn.value && !isAnimating.value && !pendingAction.value
)

watch(game, () => { tooltipState.value = null })

watch(game, (newGame, oldGame) => {
  if (!newGame || !oldGame) return
  saveGameState()

  if (isUndoRedo.value) {
    isUndoRedo.value = false
    cpuRevision++
    if (!cpuPaused.value && newGame.phase === 'placement') {
      const current = newGame.players[newGame.currentPlayerIndex]
      if (current?.isCpu) {
        scheduleCpuStep(cpuRevision)
      }
    }
    return
  }

  const hasRoundChange = newGame.round === oldGame.round + 1

  for (const newWp of newGame.publicWorkplaces) {
    const oldWp = oldGame.publicWorkplaces.find(w => w.id === newWp.id)
    if (!oldWp) flashBuilt(newWp.id)
    else if (newWp.workerIds.length > oldWp.workerIds.length) flashActivated(newWp.id)
  }
  for (const newP of newGame.players) {
    const oldP = oldGame.players.find(p => p.id === newP.id)
    if (!oldP) continue
    for (const newB of newP.ownedBuildings) {
      const oldB = oldP.ownedBuildings.find(b => b.id === newB.id)
      if (!oldB) flashBuilt(newB.id)
      else if (newB.workerHereId !== null && oldB.workerHereId === null) flashActivated(newB.id)
    }
    if (!suppressHandAnim) {
      const oldHandIds = new Set(oldP.hand.map(c => c.id))
      for (const card of newP.hand) {
        if (!oldHandIds.has(card.id)) flashDrawn(card.id)
      }
    }
  }
  suppressHandAnim = false

  if (hasRoundChange) {
    const roundDelay = animSpeed.value === 'none' ? 0 : ANIM_DURATION.value + 50
    setTimeout(() => triggerRoundAnim(newGame.round), roundDelay)
    if (animSpeed.value !== 'none') setAnimating(ANIM_DURATION.value + 50 + ROUND_ANIM_DURATION.value + 100)
  }

  // CPUがラウンド最終手番のとき、アニメーション後にラウンド終了処理を行う
  if (newGame._pendingRoundEnd) {
    const rev = cpuRevision
    setTimeout(() => {
      if (cpuRevision !== rev) return
      triggerRoundEnd()
    }, ANIM_DURATION.value + 50)
    return
  }

  if (newGame.phase === 'placement') {
    const current = newGame.players[newGame.currentPlayerIndex]

    if (current?.isCpu) {
      scheduleCpuStep(cpuRevision)
    } else {
      if (!newGame.pendingAction) {
        const avail = current?.workers.filter(w => !w.isTraining && w.placedAt === null) ?? []
        if (avail.length === 0) {
          const snapIndex = newGame.currentPlayerIndex
          const delay = hasRoundChange
            ? ANIM_DURATION.value + 50 + ROUND_ANIM_DURATION.value + 150
            : ANIM_DURATION.value + 100
          const rev = cpuRevision
          setTimeout(() => {
            if (cpuRevision !== rev) return
            if (game.value?.currentPlayerIndex === snapIndex && game.value.phase === 'placement') {
              autoAdvanceIfStuck()
            }
          }, delay)
        }
      }
    }
  }
})

// ---- ツールチップ ----
const tooltipState = ref<{ text: string; x: number; y: number } | null>(null)
const tooltipEl = ref<HTMLElement | null>(null)
const tooltipStyle = ref({ left: '0px', top: '0px' })

watch(tooltipState, async (state) => {
  if (!state) return
  await nextTick()
  if (!tooltipEl.value) return
  const rect = tooltipEl.value.getBoundingClientRect()
  const MARGIN = 8
  let left = state.x - rect.width / 2
  let top = state.y - rect.height - 14
  left = Math.max(MARGIN, Math.min(left, window.innerWidth - rect.width - MARGIN))
  top = Math.max(MARGIN, Math.min(top, window.innerHeight - rect.height - MARGIN))
  tooltipStyle.value = { left: `${left}px`, top: `${top}px` }
})

function onTipEnter(e: MouseEvent, text: string) {
  if (!text) return
  tooltipState.value = { text, x: e.clientX, y: e.clientY }
}
function onTipLeave() { tooltipState.value = null }

// ---- ゲーム操作 ----
let setupSnapshot: {
  total: number
  hasPlayer: boolean
  playerOrder: number
  cpuStrategies: CpuStrategy[]
} | null = null

function openSetup() {
  setupSnapshot = {
    total: setupTotal.value,
    hasPlayer: setupHasPlayer.value,
    playerOrder: setupPlayerOrder.value,
    cpuStrategies: [...setupCpuStrategies.value],
  }
  // CPU専用ゲームではゲーム設定を開いた瞬間にCPUを一時停止
  if (game.value && !game.value.players.some(p => !p.isCpu)) {
    settingsPaused.value = true
    cpuRevision++
  }
  showSetup.value = true
}

function cancelSetup() {
  if (setupSnapshot) {
    setupTotal.value = setupSnapshot.total
    setupHasPlayer.value = setupSnapshot.hasPlayer
    setupPlayerOrder.value = setupSnapshot.playerOrder
    setupCpuStrategies.value = [...setupSnapshot.cpuStrategies]
    setupSnapshot = null
  }
  showSetup.value = false
}

function scheduleCpuStep(rev: number) {
  // アニメーション完了まで即時ポーリング（isAnimating=false なら即発火）
  waitForAnimThen(rev, () => {
    if (cpuRevision !== rev) return
    cpuThinkingPlayerId.value = game.value?.players[game.value.currentPlayerIndex]?.id ?? null
    // double-rAF で1フレーム描画を保証してからCPU実行
    // rAFで1フレーム描画（インジケータを表示）してから、rAFの外でCPUを実行する。
    // rAF内でCPUを長時間ブロックするとフレームのtimeline.currentTimeが凍結され、
    // 直後のCSSアニメーションのstart-timeがズレて表示されなくなるため。
    nextTick(() => requestAnimationFrame(() => {
      setTimeout(() => {
        if (cpuRevision !== rev) { cpuThinkingPlayerId.value = null; return }
        if (animSpeed.value === 'none') runCpuTurns()
        else cpuStepAction()
        cpuThinkingPlayerId.value = null
      }, 0)
    }))
  })
}

function waitForAnimThen(rev: number, fn: () => void) {
  if (!isAnimating.value || cpuRevision !== rev) { fn(); return }
  setTimeout(() => waitForAnimThen(rev, fn), 30)
}

// cpuOnly ゲーム開始後、watch が old=null で early return するため手動で最初の CPU を起動する
function scheduleInitialCpuRun() {
  if (!game.value || game.value.phase !== 'placement') return
  scheduleCpuStep(cpuRevision)
}

function beginGame() {
  const cpuCount = setupCpu.value
  const strategies = setupCpuStrategies.value.slice(0, cpuCount)
  const hasBeam = strategies.includes('beam')
  if (animSpeed.value === 'none' && !setupHasPlayer.value && hasBeam) {
    const ok = window.confirm(
      'ビームサーチCPUを含む全CPU対戦をスキップモードで実行します。\n計算のため数十秒フリーズしますがよろしいですか？'
    )
    if (!ok) return
  }

  settingsPaused.value = false
  localStorage.setItem('ne-setup-debug', 'false')
  lastStartedDebug.value = false
  suppressHandAnim = true
  if (!setupHasPlayer.value) {
    startGame({ humanName: '', cpuCount, cpuOnly: true, cpuStrategies: strategies })
    scheduleInitialCpuRun()
  } else {
    startGame({
      humanName: 'プレイヤー',
      cpuCount,
      playerOrder: setupPlayerOrder.value,
      cpuStrategies: setupCpuStrategies.value.slice(0, cpuCount),
    })
  }
  showSetup.value = false
}

function beginDebugGame() {
  settingsPaused.value = false
  localStorage.setItem('ne-setup-debug', 'true')
  lastStartedDebug.value = true
  suppressHandAnim = true
  startDebugGame(Math.min(setupCpu.value, 3))
  showSetup.value = false
}

function resumeAfterUndo() {
  settingsPaused.value = false
  resumeCpu()
  if (!game.value || game.value.phase !== 'placement') return
  const current = game.value.players[game.value.currentPlayerIndex]
  if (!current?.isCpu) return
  cpuRevision++
  scheduleCpuStep(cpuRevision)
}

function closeManual() {
  showManual.value = false
  localStorage.setItem('ne-manual-seen', 'true')
}

function replayGame() {
  const cpuPlayers = game.value!.players.filter(p => p.isCpu)
  const cpuCount = cpuPlayers.length
  const cpuStrategies = cpuPlayers.map(p => p.cpuStrategy)
  const isAllCpu = !game.value!.players.some(p => !p.isCpu)
  suppressHandAnim = true
  if (isAllCpu) {
    startGame({ humanName: '', cpuCount, cpuOnly: true, cpuStrategies })
    scheduleInitialCpuRun()
  } else {
    startGame({ humanName: humanPlayer.value?.name ?? 'プレイヤー', cpuCount, playerOrder: setupPlayerOrder.value, cpuStrategies })
  }
}
</script>

<template>
  <template v-if="game">
    <GameBoard
      :activatedIds="activatedIds"
      :builtIds="builtIds"
      :drawnIds="drawnIds"
      :canPlayerAct="canPlayerAct"
      :settingsPaused="settingsPaused"
      :cpuThinkingPlayerId="cpuThinkingPlayerId"
      :tipEnter="onTipEnter"
      :tipLeave="onTipLeave"
      @menuOpen="menuOpen = true"
      @openSetup="openSetup"
      @openSummary="showSummary = true"
      @openManual="showManual = true"
      @resume="resumeAfterUndo"
    />
    <GameResult v-if="game.phase === 'game-over'"
      :game="game"
      :scores="scores!"
      :canUndo="canUndo"
      @replay="replayGame"
      @openSetup="openSetup"
      @undo="undo"
    />
  </template>

  <Teleport to="body">
    <GameSetup v-if="showSetup"
      v-model:setupTotal="setupTotal"
      v-model:setupHasPlayer="setupHasPlayer"
      v-model:setupPlayerOrder="setupPlayerOrder"
      v-model:setupCpuStrategies="setupCpuStrategies"
      v-model:animSpeed="animSpeed"
      :hasGame="!!game"
      @begin="beginGame"
      @beginDebug="beginDebugGame"
      @cancel="cancelSetup"
    />

    <Transition name="round-fade">
      <div v-if="roundAnimRound" class="round-anim-overlay">
        <div class="round-anim-card">ラウンド {{ roundAnimRound }}</div>
      </div>
    </Transition>

    <div v-if="tooltipState" ref="tooltipEl" class="global-tooltip" :style="tooltipStyle">
      {{ tooltipState.text }}
    </div>

    <template v-if="game">
      <div class="drawer-overlay" :class="{ open: menuOpen }" @click="menuOpen = false"></div>
      <div class="drawer-panel" :class="{ open: menuOpen }">
        <div class="drawer-fixed">
          <div class="drawer-top">
            <span class="drawer-title">メニュー</span>
            <button class="drawer-close" @click="menuOpen = false">✕</button>
          </div>
          <div class="drawer-info">
            <span class="hbadge">ラウンド {{ game.round }}/9</span>
            <span class="hbadge">賃金 ${{ currentWage }}</span>
            <span class="hbadge">家計 ${{ game.household }}</span>
            <span class="hbadge">山札 {{ game.buildingDeck.length }}枚</span>
            <button class="btn-restart" @click="showManual = true; menuOpen = false">📖 説明書</button>
            <button class="btn-restart" @click="openSetup(); menuOpen = false">⚙️ ゲーム設定</button>
            <button class="btn-restart" @click="showSummary = true; menuOpen = false">📋 ラウンド毎の情報</button>
          </div>
          <div class="drawer-log-label">ログ</div>
        </div>
        <div class="drawer-log-scroll">
          <div
            v-for="(msg, i) in [...game.log].reverse()"
            :key="i"
            :class="drawerLineClass(msg)"
            @click="drawerLogClick(msg)"
          >{{ msg }}</div>
        </div>
      </div>
    </template>

    <div v-if="showSummary" class="modal-overlay" @click.self="showSummary = false">
      <div class="modal summary-modal">
        <div class="modal-header">
          <h2>ラウンド毎の情報</h2>
          <button class="modal-close-btn" @click="showSummary = false">✕</button>
        </div>
        <table class="summary-table">
          <thead>
            <tr><th>ラウンド</th><th>賃金</th><th>建物</th><th>機能</th></tr>
          </thead>
          <tbody>
            <tr :class="{ 'summary-row--current': game?.round === 1 }"><td>1</td><td>$2</td><td>-</td><td>-</td></tr>
            <tr :class="{ 'summary-row--current': game?.round === 2 }"><td>2</td><td>$2</td><td>露店</td><td>1枚捨てて家計から$6獲得</td></tr>
            <tr :class="{ 'summary-row--current': game?.round === 3 }"><td>3</td><td>$3</td><td>市場</td><td>2枚捨てて家計から$12獲得</td></tr>
            <tr :class="{ 'summary-row--current': game?.round === 4 }"><td>4</td><td>$3</td><td>高等学校</td><td>労働者を4人に増やす</td></tr>
            <tr :class="{ 'summary-row--current': game?.round === 5 }"><td>5</td><td>$3</td><td>スーパーマーケット</td><td>3枚捨てて家計から$18獲得</td></tr>
            <tr :class="{ 'summary-row--current': game?.round === 6 }"><td>6</td><td>$4</td><td>大学</td><td>労働者を5人に増やす</td></tr>
            <tr :class="{ 'summary-row--current': game?.round === 7 }"><td>7</td><td>$4</td><td>百貨店</td><td>4枚捨てて家計から$24獲得</td></tr>
            <tr :class="{ 'summary-row--current': game?.round === 8 }"><td>8</td><td>$5</td><td>専門学校</td><td>すぐ使える労働者を1人追加</td></tr>
            <tr :class="{ 'summary-row--current': game?.round === 9 }"><td>9</td><td>$5</td><td>万博</td><td>5枚捨てて家計から$30獲得</td></tr>
          </tbody>
        </table>
      </div>
    </div>
    <ManualDialog v-if="showManual" @close="closeManual" />

    <div v-if="replayError" class="modal-overlay">
      <div class="modal replay-error-modal">
        <div class="modal-header">
          <h2>リプレイエラー</h2>
        </div>
        <p class="replay-error-msg">{{ replayError }}</p>
        <div class="replay-error-actions">
          <button class="btn-restart" @click="clearReplayError(); openSetup()">ゲーム設定</button>
        </div>
      </div>
    </div>
  </Teleport>
</template>
