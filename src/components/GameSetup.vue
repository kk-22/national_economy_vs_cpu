<script setup lang="ts">
import { computed } from 'vue'
import type { CpuStrategy } from '../game/types'

const props = defineProps<{
  setupTotal: number
  setupHasPlayer: boolean
  setupPlayerOrder: number
  setupCpuStrategies: CpuStrategy[]
  skipAnim: boolean
  hasGame: boolean
}>()

const emit = defineEmits<{
  'update:setupTotal': [v: number]
  'update:setupHasPlayer': [v: boolean]
  'update:setupPlayerOrder': [v: number]
  'update:setupCpuStrategies': [v: CpuStrategy[]]
  'update:skipAnim': [v: boolean]
  begin: []
  beginDebug: []
  cancel: []
}>()

const cpuCount = computed(() => props.setupHasPlayer ? props.setupTotal - 1 : props.setupTotal)

const bulkStrategy = computed({
  get(): CpuStrategy | '' {
    const strategies = props.setupCpuStrategies.slice(0, cpuCount.value)
    const first = strategies[0]
    return strategies.every(s => s === first) ? first : ''
  },
  set(val: CpuStrategy | '') {
    if (!val) return
    const copy = [...props.setupCpuStrategies]
    for (let i = 0; i < cpuCount.value; i++) copy[i] = val
    emit('update:setupCpuStrategies', copy)
  },
})

function updateStrategy(idx: number, val: CpuStrategy) {
  const copy = [...props.setupCpuStrategies]
  copy[idx] = val
  emit('update:setupCpuStrategies', copy)
}

function strategyLabel(strategy: CpuStrategy): string {
  switch (strategy) {
    case 'random':     return 'ランダム'
    case 'greedy':     return '効率重視'
    case 'mcts':       return 'モンテカルロ'
    case 'disruptive': return 'お邪魔'
  }
}
</script>

<template>
  <div class="modal-overlay">
    <div class="modal">
      <div class="modal-header">
        <h2>ゲーム設定</h2>
        <button v-if="hasGame" class="modal-close-btn" @click="emit('cancel')">✕</button>
      </div>

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
          <input type="radio" :checked="setupHasPlayer" @change="emit('update:setupHasPlayer', true)" />
          <span>あり</span>
        </label>
        <label class="radio-item">
          <input type="radio" :checked="!setupHasPlayer" @change="emit('update:setupHasPlayer', false)" />
          <span>なし</span>
        </label>
      </div>
      <template v-if="setupHasPlayer">
        <div class="radio-group radio-group--horizontal" style="margin-top:6px">
          <label class="radio-item">
            <input type="radio" :checked="setupPlayerOrder === 0" @change="emit('update:setupPlayerOrder', 0)" />
            <span>手番ランダム</span>
          </label>
          <label v-for="n in setupTotal" :key="n" class="radio-item">
            <input type="radio" :checked="setupPlayerOrder === n" @change="emit('update:setupPlayerOrder', n)" />
            <span>{{ n }}番目</span>
          </label>
        </div>
      </template>

      <div class="radio-group-label">CPUの戦略</div>
      <div v-if="cpuCount > 1" class="cpu-strategy-row">
        <span class="cpu-strategy-label">一括：</span>
        <div class="radio-group radio-group--horizontal">
          <label v-for="s in (['random', 'greedy', 'mcts', 'disruptive'] as CpuStrategy[])" :key="s" class="radio-item">
            <input type="radio" :checked="bulkStrategy === s" @change="bulkStrategy = s" />
            <span>{{ strategyLabel(s) }}</span>
          </label>
        </div>
      </div>
      <div v-for="i in cpuCount" :key="i" class="cpu-strategy-row">
        <span class="cpu-strategy-label">CPU {{ i }}：</span>
        <div class="radio-group radio-group--horizontal">
          <label v-for="s in (['random', 'greedy', 'mcts', 'disruptive'] as CpuStrategy[])" :key="s" class="radio-item">
            <input type="radio" :checked="setupCpuStrategies[i - 1] === s" @change="updateStrategy(i - 1, s)" />
            <span>{{ strategyLabel(s) }}</span>
          </label>
        </div>
      </div>

      <div class="modal-actions">
        <button class="btn-primary" @click="emit('begin')">新しく始める</button>
        <div class="debug-group">
          <label class="check-item">
            <input type="checkbox" :checked="skipAnim" @change="emit('update:skipAnim', ($event.target as HTMLInputElement).checked)" />
            <span>アニメーションをスキップ</span>
          </label>
          <button class="btn-debug" @click="emit('beginDebug')">デバッグスタート</button>
        </div>
      </div>
    </div>
  </div>
</template>
