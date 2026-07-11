import { ref, onUnmounted, type Ref } from 'vue'

// GameBoard の3行縦分割リサイズ（ドラッグでdivider間の高さ比率を変更する）
export function useRowResize(containerRef: Ref<HTMLElement | null>) {
  const rowHeights = ref([33.33, 33.33, 33.34])

  let resizingState: {
    dividerIdx: number; startY: number; startH0: number; startH1: number
  } | null = null

  function startResize(dividerIdx: number, e: MouseEvent) {
    e.preventDefault()
    resizingState = {
      dividerIdx, startY: e.clientY,
      startH0: rowHeights.value[dividerIdx],
      startH1: rowHeights.value[dividerIdx + 1],
    }
    window.addEventListener('mousemove', onResizeMove)
    window.addEventListener('mouseup', stopResize)
  }

  function onResizeMove(e: MouseEvent) {
    if (!resizingState || !containerRef.value) return
    const totalH = containerRef.value.getBoundingClientRect().height
    const dp = ((e.clientY - resizingState.startY) / totalH) * 100
    const hs = [...rowHeights.value]
    hs[resizingState.dividerIdx]     = Math.max(10, resizingState.startH0 + dp)
    hs[resizingState.dividerIdx + 1] = Math.max(10, resizingState.startH1 - dp)
    rowHeights.value = hs
  }

  function stopResize() {
    resizingState = null
    window.removeEventListener('mousemove', onResizeMove)
    window.removeEventListener('mouseup', stopResize)
  }

  onUnmounted(() => {
    window.removeEventListener('mousemove', onResizeMove)
    window.removeEventListener('mouseup', stopResize)
  })

  return { rowHeights, startResize }
}
