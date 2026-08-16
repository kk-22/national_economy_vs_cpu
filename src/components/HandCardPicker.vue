<script setup lang="ts">
import HCard from './HCard.vue'
import { cardTooltip } from '../utils/cardTooltip'
import type { HandCard } from '../game/types'

// pendingAction 系UIで繰り返されていた「手札一覧をボタンで表示し選択させる」パターンの共通化。
// selected/disabled/drawn はカードIDの配列で渡す（呼び出し側で判定ロジックを持つ）。
const props = withDefaults(defineProps<{
  hand: HandCard[]
  selectedIds?: string[]
  disabledIds?: string[]
  drawnIds?: string[]
  tipOn?: (text: string | false | null | undefined) => Record<string, unknown>
}>(), {
  selectedIds: () => [],
  disabledIds: () => [],
  drawnIds: () => [],
})

const emit = defineEmits<{ pick: [cardId: string] }>()
</script>

<template>
  <div class="card-wrap">
    <button
      v-for="card in hand" :key="card.id"
      :class="['hcard', 'selectable', {
        selected: selectedIds.includes(card.id),
        'card-drawn': drawnIds.includes(card.id),
        'card-disabled': disabledIds.includes(card.id),
      }]"
      :disabled="disabledIds.includes(card.id)"
      v-bind="props.tipOn ? props.tipOn(card.kind === 'building' ? cardTooltip(card.name!) : '') : {}"
      @click="emit('pick', card.id)"
    >
      <HCard :card="card" />
    </button>
  </div>
</template>
