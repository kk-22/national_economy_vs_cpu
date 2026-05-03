<script setup lang="ts">
import { computed } from 'vue'
import type { CpuStrategy } from '../game/types'

const props = defineProps<{
  setupCpu: number
  setupPlayerOrder: number
  setupCpuStrategies: CpuStrategy[]
  skipAnim: boolean
  hasGame: boolean
}>()

const emit = defineEmits<{
  'update:setupCpu': [v: number]
  'update:setupPlayerOrder': [v: number]
  'update:setupCpuStrategies': [v: CpuStrategy[]]
  'update:skipAnim': [v: boolean]
  begin: []
  beginDebug: []
  cancel: []
}>()

const bulkStrategy = computed({
  get(): CpuStrategy | '' {
    const count = props.setupCpu === 4 ? 4 : props.setupCpu
    const strategies = props.setupCpuStrategies.slice(0, count)
    const first = strategies[0]
    return strategies.every(s => s === first) ? first : ''
  },
  set(val: CpuStrategy | '') {
    if (!val) return
    const count = props.setupCpu === 4 ? 4 : props.setupCpu
    const copy = [...props.setupCpuStrategies]
    for (let i = 0; i < count; i++) copy[i] = val
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
      <h2>ゲーム設定</h2>
      <div class="radio-group-label">CPU数</div>
      <div class="radio-group radio-group--horizontal">
        <label class="radio-item">
          <input type="radio" :checked="setupCpu === 1" @change="emit('update:setupCpu', 1)" />
          <span>1人</span>
        </label>
        <label class="radio-item">
          <input type="radio" :checked="setupCpu === 2" @change="emit('update:setupCpu', 2)" />
          <span>2人</span>
        </label>
        <label class="radio-item">
          <input type="radio" :checked="setupCpu === 3" @change="emit('update:setupCpu', 3)" />
          <span>3人</span>
        </label>
        <label class="radio-item">
          <input type="radio" :checked="setupCpu === 4" @change="emit('update:setupCpu', 4)" />
          <span>4人（プレイヤーなし）</span>
        </label>
      </div>

      <template v-if="setupCpu !== 4">
        <div class="radio-group-label">プレイヤーの手番</div>
        <div class="radio-group radio-group--horizontal">
          <label class="radio-item">
            <input type="radio" :checked="setupPlayerOrder === 0" @change="emit('update:setupPlayerOrder', 0)" />
            <span>ランダム</span>
          </label>
          <label v-for="n in setupCpu + 1" :key="n" class="radio-item">
            <input type="radio" :checked="setupPlayerOrder === n" @change="emit('update:setupPlayerOrder', n)" />
            <span>{{ n }}番目</span>
          </label>
        </div>
      </template>

      <div class="radio-group-label">CPUの戦略</div>
      <div v-if="setupCpu !== 1" class="cpu-strategy-row">
        <span class="cpu-strategy-label">一括：</span>
        <div class="radio-group radio-group--horizontal">
          <label v-for="s in (['random', 'greedy', 'mcts', 'disruptive'] as CpuStrategy[])" :key="s" class="radio-item">
            <input type="radio" :checked="bulkStrategy === s" @change="bulkStrategy = s" />
            <span>{{ strategyLabel(s) }}</span>
          </label>
        </div>
      </div>
      <div v-for="i in (setupCpu === 4 ? 4 : setupCpu)" :key="i" class="cpu-strategy-row">
        <span class="cpu-strategy-label">CPU {{ i }}：</span>
        <div class="radio-group radio-group--horizontal">
          <label v-for="s in (['random', 'greedy', 'mcts', 'disruptive'] as CpuStrategy[])" :key="s" class="radio-item">
            <input type="radio" :checked="setupCpuStrategies[i - 1] === s" @change="updateStrategy(i - 1, s)" />
            <span>{{ strategyLabel(s) }}</span>
          </label>
        </div>
      </div>

      <div class="modal-actions">
        <button class="btn-primary" @click="emit('begin')">ゲーム開始</button>
        <button v-if="hasGame" class="btn-secondary" @click="emit('cancel')">キャンセル</button>
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
