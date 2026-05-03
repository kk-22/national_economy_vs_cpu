<script setup lang="ts">
import './App.css'
import { ref, onMounted, computed, watch } from 'vue'
import { useGame } from './composables/useGame'
import type { CpuStrategy } from './game/types'
import GameSetup from './components/GameSetup.vue'
import GameResult from './components/GameResult.vue'
import GameBoard from './components/GameBoard.vue'

const {
  game, humanPlayer, isHumanTurn, currentWage,
  pendingAction, scores,
  startGame, startDebugGame, runCpuTurns, cpuStepAction, autoAdvanceIfStuck,
  undo, canUndo, isUndoRedo,
} = useGame()

// ---- セットアップ状態 ----
const showSetup = ref(false)
const setupTotal = ref(4)       // 総プレイヤー数 (2-4)
const setupHasPlayer = ref(true) // 人間プレイヤーあり
const setupPlayerOrder = ref(1)
const setupCpuStrategies = ref<CpuStrategy[]>(['random', 'random', 'random', 'random'])
const menuOpen = ref(false)
const skipAnim = ref(false)
const lastStartedDebug = ref(false)

const setupCpu = computed(() => setupHasPlayer.value ? setupTotal.value - 1 : setupTotal.value)

const VALID_STRATEGIES: CpuStrategy[] = ['random', 'greedy', 'mcts', 'disruptive']

onMounted(() => {
  const total = Number(localStorage.getItem('ne-setup-total'))
  if ([2, 3, 4].includes(total)) setupTotal.value = total

  const hasPlayerStr = localStorage.getItem('ne-setup-has-player')
  if (hasPlayerStr !== null) setupHasPlayer.value = hasPlayerStr !== 'false'

  const order = Number(localStorage.getItem('ne-setup-order'))
  if (order >= 0 && order <= 4) setupPlayerOrder.value = order

  try {
    const raw = localStorage.getItem('ne-setup-strategies')
    if (raw) {
      const parsed = JSON.parse(raw)
      if (Array.isArray(parsed) && parsed.length === 4 && parsed.every((s: unknown) => VALID_STRATEGIES.includes(s as CpuStrategy)))
        setupCpuStrategies.value = parsed
    }
  } catch { /* ignore */ }

  skipAnim.value = localStorage.getItem('ne-setup-skip-anim') === 'true'
  lastStartedDebug.value = localStorage.getItem('ne-setup-debug') === 'true'

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
  localStorage.setItem('ne-setup-total', String(newVal))
  if (setupPlayerOrder.value > newVal) setupPlayerOrder.value = newVal
})
watch(setupHasPlayer, (newVal) => { localStorage.setItem('ne-setup-has-player', String(newVal)) })
watch(setupPlayerOrder, (newVal) => { localStorage.setItem('ne-setup-order', String(newVal)) })
watch(setupCpuStrategies, (newVal) => {
  localStorage.setItem('ne-setup-strategies', JSON.stringify(newVal))
}, { deep: true })
watch(skipAnim, (newVal) => { localStorage.setItem('ne-setup-skip-anim', String(newVal)) })

// ---- アニメーション管理 ----
const activatedIds = ref<string[]>([])
const builtIds = ref<string[]>([])
const roundAnimRound = ref<number | null>(null)

const ANIM_DURATION = 900
const ROUND_ANIM_DURATION = 1200

const isAnimating = ref(false)
let animEndTimer: ReturnType<typeof setTimeout> | null = null
let cpuRevision = 0  // undo/redo 時にインクリメントしてスケジュール済みの CPU タイムアウトを無効化

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

const canPlayerAct = computed(() =>
  isHumanTurn.value && !isAnimating.value && !pendingAction.value
)

watch(game, (newGame, oldGame) => {
  if (!newGame || !oldGame) return
  if (isUndoRedo.value) {
    isUndoRedo.value = false
    cpuRevision++
    return
  }

  const hasRoundChange = newGame.round === oldGame.round + 1

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

  if (hasRoundChange) {
    const roundDelay = skipAnim.value ? 0 : ANIM_DURATION + 50
    setTimeout(() => triggerRoundAnim(newGame.round), roundDelay)
    if (!skipAnim.value) setAnimating(ANIM_DURATION + 50 + ROUND_ANIM_DURATION + 100)
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
        setTimeout(() => { if (cpuRevision === rev) cpuStepAction() }, cpuDelay)
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
function onTipEnter(e: MouseEvent, text: string) {
  if (!text) return
  tooltipState.value = { text, x: e.clientX, y: e.clientY }
}
function onTipLeave() { tooltipState.value = null }

// ---- ゲーム操作 ----
function openSetup() { showSetup.value = true }

// cpuOnly ゲーム開始後、watch が old=null で early return するため手動で最初の CPU を起動する
function scheduleInitialCpuRun() {
  if (!game.value || game.value.phase !== 'placement') return
  if (skipAnim.value) {
    runCpuTurns()
  } else {
    const rev = cpuRevision
    setTimeout(() => { if (cpuRevision === rev) cpuStepAction() }, 100)
  }
}

function beginGame() {
  localStorage.setItem('ne-setup-debug', 'false')
  lastStartedDebug.value = false
  const cpuCount = setupCpu.value
  if (!setupHasPlayer.value) {
    startGame({ humanName: '', cpuCount, cpuOnly: true, cpuStrategies: setupCpuStrategies.value.slice(0, cpuCount) })
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
  localStorage.setItem('ne-setup-debug', 'true')
  lastStartedDebug.value = true
  startDebugGame(Math.min(setupCpu.value, 3))
  showSetup.value = false
}

function replayGame() {
  const cpuPlayers = game.value!.players.filter(p => p.isCpu)
  const cpuCount = cpuPlayers.length
  const cpuStrategies = cpuPlayers.map(p => p.cpuStrategy)
  const isAllCpu = !game.value!.players.some(p => !p.isCpu)
  if (isAllCpu) {
    startGame({ humanName: '', cpuCount, cpuOnly: true, cpuStrategies })
    scheduleInitialCpuRun()
  } else {
    startGame({ humanName: humanPlayer.value?.name ?? 'プレイヤー', cpuCount, cpuStrategies })
  }
}
</script>

<template>
  <GameSetup v-if="showSetup"
    v-model:setupTotal="setupTotal"
    v-model:setupHasPlayer="setupHasPlayer"
    v-model:setupPlayerOrder="setupPlayerOrder"
    v-model:setupCpuStrategies="setupCpuStrategies"
    v-model:skipAnim="skipAnim"
    :hasGame="!!game"
    @begin="beginGame"
    @beginDebug="beginDebugGame"
    @cancel="showSetup = false"
  />

  <GameResult v-else-if="game?.phase === 'game-over'"
    :game="game"
    :scores="scores!"
    :canUndo="canUndo"
    @replay="replayGame"
    @openSetup="openSetup"
    @undo="undo"
  />

  <GameBoard v-else-if="game"
    :activatedIds="activatedIds"
    :builtIds="builtIds"
    :canPlayerAct="canPlayerAct"
    :tipEnter="onTipEnter"
    :tipLeave="onTipLeave"
    @menuOpen="menuOpen = true"
    @openSetup="openSetup"
  />

  <Teleport to="body">
    <Transition name="round-fade">
      <div v-if="roundAnimRound" class="round-anim-overlay">
        <div class="round-anim-card">ラウンド {{ roundAnimRound }}</div>
      </div>
    </Transition>

    <div v-if="tooltipState" class="global-tooltip"
      :style="{ left: tooltipState.x + 'px', top: (tooltipState.y - 14) + 'px' }">
      {{ tooltipState.text }}
    </div>

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
