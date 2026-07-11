import { ref, computed, watch, type Ref } from 'vue'
import { ROUND_CARDS } from '../game/constants'
import { ALL_BUILDING_CARDS } from '../game/primitives'
import type { GameState, PublicWorkplace } from '../game/types'

export type WpSortOrder = 'added' | 'cost' | 'role'

const ROLE_RANK: Record<string, number> = {
  'draw-become-start': -1, 'draw': 0, 'draw-if-empty': 0, 'discard-draw': 0, 'reveal-pick': 0,
  'draw-consumption': 1, 'draw-consumption-to': 1, 'gain-supply': 1,
  'add-worker': 2, 'fill-workers': 2,
  'build': 3, 'build-farm-free': 3, 'build-double': 3,
  'discard-gain': 4,
}

// 職場名→追加ラウンド（ラウンドカード職場のみ。sold は Infinity）
const WP_ADDED_ROUND = new Map<string, number>(
  ROUND_CARDS.flatMap((rc, i) => rc.workplaces.map(wp => [wp.name, i + 1] as [string, number]))
)

function wpCostKey(name: string): [number, number, string] {
  const def = ALL_BUILDING_CARDS[name]
  return [def?.cost ?? 0, def?.assetValue ?? 0, name]
}

export function useWorkplaceSort(game: Ref<GameState | null>) {
  const wpSortOrder = ref<WpSortOrder>(
    (localStorage.getItem('ne-wp-sort') as WpSortOrder) ?? 'added'
  )
  watch(wpSortOrder, v => localStorage.setItem('ne-wp-sort', v))

  const sortedPublicWorkplaces = computed<PublicWorkplace[]>(() => {
    const wps = game.value?.publicWorkplaces ?? []
    if (wpSortOrder.value === 'added') return wps

    if (wpSortOrder.value === 'cost') {
      // ラウンドカード職場を追加順（降順）で先頭に、続いて売却建物をコスト順
      const roundWps = wps.filter(wp => wp.kind === 'round')
      const soldWps = wps.filter(wp => wp.kind === 'sold').sort((a, b) => {
        const [ca, va, na] = wpCostKey(a.name)
        const [cb, vb, nb] = wpCostKey(b.name)
        return ca !== cb ? ca - cb : va !== vb ? va - vb : na.localeCompare(nb)
      })
      return [...roundWps, ...soldWps]
    }

    // 役割順: 第1=役割ランク / 第2=追加ラウンド(sold は末尾) / 第3=コスト / 第4=資産価値 / 第5=名前
    return [...wps].sort((a, b) => {
      const ra = ROLE_RANK[a.effect.kind] ?? 99
      const rb = ROLE_RANK[b.effect.kind] ?? 99
      if (ra !== rb) return ra - rb
      const roundA = WP_ADDED_ROUND.get(a.name) ?? Infinity
      const roundB = WP_ADDED_ROUND.get(b.name) ?? Infinity
      if (roundA !== roundB) return roundA - roundB
      const [ca, va, na] = wpCostKey(a.name)
      const [cb, vb, nb] = wpCostKey(b.name)
      return ca !== cb ? ca - cb : va !== vb ? va - vb : na.localeCompare(nb)
    })
  })

  return { wpSortOrder, sortedPublicWorkplaces }
}
