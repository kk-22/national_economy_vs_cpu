<script setup lang="ts">
defineProps<{ availableRounds: number[] }>()
const emit = defineEmits<{
  close: []
  jump: [round: number]
}>()
</script>

<template>
  <Teleport to="body">
    <div class="modal-overlay" @click.self="emit('close')">
      <div class="modal round-jump-modal">
        <div class="modal-header">
          <h2>ラウンドに戻る</h2>
          <button class="modal-close-btn" @click="emit('close')">✕</button>
        </div>
        <div class="round-jump-list">
          <button
            v-for="round in availableRounds"
            :key="round"
            class="btn-round-jump"
            @click="emit('jump', round)"
          >{{ round }}ラウンド目に戻る</button>
        </div>
      </div>
    </div>
  </Teleport>
</template>
