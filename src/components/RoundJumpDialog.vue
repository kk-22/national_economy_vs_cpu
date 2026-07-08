<script setup lang="ts">
const props = defineProps<{
  availableRounds: number[]
  mode?: 'undo' | 'redo'
}>()
const emit = defineEmits<{
  close: []
  jump: [round: number]
  jumpEnd: []
}>()

const isRedo = props.mode === 'redo'
const title = isRedo ? 'ラウンドへ進む' : 'ラウンドに戻る'
</script>

<template>
  <Teleport to="body">
    <div class="modal-overlay" @click.self="emit('close')">
      <div class="modal round-jump-modal">
        <div class="modal-header">
          <h2>{{ title }}</h2>
          <button class="modal-close-btn" @click="emit('close')">✕</button>
        </div>
        <div class="round-jump-list">
          <button
            v-for="round in availableRounds"
            :key="round"
            class="btn-round-jump"
            @click="emit('jump', round)"
          >{{ round }}ラウンド目{{ isRedo ? 'の最初へ' : 'に戻る' }}</button>
          <button
            v-if="isRedo"
            class="btn-round-jump btn-round-jump-end"
            @click="emit('jumpEnd')"
          >最後まで進む</button>
        </div>
      </div>
    </div>
  </Teleport>
</template>
