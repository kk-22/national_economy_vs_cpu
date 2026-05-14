<script setup lang="ts">
import { useGame } from '../composables/useGame'
import type { HandCard } from '../game/types'
import { cardLabel, bcardNameStyle } from '../utils/cardDisplay'

const props = defineProps<{ card: HandCard }>()
const { getBuildingDef } = useGame()
</script>

<template>
  <span v-if="props.card.kind === 'building'" class="bcard-cost">{{ getBuildingDef(props.card.name!)?.cost }}</span>
  <span class="bcard-name" :style="props.card.kind === 'building' ? bcardNameStyle(props.card.name!) : {}">{{ cardLabel(props.card) }}</span>
  <span v-if="props.card.kind === 'building'" class="bcard-asset">{{ getBuildingDef(props.card.name!)?.assetValue }}</span>
</template>
