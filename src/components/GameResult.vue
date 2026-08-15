<script setup lang="ts">
import { ref } from 'vue'
import type { GameState, ScoreResult, CpuStrategy } from '../game/types'
import RoundJumpDialog from './RoundJumpDialog.vue'

const props = defineProps<{
  game: GameState
  scores: ScoreResult[]
  canUndo: boolean
  availableRoundsForJump: number[]
}>()

const emit = defineEmits<{
  replay: []
  openSetup: []
  openPlayHistory: []
  close: []
  undo: []
  jump: [round: number]
}>()

const showRoundJumpDialog = ref(false)

function handleRoundJump(round: number) {
  showRoundJumpDialog.value = false
  emit('jump', round)
}

function strategyLabel(strategy: CpuStrategy): string {
  switch (strategy) {
    case 'random':     return 'ランダム'
    case 'greedy':     return '貪欲法'
    case 'beam':       return 'ビームサーチ'
    case 'mcts':       return 'モンテカルロ'
    case 'disruptive': return 'お邪魔'
  }
}
</script>

<template>
  <div class="gameover" @click.self="emit('close')">
    <div class="gameover-card">
      <div class="modal-header">
        <h2>ゲーム終了</h2>
        <button class="modal-close-btn" @click="emit('close')">✕</button>
      </div>
      <table>
        <thead><tr><th>プレイヤー</th><th>労働者</th><th>総手数</th><th>残金</th><th>未払い賃金</th><th>勝利点</th><th>建物価値</th><th>建物効果</th><th>合計</th></tr></thead>
        <tbody>
          <tr v-for="sc in scores" :key="sc.playerId"
            :class="{ winner: sc.playerId === scores.reduce((a,b) => a.total > b.total ? a : b).playerId }">
            <td>
              {{ game.players[sc.playerId].name }}
              <template v-if="game.players[sc.playerId].isCpu">
                <br /><span class="result-strategy">{{ strategyLabel(game.players[sc.playerId].cpuStrategy) }}</span>
              </template>
            </td>
            <td>{{ sc.workerCount }}</td>
            <td>{{ sc.actionsPlaced }}</td>
            <td>${{ sc.money }}</td>
            <td>{{ sc.unpaidPenalty ? '-' + sc.unpaidPenalty : '' }}</td>
            <td>
              <template v-if="sc.victoryPoints">
                {{ sc.victoryPoints }}枚
                <span v-if="sc.vpScore" class="result-vpscore">(+{{ sc.vpScore }})</span>
              </template>
            </td>
            <td>${{ sc.buildingValue }}</td>
            <td>{{ sc.bonuses || '' }}</td>
            <td><strong>${{ sc.total }}</strong></td>
          </tr>
        </tbody>
      </table>
      <p class="winner-msg">🏆 {{ game.players[scores.reduce((a,b) => a.total > b.total ? a : b).playerId].name }} の勝利！</p>
      <div class="gameover-actions">
        <div class="gameover-actions-left">
          <button
            class="btn-secondary"
            :disabled="!canUndo"
            @click="showRoundJumpDialog = true"
          >ラウンド指定で戻る</button>
          <button
            class="btn-secondary"
            :disabled="!canUndo"
            @click="emit('undo')"
          >◀ 1手戻る</button>
          <button class="btn-secondary" @click="emit('openPlayHistory')">🏆 プレイ履歴</button>
        </div>
        <div class="gameover-actions-right">
          <button class="btn-primary" @click="emit('replay')">もう一度</button>
          <button class="btn-secondary" @click="emit('openSetup')">設定を変更</button>
        </div>
      </div>
    </div>
  </div>

  <RoundJumpDialog
    v-if="showRoundJumpDialog"
    :available-rounds="availableRoundsForJump"
    @close="showRoundJumpDialog = false"
    @jump="handleRoundJump"
  />
</template>
