import { ref } from 'vue'

// 長押しでダイアログを表示、通常クリック（長押し未満）ではactionを即実行する（戻る/次へボタン共通）
export function useLongPressAction(canAct: { readonly value: boolean }, action: () => void, delayMs = 600) {
  const showDialog = ref(false)
  let timer: ReturnType<typeof setTimeout> | null = null
  let triggered = false

  function startLongPress() {
    if (!canAct.value) return
    triggered = false
    timer = setTimeout(() => {
      triggered = true
      showDialog.value = true
    }, delayMs)
  }

  function cancelLongPress() {
    if (timer !== null) { clearTimeout(timer); timer = null }
  }

  function handleTouchEnd() {
    cancelLongPress()
    if (!triggered) action()
    triggered = false
  }

  function handleClick() {
    if (triggered) { triggered = false; return }
    action()
  }

  return { showDialog, startLongPress, cancelLongPress, handleTouchEnd, handleClick }
}
