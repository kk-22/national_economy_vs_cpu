<script setup lang="ts">
import type { GameState, ScoreResult, CpuStrategy } from '../game/types'

defineProps<{
  game: GameState
  scores: ScoreResult[]
  canUndo: boolean
}>()

const emit = defineEmits<{
  replay: []
  openSetup: []
  undo: []
}>()

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
  <div class="gameover">
    <div class="gameover-card">
      <h1>ゲーム終了</h1>
      <table>
        <thead><tr><th>プレイヤー</th><th>建物</th><th>残金</th><th>ボーナス</th><th>ペナルティ</th><th>合計</th></tr></thead>
        <tbody>
          <tr v-for="sc in scores" :key="sc.playerId"
            :class="{ winner: sc.playerId === scores.reduce((a,b) => a.total > b.total ? a : b).playerId }">
            <td>
              {{ game.players[sc.playerId].name }}
              <template v-if="game.players[sc.playerId].isCpu">
                <br /><span class="result-strategy">{{ strategyLabel(game.players[sc.playerId].cpuStrategy) }}</span>
              </template>
            </td>
            <td>${{ sc.buildingValue }}</td>
            <td>${{ sc.money }}</td>
            <td>+{{ sc.bonuses }}</td>
            <td>-{{ sc.unpaidPenalty }}</td>
            <td><strong>${{ sc.total }}</strong></td>
          </tr>
        </tbody>
      </table>
      <p class="winner-msg">🏆 {{ game.players[scores.reduce((a,b) => a.total > b.total ? a : b).playerId].name }} の勝利！</p>
      <div class="gameover-actions">
        <button class="btn-primary" @click="emit('replay')">もう一度</button>
        <button class="btn-secondary" @click="emit('openSetup')">設定を変更</button>
        <button class="btn-secondary" :disabled="!canUndo" @click="emit('undo')">◀ 戻る</button>
      </div>
    </div>
  </div>
</template>
