import { ref, computed, watch, type Ref } from 'vue'
import type { BuildingCardDef, HandCard, Player } from '../game/types'

export type HandSort = 'order' | 'cost'
const HAND_SORT_KEY = 'ne-hand-sort'

function sortByCost<T extends { kind: string; name?: string }>(
  cards: T[],
  getBuildingDef: (name: string) => BuildingCardDef | undefined,
): T[] {
  return [...cards].sort((a, b) => {
    const costA = a.kind === 'building' ? (getBuildingDef(a.name!)?.cost ?? 0) : 0
    const costB = b.kind === 'building' ? (getBuildingDef(b.name!)?.cost ?? 0) : 0
    if (costB !== costA) return costB - costA
    const assetA = a.kind === 'building' ? (getBuildingDef(a.name!)?.assetValue ?? 0) : 0
    const assetB = b.kind === 'building' ? (getBuildingDef(b.name!)?.assetValue ?? 0) : 0
    return assetB - assetA
  })
}

export function useHandSort(humanPlayer: Ref<Player | null>, getBuildingDef: (name: string) => BuildingCardDef | undefined) {
  const handSort = ref<HandSort>(
    localStorage.getItem(HAND_SORT_KEY) === 'cost' ? 'cost' : 'order'
  )
  watch(handSort, (v) => { localStorage.setItem(HAND_SORT_KEY, v) })

  const sortedHand = computed<HandCard[]>(() => {
    const hand = humanPlayer.value?.hand ?? []
    const consumptions = hand.filter(c => c.kind === 'consumption')
    const buildings = hand.filter(c => c.kind === 'building')
    const sortedBuildings = handSort.value === 'cost' ? sortByCost(buildings, getBuildingDef) : buildings
    return [...sortedBuildings, ...consumptions]
  })

  return { handSort, sortedHand }
}
