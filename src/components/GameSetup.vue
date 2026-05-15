<script setup lang="ts">
import { computed } from 'vue'
import type { CpuStrategy } from '../game/types'

const props = defineProps<{
  setupTotal: number
  setupHasPlayer: boolean
  setupPlayerOrder: number
  setupCpuStrategies: CpuStrategy[]
  animSpeed: 'none' | 'short' | 'long'
  hasGame: boolean
}>()

const emit = defineEmits<{
  'update:setupTotal': [v: number]
  'update:setupHasPlayer': [v: boolean]
  'update:setupPlayerOrder': [v: number]
  'update:setupCpuStrategies': [v: CpuStrategy[]]
  'update:animSpeed': [v: 'none' | 'short' | 'long']
  begin: []
  beginDebug: []
  cancel: []
}>()

const cpuCount = computed(() => props.setupHasPlayer ? props.setupTotal - 1 : props.setupTotal)

// -1 = プレイヤーなし, 0 = ランダム, n = n番手
const playerMode = computed({
  get(): number {
    if (!props.setupHasPlayer) return -1
    return props.setupPlayerOrder
  },
  set(val: number) {
    if (val === -1) {
      emit('update:setupHasPlayer', false)
    } else {
      emit('update:setupHasPlayer', true)
      emit('update:setupPlayerOrder', val)
    }
  },
})

const bulkStrategy = computed({
  get(): CpuStrategy | '' {
    const strategies = props.setupCpuStrategies.slice(0, cpuCount.value)
    const first = strategies[0]
    return strategies.every(s => s === first) ? first : ''
  },
  set(val: CpuStrategy | '') {
    if (!val) return
    emit('update:setupCpuStrategies', props.setupCpuStrategies.map(() => val as CpuStrategy))
  },
})

function updateStrategy(idx: number, val: CpuStrategy) {
  const copy = [...props.setupCpuStrategies]
  copy[idx] = val
  emit('update:setupCpuStrategies', copy)
}

const DIFFICULTY_OPTIONS: { label: string; strategy: CpuStrategy }[] = [
  { label: '初級', strategy: 'disruptive' },
  { label: '中級', strategy: 'greedy' },
  { label: '上級', strategy: 'beam' },
]
</script>

<template>
  <div class="modal-overlay" @click.self="hasGame && emit('cancel')">
    <div class="modal">
      <div class="modal-header">
        <h2>ゲーム設定</h2>
        <button v-if="hasGame" class="modal-close-btn" @click="emit('cancel')">✕</button>
      </div>

      <!-- 表示設定 -->
      <div class="setup-section-title">表示設定</div>

      <div class="radio-group-label">アニメーション</div>
      <div class="radio-group radio-group--horizontal">
        <label class="radio-item">
          <input type="radio" :checked="animSpeed === 'none'" @change="emit('update:animSpeed', 'none')" />
          <span>なし</span>
        </label>
        <label class="radio-item">
          <input type="radio" :checked="animSpeed === 'short'" @change="emit('update:animSpeed', 'short')" />
          <span>短い</span>
        </label>
        <label class="radio-item">
          <input type="radio" :checked="animSpeed === 'long'" @change="emit('update:animSpeed', 'long')" />
          <span>長い</span>
        </label>
      </div>

      <hr class="setup-divider" />

      <!-- ゲーム開始設定 -->
      <div class="setup-section-title">ゲーム開始設定</div>

      <div class="radio-group-label">人数</div>
      <div class="radio-group radio-group--horizontal">
        <label v-for="n in [2, 3, 4]" :key="n" class="radio-item">
          <input type="radio" :checked="setupTotal === n" @change="emit('update:setupTotal', n)" />
          <span>{{ n }}人</span>
        </label>
      </div>

      <div class="radio-group-label">プレイヤー</div>
      <div class="radio-group radio-group--horizontal">
        <label class="radio-item">
          <input type="radio" :checked="playerMode === -1" @change="playerMode = -1" />
          <span>なし</span>
        </label>
        <label class="radio-item">
          <input type="radio" :checked="playerMode === 0" @change="playerMode = 0" />
          <span>手番ランダム</span>
        </label>
        <label v-for="n in setupTotal" :key="n" class="radio-item">
          <input type="radio" :checked="playerMode === n" @change="playerMode = n" />
          <span>手番{{ n }}番</span>
        </label>
      </div>

      <div class="radio-group-label">CPUの難易度</div>
      <div v-if="cpuCount > 1" class="cpu-strategy-row">
        <span class="cpu-strategy-label">一括：</span>
        <div class="radio-group radio-group--horizontal">
          <label v-for="opt in DIFFICULTY_OPTIONS" :key="opt.strategy" class="radio-item">
            <input type="radio" :checked="bulkStrategy === opt.strategy" @change="bulkStrategy = opt.strategy" />
            <span>{{ opt.label }}</span>
          </label>
        </div>
      </div>
      <div v-for="i in cpuCount" :key="i" class="cpu-strategy-row">
        <span class="cpu-strategy-label">CPU {{ i }}：</span>
        <div class="radio-group radio-group--horizontal">
          <label v-for="opt in DIFFICULTY_OPTIONS" :key="opt.strategy" class="radio-item">
            <input type="radio" :checked="setupCpuStrategies[i - 1] === opt.strategy" @change="updateStrategy(i - 1, opt.strategy)" />
            <span>{{ opt.label }}</span>
          </label>
        </div>
      </div>

      <div class="modal-actions">
        <button class="btn-primary" @click="emit('begin')">新しく始める</button>
        <button class="btn-debug-text" @click="emit('beginDebug')">テストモードで始める</button>
      </div>

    </div>
  </div>
</template>
