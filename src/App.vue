<script setup lang="ts">
import './App.css'
import { ref, onMounted, computed, watch, nextTick } from 'vue'
import { useGame } from './composables/useGame'
import { useLogHighlight } from './composables/useLogHighlight'
import type { CpuStrategy } from './game/types'
import GameSetup from './components/GameSetup.vue'
import GameResult from './components/GameResult.vue'
import GameBoard from './components/GameBoard.vue'

const {
  game, humanPlayer, isHumanTurn, currentWage,
  pendingAction, scores,
  startGame, startDebugGame, runCpuTurns, cpuStepAction, triggerRoundEnd, autoAdvanceIfStuck,
  saveGameState, hasSavedGame, restoreGame,
  undo, canUndo, isUndoRedo, cpuPaused, resumeCpu,
  replayError, clearReplayError,
} = useGame()

// ---- ドロワーログ ハイライト ----
const { getLogState: drawerLogState, onLogMouseenter: drawerLogEnter, onLogMouseleave: drawerLogLeave, onLogClick: drawerLogClick } = useLogHighlight(
  () => game.value?.players.map(p => p.name) ?? []
)
function drawerLineClass(msg: string): string {
  const s = drawerLogState(msg)
  if (s === 'highlight') return 'drawer-log-line drawer-log-line--highlight'
  if (s === 'dim') return 'drawer-log-line drawer-log-line--dim'
  return 'drawer-log-line'
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
const skipAnim = ref(false)
const lastStartedDebug = ref(false)
const settingsPaused = ref(false)
const cpuThinkingPlayerId = ref<number | null>(null)

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

  skipAnim.value = localStorage.getItem('ne-setup-skip-anim') === 'true'
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
  }
})

watch(setupTotal, (newVal) => {
  if (setupPlayerOrder.value > newVal) setupPlayerOrder.value = newVal
})
watch(setupPlayerOrder, (newVal) => { localStorage.setItem('ne-setup-order', String(newVal)) })
watch(skipAnim, (newVal) => { localStorage.setItem('ne-setup-skip-anim', String(newVal)) })

// ---- アニメーション管理 ----
const activatedIds = ref<string[]>([])
const builtIds = ref<string[]>([])
const drawnIds = ref<string[]>([])
const roundAnimRound = ref<number | null>(null)

const ANIM_DURATION = 900
const ROUND_ANIM_DURATION = 1200

const isAnimating = ref(false)
let animEndTimer: ReturnType<typeof setTimeout> | null = null
let cpuRevision = 0  // undo/redo 時にインクリメントしてスケジュール済みの CPU タイムアウトを無効化
let suppressHandAnim = false  // ゲーム開始直後の初期手札アニメーション抑制

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
function flashDrawn(id: string) {
  if (skipAnim.value || suppressHandAnim) return
  drawnIds.value = [...drawnIds.value, id]
  setAnimating(ANIM_DURATION + 50)
  setTimeout(() => { drawnIds.value = drawnIds.value.filter(x => x !== id) }, ANIM_DURATION)
}
function triggerRoundAnim(round: number) {
  if (skipAnim.value) return
  roundAnimRound.value = round
  setTimeout(() => { roundAnimRound.value = null }, ROUND_ANIM_DURATION)
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
        if (skipAnim.value) runCpuTurns()
        else {
          const rev = cpuRevision
          scheduleCpuStep(100, rev)
        }
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
    const roundDelay = skipAnim.value ? 0 : ANIM_DURATION + 50
    setTimeout(() => triggerRoundAnim(newGame.round), roundDelay)
    if (!skipAnim.value) setAnimating(ANIM_DURATION + 50 + ROUND_ANIM_DURATION + 100)
  }

  // CPUがラウンド最終手番のとき、アニメーション後にラウンド終了処理を行う
  if (newGame._pendingRoundEnd) {
    const rev = cpuRevision
    setTimeout(() => {
      if (cpuRevision !== rev) return
      triggerRoundEnd()
    }, ANIM_DURATION + 50)
    return
  }

  if (newGame.phase === 'placement') {
    const current = newGame.players[newGame.currentPlayerIndex]

    if (current?.isCpu) {
      if (skipAnim.value) {
        runCpuTurns()
      } else {
          const cpuDelay = hasRoundChange
          ? ANIM_DURATION + 50 + ROUND_ANIM_DURATION + 100
          : ANIM_DURATION + 50
        const rev = cpuRevision
        scheduleCpuStep(cpuDelay, rev)
      }
    } else {
      if (!newGame.pendingAction) {
        const avail = current?.workers.filter(w => !w.isTraining && w.placedAt === null) ?? []
        if (avail.length === 0) {
          const snapIndex = newGame.currentPlayerIndex
          const delay = hasRoundChange
            ? ANIM_DURATION + 50 + ROUND_ANIM_DURATION + 150
            : ANIM_DURATION + 100
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
  skipAnim: boolean
} | null = null

function openSetup() {
  setupSnapshot = {
    total: setupTotal.value,
    hasPlayer: setupHasPlayer.value,
    playerOrder: setupPlayerOrder.value,
    cpuStrategies: [...setupCpuStrategies.value],
    skipAnim: skipAnim.value,
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
    skipAnim.value = setupSnapshot.skipAnim
    setupSnapshot = null
  }
  showSetup.value = false
}

function scheduleCpuStep(delay: number, rev: number) {
  cpuThinkingPlayerId.value = game.value?.players[game.value.currentPlayerIndex]?.id ?? null
  setTimeout(() => {
    if (cpuRevision !== rev) { cpuThinkingPlayerId.value = null; return }
    cpuStepAction()
    cpuThinkingPlayerId.value = null
  }, delay)
}

// cpuOnly ゲーム開始後、watch が old=null で early return するため手動で最初の CPU を起動する
function scheduleInitialCpuRun() {
  if (!game.value || game.value.phase !== 'placement') return
  if (skipAnim.value) {
    runCpuTurns()
  } else {
    const rev = cpuRevision
    scheduleCpuStep(100, rev)
  }
}

function beginGame() {
  const cpuCount = setupCpu.value
  const strategies = setupCpuStrategies.value.slice(0, cpuCount)
  const hasBeam = strategies.includes('beam')
  if (skipAnim.value && !setupHasPlayer.value && hasBeam) {
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
  if (skipAnim.value) {
    runCpuTurns()
  } else {
    const rev = cpuRevision
    scheduleCpuStep(100, rev)
  }
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
      v-model:skipAnim="skipAnim"
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
            <button class="btn-restart" @click="showManual = true; menuOpen = false">説明書</button>
            <button class="btn-restart" @click="openSetup(); menuOpen = false">ゲーム設定</button>
            <button class="btn-restart" @click="showSummary = true; menuOpen = false">ラウンド毎の情報</button>
          </div>
          <div class="drawer-log-label">ログ</div>
        </div>
        <div class="drawer-log-scroll">
          <div
            v-for="(msg, i) in [...game.log].reverse()"
            :key="i"
            :class="drawerLineClass(msg)"
            @click="drawerLogClick(msg)"
            @mouseenter="drawerLogEnter(msg)"
            @mouseleave="drawerLogLeave"
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
    <div v-if="showManual" class="modal-overlay" @click.self="closeManual">
      <div class="modal manual-modal">
        <div class="modal-header">
          <h2>説明書</h2>
          <button class="modal-close-btn" @click="closeManual">✕</button>
        </div>
        <div class="manual-content">
          <p>
            本アプリは <a href="http://spa-game.com/?page_id=4242" target="_blank" rel="noopener">公式ガイドライン</a> に基づいて作成した、ナショナルエコノミーの非公式アプリです。<br>
            ゲームルールは <a href="http://spa-game.com/images/NE_Rules.pdf" target="_blank" rel="noopener">公式ルールブック (PDF)</a> を参照ください。
          </p>
          <h3>本アプリのコンセプト</h3>
          <p>最小限のクリック数でサクサク遊べるようにしています。</p>
          <ul>
            <li><strong>自動捨て札</strong>：露店使用時に手札枚数がピッタリなら、手札選択をスキップします。</li>
            <li><strong>自動建物選択</strong>：大工で建てられる建物が1つだけなら、手札選択をスキップします。</li>
            <li><strong>自動売却</strong>：ラウンド終了時の建物売却が1パターンしかない場合、自動で売却します。</li>
            <li><strong>自動保存</strong>：ゲーム状況をブラウザに自動保存しており、次回表示時に続きから表示されます。</li>
            <li><strong>戻る、進む</strong>：操作前まで戻ることができます。</li>
          </ul>
        </div>
      </div>
    </div>

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
