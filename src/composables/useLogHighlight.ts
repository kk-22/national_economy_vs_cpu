import { ref } from 'vue'

type HighlightKey = { type: 'player'; name: string } | { type: 'round' }

export function useLogHighlight(getPlayerNames: () => string[]) {
  const hoveredHighlight = ref<HighlightKey | null>(null)
  const selectedHighlight = ref<HighlightKey | null>(null)

  function getLogPlayer(msg: string): string | null {
    for (const name of getPlayerNames()) {
      if (msg.startsWith(name + ':') || msg.startsWith(name + ' ')) return name
    }
    return null
  }

  function isRoundMarker(msg: string): boolean {
    return /ラウンド \d+ (開始|終了)/.test(msg)
  }

  function getLineKey(msg: string): HighlightKey | null {
    if (isRoundMarker(msg)) return { type: 'round' }
    const player = getLogPlayer(msg)
    if (player) return { type: 'player', name: player }
    return null
  }

  // Returns '' | 'highlight' | 'dim'
  function getLogState(msg: string): '' | 'highlight' | 'dim' {
    const active = selectedHighlight.value ?? hoveredHighlight.value
    if (!active) return ''
    if (active.type === 'player') {
      if (getLogPlayer(msg) === active.name) return 'highlight'
      if (getLogPlayer(msg) === null) return ''
      return 'dim'
    }
    if (isRoundMarker(msg)) return 'highlight'
    return 'dim'
  }

  function onLogMouseenter(msg: string) {
    const key = getLineKey(msg)
    if (key) hoveredHighlight.value = key
  }

  function onLogMouseleave() {
    hoveredHighlight.value = null
  }

  function onLogClick(msg: string) {
    const key = getLineKey(msg)
    if (!key) return
    const cur = selectedHighlight.value
    if (cur && cur.type === key.type &&
      (cur.type !== 'player' || (key.type === 'player' && cur.name === key.name))) {
      selectedHighlight.value = null
    } else {
      selectedHighlight.value = key
    }
  }

  return { getLogState, onLogMouseenter, onLogMouseleave, onLogClick }
}
