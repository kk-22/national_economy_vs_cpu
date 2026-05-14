<script setup lang="ts">
import type { HandCard } from '../game/types'
import { handCount, handDetail } from '../utils/cardDisplay'

defineProps<{ hand: HandCard[] }>()
const sort = defineModel<'order' | 'cost'>({ required: true })
</script>

<template>
  <div class="subsection-label"><span class="hand-count-bold">手札{{ handCount(hand) }}</span>{{ handDetail(hand) }}</div>
  <select v-model="sort" class="hand-sort-select">
    <option value="order">入手順</option>
    <option value="cost">コスト順</option>
  </select>
</template>
