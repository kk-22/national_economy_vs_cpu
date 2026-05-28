<script setup lang="ts">
import { useGame } from '../composables/useGame'
import type { HandCard } from '../game/types'
import { cardLabel, bcardNameStyle, tagBadgeClass } from '../utils/cardDisplay'
import { getConstructionDiscount } from '../game/build'

const props = defineProps<{ card: HandCard }>()
const { getBuildingDef, game, humanPlayer } = useGame()

function effectiveCost(cardName: string): number {
  const base = getBuildingDef(cardName)?.cost ?? 0
  if (!game.value || !humanPlayer.value) return base
  return Math.max(0, base - getConstructionDiscount(game.value, humanPlayer.value.id, cardName))
}

function isDiscounted(cardName: string): boolean {
  if (!game.value || !humanPlayer.value) return false
  return getConstructionDiscount(game.value, humanPlayer.value.id, cardName) > 0
}

function cardTypeTags(name: string): string[] {
  const def = getBuildingDef(name)
  if (!def) return []
  const parts: string[] = []
  if (def.tags.includes('farm')) parts.push('農')
  if (def.tags.includes('factory')) parts.push('工')
  if (!def.canSell) parts.push('禁')
  return parts
}
</script>

<template>
  <span v-if="props.card.kind === 'building'" :class="['bcard-cost', { 'bcard-cost--discounted': isDiscounted(props.card.name!) }]">{{ effectiveCost(props.card.name!) }}</span>
  <span class="bcard-name" :style="props.card.kind === 'building' ? bcardNameStyle(props.card.name!) : {}">{{ cardLabel(props.card) }}</span>
  <span v-if="props.card.kind === 'building'" class="bcard-asset">{{ getBuildingDef(props.card.name!)?.assetValue }}</span>
  <span v-if="props.card.kind === 'building' && cardTypeTags(props.card.name!).length" class="bcard-type-badges">
    <span v-for="t in cardTypeTags(props.card.name!)" :key="t" :class="['bcard-type-badge', tagBadgeClass(t)]">{{ t }}</span>
  </span>
</template>
