<script setup lang="ts">
import { ref, computed, watch, onUnmounted } from 'vue'
import { useGame } from '../composables/useGame'
import { useLogHighlight } from '../composables/useLogHighlight'
import type { Worker, GameEffect, Player } from '../game/types'
import { bcardNameStyle, cardLabel, handCount, handDetail } from '../utils/cardDisplay'
import { ROUND_CARDS } from '../game/constants'
import { ALL_BUILDING_CARDS } from '../game/primitives'
import HandSortHeader from './HandSortHeader.vue'
import HCard from './HCard.vue'

const props = defineProps<{
  activatedIds: string[]
  builtIds: string[]
  drawnIds: string[]
  canPlayerAct: boolean
  settingsPaused: boolean
  cpuThinkingPlayerId: number | null
  tipEnter: (e: MouseEvent, text: string) => void
  tipLeave: () => void
}>()

const emit = defineEmits<{
  menuOpen: []
  openSetup: []
  openSummary: []
  openManual: []
  resume: []
}>()

const {
  game, humanPlayer,
  availablePublicWorkplaces, availableOwnedBuildings,
  pendingAction, paymentSelected, buildableCards, currentWage,
  getBuildingDef,
  clickPublicWorkplace, clickOwnedBuilding,
  clickBuildTarget, clickPaymentCard, clickCancelBuildChoice, clickCancelBuildPayment,
  clickCancelDoublePayment, clickDoubleConfirm,
  clickDiscardCard, clickCancelDiscardChoice, clickRevealedCard, clickHandLimitCard, clickToggleSellBuilding, clickSellOption,
  clickBuildTwoConfirm, clickBuildTwoPayment, clickCancelBuildTwoPayment, clickFreeBuildCard, clickNoSellBuildCard,
  undo, redo, canUndo, canRedo, cpuPaused,
} = useGame()

const cpuPlayers = computed(() => game.value?.players.filter(p => p.isCpu) ?? [])

const publicWorkplacesLabel = computed(() => {
  const round = game.value?.round ?? 1
  if (round >= 9) return '一般職場（最終ラウンド）'
  const nextCard = ROUND_CARDS[round]
  if (!nextCard) return '一般職場'
  const names = nextCard.workplaces.map(wp => wp.name).join('・')
  return `一般職場（次ラウンド：${names}）`
})

// ---- 一般職場ソート ----
type WpSortOrder = 'added' | 'cost' | 'role'
const wpSortOrder = ref<WpSortOrder>(
  (localStorage.getItem('ne-wp-sort') as WpSortOrder) ?? 'added'
)
watch(wpSortOrder, v => localStorage.setItem('ne-wp-sort', v))

const ROLE_RANK: Record<string, number> = {
  'draw-become-start': -1, 'draw': 0, 'draw-if-empty': 0, 'discard-draw': 0, 'reveal-pick': 0,
  'draw-consumption': 1, 'draw-consumption-to': 1, 'gain-supply': 1,
  'add-worker': 2, 'fill-workers': 2,
  'build': 3, 'build-farm-free': 3, 'build-double': 3,
  'discard-gain': 4,
}

function wpCostKey(name: string): [number, number, string] {
  const def = ALL_BUILDING_CARDS[name]
  return [def?.cost ?? 0, def?.assetValue ?? 0, name]
}

const sortedPublicWorkplaces = computed(() => {
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

  // 役割順：同ランク内はコスト順（第2・第3キー同じ）
  return [...wps].sort((a, b) => {
    const ra = ROLE_RANK[a.effect.kind] ?? 99
    const rb = ROLE_RANK[b.effect.kind] ?? 99
    if (ra !== rb) return ra - rb
    const [ca, va, na] = wpCostKey(a.name)
    const [cb, vb, nb] = wpCostKey(b.name)
    return ca !== cb ? ca - cb : va !== vb ? va - vb : na.localeCompare(nb)
  })
})

// ---- ログ行ハイライト ----
const { getLogState, onLogMouseenter, onLogMouseleave, onLogClick } = useLogHighlight(
  () => game.value?.players.map(p => p.name) ?? []
)

function logLineClass(msg: string): string {
  const s = getLogState(msg)
  if (s === 'highlight') return 'log-line log-line--highlight'
  if (s === 'dim') return 'log-line log-line--dim'
  return 'log-line'
}

// ---- 手札ソート ----
type HandSort = 'order' | 'cost'
const HAND_SORT_KEY = 'ne-hand-sort'
const handSort = ref<HandSort>(
  localStorage.getItem(HAND_SORT_KEY) === 'cost' ? 'cost' : 'order'
)
watch(handSort, (v) => { localStorage.setItem(HAND_SORT_KEY, v) })

function sortByCost<T extends { kind: string; name?: string }>(cards: T[]): T[] {
  return [...cards].sort((a, b) => {
    const costA = a.kind === 'building' ? (getBuildingDef(a.name!)?.cost ?? 0) : 0
    const costB = b.kind === 'building' ? (getBuildingDef(b.name!)?.cost ?? 0) : 0
    if (costB !== costA) return costB - costA
    const assetA = a.kind === 'building' ? (getBuildingDef(a.name!)?.assetValue ?? 0) : 0
    const assetB = b.kind === 'building' ? (getBuildingDef(b.name!)?.assetValue ?? 0) : 0
    return assetB - assetA
  })
}

const sortedHand = computed(() => {
  const hand = humanPlayer.value?.hand ?? []
  const consumptions = hand.filter(c => c.kind === 'consumption')
  const buildings = hand.filter(c => c.kind === 'building')
  const sortedBuildings = handSort.value === 'cost' ? sortByCost(buildings) : buildings
  return [...sortedBuildings, ...consumptions]
})


// ---- ニコイチ建設 2枚同時選択 ----
const doubleSelectedIds = ref<string[]>([])

function clickDoubleSelect(cardId: string) {
  const idx = doubleSelectedIds.value.indexOf(cardId)
  if (idx >= 0) {
    doubleSelectedIds.value.splice(idx, 1)
    return
  }
  if (doubleSelectedIds.value.length === 0) {
    doubleSelectedIds.value = [cardId]
    return
  }
  const firstId = doubleSelectedIds.value[0]
  const firstCost = getBuildingDef(buildableCards.value.find(c => c.id === firstId)?.name ?? '')?.cost
  const thisCost = getBuildingDef(buildableCards.value.find(c => c.id === cardId)?.name ?? '')?.cost
  if (firstCost !== undefined && firstCost === thisCost) {
    doubleSelectedIds.value = []
    clickDoubleConfirm(firstId, cardId)
  } else {
    doubleSelectedIds.value = [cardId]
  }
}

function isDoubleCardDisabled(cardId: string): boolean {
  if (!buildableCards.value.some(b => b.id === cardId)) return true
  if (doubleSelectedIds.value.length === 0) return false
  if (doubleSelectedIds.value.includes(cardId)) return false
  const firstId = doubleSelectedIds.value[0]
  const firstCost = getBuildingDef(buildableCards.value.find(c => c.id === firstId)?.name ?? '')?.cost
  const thisCost = getBuildingDef(buildableCards.value.find(c => c.id === cardId)?.name ?? '')?.cost
  return firstCost !== thisCost
}

function cancelDoubleSelect() {
  doubleSelectedIds.value = []
  clickCancelBuildChoice()
}

// ---- 地球建設 2枚同時選択 ----
const buildTwoSelectedIds = ref<string[]>([])

function clickBuildTwoSelect(cardId: string) {
  const idx = buildTwoSelectedIds.value.indexOf(cardId)
  if (idx >= 0) {
    buildTwoSelectedIds.value.splice(idx, 1)
    return
  }
  if (buildTwoSelectedIds.value.length === 0) {
    buildTwoSelectedIds.value = [cardId]
    return
  }
  const firstId = buildTwoSelectedIds.value[0]
  buildTwoSelectedIds.value = []
  clickBuildTwoConfirm(firstId, cardId)
}

function handCardName(cardId: string): string {
  const card = humanPlayer.value?.hand.find(c => c.id === cardId)
  return card?.kind === 'building' ? card.name : ''
}

// ---- 建物売却選択 ----
const sellBuildingError = ref<string | null>(null)

function sellBuildingName(id: string): string {
  return humanPlayer.value?.ownedBuildings.find(b => b.id === id)?.name ?? ''
}

const sellSelectedTotal = computed(() => {
  const pa = pendingAction.value
  if (!pa || pa.kind !== 'choose-sell-buildings') return 0
  return pa.selected.reduce((s, id) => s + (getBuildingDef(sellBuildingName(id))?.assetValue ?? 0), 0)
})

// 賃金不足売却選択中は賃金支払い前の所持金を表示する
const displayMoney = computed(() => {
  const pa = pendingAction.value
  const player = humanPlayer.value
  if (!player) return 0
  if (pa?.kind === 'choose-sell-buildings') {
    return (player.workers.length * currentWage.value) - pa.deficit
  }
  return player.money
})

function clickConfirmSellBuildings() {
  const pa = game.value?.pendingAction
  if (!pa || pa.kind !== 'choose-sell-buildings') return
  const total = sellSelectedTotal.value
  if (total < pa.deficit) {
    sellBuildingError.value = `合計 $${total} は不足分 $${pa.deficit} に足りません`
    return
  }
  // 最小売却チェック: 各建物の価値 > (合計 − 不足分) でなければ不要な建物が含まれている
  const slack = total - pa.deficit
  for (const id of pa.selected) {
    if ((getBuildingDef(sellBuildingName(id))?.assetValue ?? 0) <= slack) {
      sellBuildingError.value = `選択された建物が多すぎます。最小限にする必要があります。`
      return
    }
  }
  sellBuildingError.value = null
  clickSellOption(pa.selected)
}

// ---- 3行リサイズ（縦3分割） ----
const gameMRef = ref<HTMLElement | null>(null)
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
  if (!resizingState || !gameMRef.value) return
  const totalH = gameMRef.value.getBoundingClientRect().height
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


function workerNames(workerIds: string[]): string[] {
  if (!game.value) return []
  return workerIds.map(wid => {
    const p = game.value!.players.find(pl => pl.workers.some(w => w.id === wid))
    return p?.name ?? '?'
  })
}
function workerAvailable(workers: Worker[]): number {
  return workers.filter(w => !w.isTraining && !w.placedAt).length
}

function workerUnderCapacity(player: Player): boolean {
  const shatakuCount = player.ownedBuildings.filter(b => b.name === '社宅').length
  return shatakuCount > 0 && player.workers.length < 5 + shatakuCount
}



function effectDesc(effect: GameEffect): string {
  switch (effect.kind) {
    case 'draw':               return `山札から建物カードを${effect.n}枚引く`
    case 'draw-consumption':   return `消費財を${effect.n}枚引く`
    case 'draw-become-start':  return `カードを1枚引き、スタートプレイヤーになる`
    case 'slash-burn':         return `消費財を5枚引く。ラウンド終了時に廃棄`
    case 'gain-supply':        return `家計から $${effect.n} もらう（家計に$${effect.n}以上必要）`
    case 'reveal-pick':        return `山札から建物カード${effect.n}枚を公開し、1枚選んで手札に加える`
    case 'discard-draw':       return `手札${effect.discard}枚捨てて山札から${effect.draw}枚引く`
    case 'build':              return effect.discount > 0
                                 ? `コスト${effect.discount}割引で建設${effect.drawAfter > 0 ? `。その後${effect.drawAfter}枚引く` : ''}`
                                 : `建設する${effect.drawAfter > 0 ? `。その後${effect.drawAfter}枚引く` : ''}`
    case 'draw-consumption-to':return `消費財を計${effect.target}枚になるまで引く（手札${effect.target}枚以上なら配置不可）`
    case 'build-farm-free':    return `農園マークの建物をコスト無しで建設する`
    case 'discard-gain':       return `手札${effect.discard}枚捨てて家計から $${effect.gain} もらう（家計に$${effect.gain}以上必要）`
    case 'add-worker':         return `労働者を1人雇う${effect.immediate ? '（即時使用可）' : ''}`
    case 'fill-workers':       return `労働者を${effect.target}人になるまで雇う`
    case 'build-double':       return `同コストの建物を2棟同時に建設（コスト1つ分を支払う）`
    case 'draw-if-empty':      return `手札0枚なら${effect.empty}枚、手札1枚以上なら${effect.normal}枚引く`
    case 'p-hand-limit':       return `手札上限 +${effect.n}（恒久効果）`
    case 'p-worker-limit':     return `雇用できる労働者の上限 +${effect.n}（恒久効果）`
    case 'p-forgive-wages':    return `ゲーム終了時、未払い賃金を最大${effect.max}枚まで免除`
    case 'p-per-building':     return `ゲーム終了時、所有建物1棟につき +${effect.pts}点`
    case 'p-per-consumption':  return `ゲーム終了時、手札の消費財1枚につき +${effect.pts}点`
    case 'p-per-worker':       return `ゲーム終了時、労働者1人につき +${effect.pts}点`
    case 'p-per-no-sell':      return `ゲーム終了時、売却不可の建物1棟につき +${effect.pts}点`
    case 'p-per-factory':      return `ゲーム終了時、工場系建物1棟につき +${effect.pts}点`
    // メセナ効果
    case 'draw-consumption-by-hand': return `手札が3枚になるまで消費財を引く`
    case 'discard-gain-household':   return `手札${effect.discard}枚捨てて家計から$${effect.gain}もらう（家計$${effect.minHousehold}以上必要）`
    case 'draw-if-mine':             return `自コマが鉱山に配置中なら建物カードを${effect.n}枚引く`
    case 'build-gain-vp':            return `建設${effect.discount > 0 ? `（コスト${effect.discount}割引）` : ''}し勝利点カードを1枚取る`
    case 'draw-gain-vp':             return `${effect.drawType === 'consumption' ? '消費財' : '建物カード'}を${effect.n}枚引き勝利点カードを1枚取る`
    case 'draw-consumption-if-have': return `手札に消費財あり→${effect.withConsumption}枚、なし→${effect.without}枚引く`
    case 'gain-per-consumption':     return `手札の消費財1枚につき家計から$${effect.perCard}もらう`
    case 'gain-household':           return `家計から$${effect.net}もらう（家計$${effect.minHousehold}以上必要）`
    case 'build-free-if-cheap':      return `資産価値${effect.maxAsset}以下の建物を1棟無料建設`
    case 'build-two':                return `建物2棟を合計コストを支払って同時建設`
    case 'draw-consumption-hold':    return `消費財${effect.n}枚を次のラウンド開始時に手札に加える`
    case 'discard-draw-min-hand':    return `手札${effect.discard}枚捨てて${effect.draw}枚引く（手札${effect.minHand}枚以下は配置不可）`
    case 'draw-with-build-discount': return `建物カードを${effect.n}枚引く\n建設割引：所有する工業マーク建物１つにつき建設コスト-1`
    case 'discard-gain-household-min': return `手札${effect.discard}枚捨てて家計から$${effect.gain}もらう（家計$${effect.minHousehold}以上必要）`
    case 'build-no-sell':            return `売却不可建物をコストを支払って建設し、建物カードを${effect.drawAfter}枚引く`
    case 'p-if-empty-hand':          return `ゲーム終了時、手札0枚なら資産価値+${effect.bonus}`
    case 'p-vp-double':              return `ゲーム終了時、勝利点カードの得点が2倍`
    case 'p-if-own-n-buildings':     return `ゲーム終了時、所有建物${effect.threshold}棟以上なら資産価値+${effect.bonus}`
    case 'p-if-tag-n':               return `ゲーム終了時、${effect.tag === 'farm' ? '農業' : '工業'}建物${effect.threshold}棟以上なら資産価値+${effect.bonus}`
    case 'p-if-no-sell-n':           return `ゲーム終了時、売却不可建物${effect.threshold}棟以上なら資産価値+${effect.bonus}`
    case 'p-vp-build-discount':      return `勝利点${effect.vpThreshold}枚以上で建設コスト${effect.discount}割引（建設時判定）`
    case 'none':               return `効果なし`
    default:                   return ''
  }
}
function constructionDiscountDesc(name: string): string {
  const cd = getBuildingDef(name)?.constructionDiscount
  if (!cd) return ''
  if (cd.condition === 'own-tag') {
    const tagLabel = cd.tag === 'farm' ? '農業マーク' : '工業マーク'
    return `建設割引：${tagLabel}建物を所有していれば建設コスト-${cd.discount}`
  }
  if (cd.condition === 'own-vp-min') {
    return `建設割引：勝利点カード${cd.minVp}枚以上でコスト-${cd.discount}`
  }
  return ''
}

function cardTooltip(name: string): string {
  const d = getBuildingDef(name)
  if (!d) return ''
  const lines: string[] = [effectDesc(d.effect)]
  const discountDesc = constructionDiscountDesc(name)
  if (discountDesc) lines.push(discountDesc)
  const tags: string[] = []
  if (d.tags.includes('farm')) tags.push('農業マーク')
  if (d.tags.includes('factory')) tags.push('工業マーク')
  const attrs: string[] = []
  if (!d.canSell) attrs.push('売却不可')
  if (!d.isWorkplace) attrs.push('使用不可')
  if (tags.length > 0) lines.push('タイプ：' + tags.join(' / '))
  if (attrs.length > 0) lines.push(attrs.join(' / '))
  return lines.filter(Boolean).join('\n')
}
</script>

<template>
  <div v-if="game" class="game">

    <!-- Mobile header (hidden on desktop) -->
    <div class="mobile-header">
      <div class="mobile-info">
        <span class="hbadge">ラウンド {{ game.round }}/9</span>
        <span class="hbadge">賃金 ${{ currentWage }}</span>
        <span class="hbadge">家計 ${{ game.household }}</span>
      </div>
      <div class="mobile-undo-bar">
        <button class="btn-undo" :disabled="!canUndo" @click="undo">◀</button>
        <button v-if="(cpuPaused && !canRedo || settingsPaused) && game?.phase !== 'game-over'" class="btn-redo" @click="emit('resume')">▶ 続ける</button>
        <button v-else class="btn-redo" :disabled="!canRedo" @click="redo">▶</button>
      </div>
      <button class="menu-btn" @click="emit('menuOpen')">☰</button>
    </div>

    <!-- Body: left content + right log -->
    <div class="game-body">

      <!-- 3カラム リサイズ可能レイアウト -->
      <div class="game-main" ref="gameMRef">

        <!-- ▼ Row 0: CPU -->
        <div class="game-col" :style="{ height: rowHeights[0] + '%' }">
          <section class="section cpu-section">
            <div class="cpu-grid">
              <div v-for="cpu in cpuPlayers" :key="cpu.id" class="cpu-col">
                <div v-if="props.cpuThinkingPlayerId === cpu.id" class="cpu-thinking-overlay">
                  <span class="cpu-thinking-spinner"></span>思考中・・・
                </div>
                <div class="cpu-header">
                  <span class="cpu-name">{{ cpu.name }}</span>
                  <span v-if="cpu.unpaidWages > 0" class="unpaid-badge">未払い{{ cpu.unpaidWages }}</span>
                  <span class="worker-badge">労働者{{ workerAvailable(cpu.workers) }}/<span :class="{ 'worker-limit-alert': workerUnderCapacity(cpu) }">{{ cpu.workers.length }}</span></span>
                  <span class="cpu-money">${{ cpu.money }}</span>
                  <span class="hand-count"><span class="hand-count-bold">手札{{ handCount(cpu.hand) }}</span>{{ handDetail(cpu.hand) }}</span>
                  <span v-if="cpu.victoryPoints > 0" class="vp-badge">勝利点{{ cpu.victoryPoints }}枚</span>
                  <span v-if="game.startPlayerIndex === cpu.id" class="sp-badge">🚩SP</span>
                </div>
                <div class="cpu-cards-scroll">
                  <div class="card-wrap">
                    <div v-for="b in cpu.ownedBuildings" :key="b.id"
                      :class="['bcard', { used: b.workerHereId !== null, 'card-activated': activatedIds.includes(b.id), 'card-built': builtIds.includes(b.id) }]"
                      @mouseenter="tipEnter($event, cardTooltip(b.name))"
                      @mouseleave="tipLeave">
                      <span v-if="b.workerHereId !== null" class="bcard-used-label">使用済</span>
                      <span class="bcard-cost">{{ getBuildingDef(b.name)?.cost }}</span>
                      <span class="bcard-name" :style="bcardNameStyle(b.name, true)">{{ b.name }}</span>

                      <span class="bcard-asset">{{ getBuildingDef(b.name)?.assetValue }}</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </section>
        </div>

        <!-- ▼ Divider 0 -->
        <div class="col-divider" @mousedown.prevent="startResize(0, $event)"></div>

        <!-- ▼ Row 1: 一般職場 -->
        <div class="game-col" :style="{ height: rowHeights[1] + '%' }">
          <section class="section workplaces-section">
            <div class="wp-section-header">
              <div class="section-label public-workplaces-label">{{ publicWorkplacesLabel }}</div>
              <select v-model="wpSortOrder" class="wp-sort-select">
                <option value="added">追加順</option>
                <option value="cost">コスト順</option>
                <option value="role">役割順</option>
              </select>
            </div>
            <div class="wp-cards-scroll">
              <div class="card-wrap">
                <div
                  v-for="wp in sortedPublicWorkplaces" :key="wp.id"
                  :class="['wpcard', { used: wp.workerIds.length > 0 && !wp.allowMultiple, available: canPlayerAct && availablePublicWorkplaces.some(w => w.id === wp.id), 'card-activated': activatedIds.includes(wp.id), 'card-built': builtIds.includes(wp.id) }]"
                  @mouseenter="tipEnter($event, effectDesc(wp.effect))"
                  @mouseleave="tipLeave"
                  @click="canPlayerAct && availablePublicWorkplaces.some(w => w.id === wp.id) && clickPublicWorkplace(wp.id)"
                >
                  <div class="wpcard-name">{{ wp.name }}</div>
                  <div class="wpcard-workers">
                    <span v-for="(name, i) in workerNames(wp.workerIds)" :key="i"
                      :class="['wp-wlabel', { faded: wp.allowMultiple }]">{{ name }}</span>
                  </div>
                </div>
              </div>
            </div>
          </section>
        </div>

        <!-- ▼ Divider 1 -->
        <div class="col-divider" @mousedown.prevent="startResize(1, $event)"></div>

        <!-- ▼ Row 2: プレイヤー -->
        <div class="game-col" :style="{ height: rowHeights[2] + '%' }">
          <div v-if="humanPlayer" class="player-area">

            <!-- Player header -->
            <div class="player-header">
              <span class="player-name">{{ humanPlayer?.name }}</span>
              <span v-if="humanPlayer?.unpaidWages" class="unpaid-badge">未払い{{ humanPlayer.unpaidWages }}</span>
              <span v-if="(humanPlayer?.victoryPoints ?? 0) > 0" class="vp-badge">勝利点{{ humanPlayer!.victoryPoints }}枚</span>
              <span class="worker-badge">労働者{{ humanPlayer ? workerAvailable(humanPlayer.workers) : '' }}/<span :class="{ 'worker-limit-alert': humanPlayer != null && workerUnderCapacity(humanPlayer) }">{{ humanPlayer?.workers.length ?? '' }}</span></span>
              <span class="wage-summary">
                所持金${{ displayMoney }} -
                <span :class="displayMoney >= (humanPlayer?.workers.length ?? 0) * currentWage ? 'wage-cost wage-cost--ok' : 'wage-cost'">賃金${{ (humanPlayer?.workers.length ?? 0) * currentWage }}</span>
              </span>
              <span v-if="game.startPlayerIndex === humanPlayer?.id" class="sp-badge">🚩SP</span>
            </div>

            <!-- Pending action -->
            <div v-if="pendingAction" class="pending-area">
              <template v-if="pendingAction.kind === 'choose-build-target' || pendingAction.kind === 'choose-farm-build'">
                <div class="hand-label-row">
                  <HandSortHeader v-model="handSort" :hand="humanPlayer?.hand ?? []" />
                  <span class="pending-title">
                    {{ pendingAction.kind === 'choose-farm-build' ? `${pendingAction.sourceName}で農場を選択（無料）`
                     : `${pendingAction.sourceName}で建設する建物を選択` }}
                  </span>
                </div>
                <div class="card-wrap">
                  <button v-for="card in sortedHand" :key="card.id"
                    :class="['hcard', 'selectable', { 'card-disabled': !buildableCards.some(b => b.id === card.id) }]"
                    @mouseenter="card.kind === 'building' && tipEnter($event, cardTooltip(card.name!))"
                    @mouseleave="tipLeave"
                    @click="clickBuildTarget(card.id)">
                    <HCard :card="card" />
                  </button>
                  <span v-if="buildableCards.length === 0" class="no-options">建設できる建物がありません</span>
                </div>
                <button class="btn-cancel" @click="clickCancelBuildChoice">キャンセル</button>
              </template>

              <template v-else-if="pendingAction.kind === 'choose-double-first' || pendingAction.kind === 'choose-double-second'">
                <div class="hand-label-row">
                  <HandSortHeader v-model="handSort" :hand="humanPlayer?.hand ?? []" />
                  <span class="pending-title">{{ pendingAction.sourceName }}で2棟同時に選択（同コスト2棟）</span>
                </div>
                <div class="card-wrap">
                  <button v-for="card in sortedHand" :key="card.id"
                    :class="['hcard', 'selectable', { selected: doubleSelectedIds.includes(card.id), 'card-disabled': isDoubleCardDisabled(card.id) }]"
                    @mouseenter="card.kind === 'building' && tipEnter($event, cardTooltip(card.name!))"
                    @mouseleave="tipLeave"
                    @click="clickDoubleSelect(card.id)">
                    <HCard :card="card" />
                  </button>
                  <span v-if="buildableCards.length === 0" class="no-options">建設できる建物がありません</span>
                </div>
                <button class="btn-cancel" @click="cancelDoubleSelect">キャンセル</button>
              </template>

              <template v-else-if="pendingAction.kind === 'choose-build-payment' || pendingAction.kind === 'choose-double-payment'">
                <div class="hand-label-row">
                  <HandSortHeader v-model="handSort" :hand="humanPlayer?.hand ?? []" />
                  <span class="pending-title">
                    {{ pendingAction.kind === 'choose-build-payment'
                      ? pendingAction.targetName
                      : `${(humanPlayer!.hand.find(c => c.id === (pendingAction as any).firstId) as any)?.name}と${(humanPlayer!.hand.find(c => c.id === (pendingAction as any).secondId) as any)?.name}` }}の建設コスト{{ (pendingAction as any).cost }}枚選択 ({{ paymentSelected.length }}/{{ (pendingAction as any).cost }})
                  </span>
                </div>
                <div class="card-wrap">
                  <button
                    v-for="card in sortedHand"
                    :key="card.id"
                    :class="['hcard', 'selectable', {
                      selected: paymentSelected.includes(card.id),
                      'card-drawn': drawnIds.includes(card.id),
                      'card-disabled': card.id === (pendingAction as any).targetId || card.id === (pendingAction as any).firstId || card.id === (pendingAction as any).secondId
                    }]"
                    @click="clickPaymentCard(card.id)">
                    <HCard :card="card" />
                  </button>
                </div>
                <button class="btn-cancel" @click="pendingAction.kind === 'choose-build-payment' ? clickCancelBuildPayment() : clickCancelDoublePayment()">戻る</button>
              </template>

              <template v-else-if="pendingAction.kind === 'choose-discard'">
                <div class="hand-label-row">
                  <HandSortHeader v-model="handSort" :hand="humanPlayer?.hand ?? []" />
                  <span class="pending-title">{{ pendingAction.sourceName }}の捨て札を選択 ({{ pendingAction.selected.length }}/{{ pendingAction.count }})</span>
                </div>
                <div class="card-wrap">
                  <button v-for="card in sortedHand" :key="card.id"
                    :class="['hcard', 'selectable', {
                      selected: pendingAction.selected.includes(card.id),
                      'card-drawn': drawnIds.includes(card.id),
                      'card-disabled': !pendingAction.selected.includes(card.id) && pendingAction.selected.length >= pendingAction.count
                    }]"
                    @click="clickDiscardCard(card.id)">
                    <HCard :card="card" />
                  </button>
                </div>
                <button class="btn-cancel" @click="clickCancelDiscardChoice">キャンセル</button>
              </template>

              <template v-else-if="pendingAction.kind === 'choose-from-revealed'">
                <div class="pending-title-row">
                  <span class="pending-title">{{ pendingAction.sourceName }}により1枚選択（残りは捨て札）</span>
                </div>
                <div class="card-wrap">
                  <button v-for="card in pendingAction.revealed" :key="card.id"
                    class="bcard selectable"
                    @mouseenter="card.kind === 'building' && tipEnter($event, cardTooltip(card.name!))"
                    @mouseleave="tipLeave"
                    @click="clickRevealedCard(card.id)">
                    <HCard :card="card" />
                  </button>
                </div>
                <div v-if="humanPlayer?.ownedBuildings.length" class="hand-label-row" style="margin-top: 6px;">
                  <div class="subsection-label"><span class="hand-count-bold">建物{{ humanPlayer.ownedBuildings.length }}枚</span>（参照用）</div>
                </div>
                <div v-if="humanPlayer?.ownedBuildings.length" class="card-wrap">
                  <div v-for="b in humanPlayer.ownedBuildings" :key="b.id"
                    class="bcard card-disabled"
                    @mouseenter="tipEnter($event, cardTooltip(b.name))"
                    @mouseleave="tipLeave">
                    <span class="bcard-cost">{{ getBuildingDef(b.name)?.cost }}</span>
                    <span class="bcard-name" :style="bcardNameStyle(b.name)">{{ b.name }}</span>
                    <span class="bcard-asset">{{ getBuildingDef(b.name)?.assetValue }}</span>
                  </div>
                </div>
                <div v-if="humanPlayer?.hand.length" class="hand-label-row" style="margin-top: 6px;">
                  <div class="subsection-label"><span class="hand-count-bold">手札{{ handCount(humanPlayer?.hand ?? []) }}</span>{{ handDetail(humanPlayer?.hand ?? []) }}（参照用）</div>
                </div>
                <div v-if="humanPlayer?.hand.length" class="card-wrap">
                  <div v-for="card in sortedHand" :key="card.id" class="hcard card-disabled"
                    @mouseenter="card.kind === 'building' && tipEnter($event, cardTooltip(card.name!))"
                    @mouseleave="tipLeave">
                    <HCard :card="card" />
                  </div>
                </div>
              </template>

              <template v-else-if="pendingAction.kind === 'choose-hand-limit'">
                <div class="hand-label-row">
                  <HandSortHeader v-model="handSort" :hand="humanPlayer?.hand ?? []" />
                  <span class="pending-title hand-limit-title">
                    ⚠ 手札上限超過（上限{{ pendingAction.limit }}枚）：{{ pendingAction.count }}枚捨ててください
                    （{{ pendingAction.selected.length }}/{{ pendingAction.count }}）
                  </span>
                </div>
                <div class="card-wrap">
                  <button v-for="card in sortedHand" :key="card.id"
                    :class="['hcard', 'selectable', {
                      selected: pendingAction.selected.includes(card.id),
                      'card-drawn': drawnIds.includes(card.id),
                      'card-disabled': !pendingAction.selected.includes(card.id) && pendingAction.selected.length >= pendingAction.count
                    }]"
                    @mouseenter="card.kind === 'building' && tipEnter($event, cardTooltip(card.name!))"
                    @mouseleave="tipLeave"
                    @click="clickHandLimitCard(card.id)">
                    <HCard :card="card" />
                  </button>
                </div>
              </template>

              <template v-else-if="pendingAction.kind === 'choose-sell-buildings'">
                <div class="pending-title-row">
                  <span :class="['pending-title', sellSelectedTotal >= pendingAction.deficit ? 'sell-ok' : 'sell-warning']">
                    ⚠ 賃金不足のため売却する建物を選択（選択中 ${{ sellSelectedTotal }} / 必要額 ${{ pendingAction.deficit }}）
                  </span>
                </div>
                <div class="sell-buildings-row">
                  <div class="card-wrap">
                    <button
                      v-for="b in humanPlayer?.ownedBuildings ?? []" :key="b.id"
                      :class="['bcard', pendingAction.sellableIds.includes(b.id) ? 'selectable' : 'card-disabled', { selected: pendingAction.selected.includes(b.id) }]"
                      :disabled="!pendingAction.sellableIds.includes(b.id)"
                      @mouseenter="tipEnter($event, cardTooltip(b.name))"
                      @mouseleave="tipLeave"
                      @click="pendingAction.sellableIds.includes(b.id) && clickToggleSellBuilding(b.id)">
                      <span class="bcard-cost">{{ getBuildingDef(b.name)?.cost }}</span>
                      <span class="bcard-name" :style="bcardNameStyle(b.name)">{{ b.name }}</span>
                      <span class="bcard-asset">{{ getBuildingDef(b.name)?.assetValue }}</span>
                    </button>
                  </div>
                  <div class="sell-confirm-col">
                    <div v-if="sellBuildingError" class="sell-error">{{ sellBuildingError }}</div>
                    <button class="btn-confirm" :disabled="pendingAction.selected.length === 0" @click="clickConfirmSellBuildings">確定</button>
                  </div>
                </div>
                <div v-if="humanPlayer?.hand.length" class="hand-label-row" style="margin-top: 6px;">
                  <div class="subsection-label"><span class="hand-count-bold">手札{{ handCount(humanPlayer?.hand ?? []) }}</span>{{ handDetail(humanPlayer?.hand ?? []) }}（売却不可）</div>
                </div>
                <div v-if="humanPlayer?.hand.length" class="card-wrap">
                  <div v-for="card in sortedHand" :key="card.id" class="hcard card-disabled">
                    <HCard :card="card" />
                  </div>
                </div>
              </template>

              <!-- 地球建設: 2棟同時選択 -->
              <template v-else-if="pendingAction.kind === 'choose-build-two-first'">
                <div class="hand-label-row">
                  <HandSortHeader v-model="handSort" :hand="humanPlayer?.hand ?? []" />
                  <span class="pending-title">
                    {{ pendingAction.sourceName }}：建設する建物を2棟選択
                    ({{ buildTwoSelectedIds.length }}/2)
                  </span>
                </div>
                <div class="card-wrap">
                  <button v-for="card in sortedHand" :key="card.id"
                    :class="['hcard', 'selectable', {
                      selected: buildTwoSelectedIds.includes(card.id),
                      'card-disabled': card.kind !== 'building',
                    }]"
                    @mouseenter="card.kind === 'building' && tipEnter($event, cardTooltip(card.name!))"
                    @mouseleave="tipLeave"
                    @click="clickBuildTwoSelect(card.id)">
                    <HCard :card="card" />
                  </button>
                </div>
                <button class="btn-cancel" @click="clickCancelBuildChoice">キャンセル</button>
              </template>

              <!-- 地球建設: 支払い選択 -->
              <template v-else-if="pendingAction.kind === 'choose-build-two-payment'">
                <div class="hand-label-row">
                  <HandSortHeader v-model="handSort" :hand="humanPlayer?.hand ?? []" />
                  <span class="pending-title">
                    {{ handCardName(pendingAction.firstId) }}と{{ handCardName(pendingAction.secondId) }}の建設コスト合計{{ pendingAction.totalCost }}枚を選択
                    ({{ paymentSelected.length }}/{{ pendingAction.totalCost }})
                  </span>
                </div>
                <div class="card-wrap">
                  <button v-for="card in sortedHand" :key="card.id"
                    :class="['hcard', 'selectable', {
                      selected: paymentSelected.includes(card.id),
                      'card-disabled': card.id === pendingAction.firstId || card.id === pendingAction.secondId
                    }]"
                    @mouseenter="card.kind === 'building' && tipEnter($event, cardTooltip(card.name!))"
                    @mouseleave="tipLeave"
                    @click="clickBuildTwoPayment(card.id)">
                    <HCard :card="card" />
                  </button>
                </div>
                <button class="btn-cancel" @click="clickCancelBuildTwoPayment">戻る</button>
              </template>

              <!-- プレハブ工務店: コスト以下の建物を無料建設 -->
              <template v-else-if="pendingAction.kind === 'choose-free-build'">
                <div class="hand-label-row">
                  <HandSortHeader v-model="handSort" :hand="humanPlayer?.hand ?? []" />
                  <span class="pending-title">{{ pendingAction.sourceName }}：資産価値{{ pendingAction.maxAsset }}以下の建物を無料建設</span>
                </div>
                <div class="card-wrap">
                  <button v-for="card in sortedHand" :key="card.id"
                    :class="['hcard', 'selectable', { 'card-disabled': !buildableCards.some(b => b.id === card.id) }]"
                    @mouseenter="card.kind === 'building' && tipEnter($event, cardTooltip(card.name!))"
                    @mouseleave="tipLeave"
                    @click="clickFreeBuildCard(card.id)">
                    <HCard :card="card" />
                  </button>
                </div>
                <button class="btn-cancel" @click="clickCancelBuildChoice">キャンセル</button>
              </template>

              <!-- 建築会社: 売却禁止建物を選択して建設 -->
              <template v-else-if="pendingAction.kind === 'choose-no-sell-build'">
                <div class="hand-label-row">
                  <HandSortHeader v-model="handSort" :hand="humanPlayer?.hand ?? []" />
                  <span class="pending-title">{{ pendingAction.sourceName }}：売却不可の建物を選択して建設</span>
                </div>
                <div class="card-wrap">
                  <button v-for="card in sortedHand" :key="card.id"
                    :class="['hcard', 'selectable', { 'card-disabled': !buildableCards.some(b => b.id === card.id) }]"
                    @mouseenter="card.kind === 'building' && tipEnter($event, cardTooltip(card.name!))"
                    @mouseleave="tipLeave"
                    @click="clickNoSellBuildCard(card.id)">
                    <HCard :card="card" />
                  </button>
                </div>
                <button class="btn-cancel" @click="clickCancelBuildChoice">キャンセル</button>
              </template>

            </div>

            <!-- Normal view (no pending) -->
            <div v-else class="player-content">
              <div v-if="humanPlayer?.ownedBuildings.length" class="player-subsection">
                <div class="bld-scroll">
                  <div class="card-wrap">
                    <div v-for="b in humanPlayer.ownedBuildings" :key="b.id"
                      :class="['bcard', { used: b.workerHereId !== null, available: canPlayerAct && availableOwnedBuildings.some(x => x.id === b.id), 'card-activated': activatedIds.includes(b.id), 'card-built': builtIds.includes(b.id) }]"
                      @mouseenter="tipEnter($event, cardTooltip(b.name))"
                      @mouseleave="tipLeave"
                      @click="canPlayerAct && availableOwnedBuildings.some(x => x.id === b.id) && clickOwnedBuilding(b.id)">
                      <span v-if="b.workerHereId !== null" class="bcard-used-label">使用済</span>
                      <span class="bcard-cost">{{ getBuildingDef(b.name)?.cost }}</span>
                      <span class="bcard-name" :style="bcardNameStyle(b.name)">{{ b.name }}</span>

                      <span class="bcard-asset">{{ getBuildingDef(b.name)?.assetValue }}</span>
                    </div>
                  </div>
                </div>
              </div>
              <div class="player-subsection">
                <div class="hand-label-row">
                  <HandSortHeader v-model="handSort" :hand="humanPlayer?.hand ?? []" />
                </div>
                <div class="hand-scroll">
                  <div class="card-wrap">
                    <div v-for="card in sortedHand" :key="card.id"
                      :class="['hcard', { 'card-drawn': drawnIds.includes(card.id) }]"
                      @mouseenter="card.kind === 'building' && tipEnter($event, cardTooltip(card.name!))"
                      @mouseleave="tipLeave">
                      <span v-if="card.kind === 'building'" class="bcard-cost">{{ getBuildingDef(card.name!)?.cost }}</span>
                      <span class="bcard-name" :style="card.kind === 'building' ? bcardNameStyle(card.name!) : {}">{{ cardLabel(card) }}</span>
                      <span v-if="card.kind === 'building'" class="bcard-asset">{{ getBuildingDef(card.name!)?.assetValue }}</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>

          </div><!-- /player-area -->
        </div><!-- /game-col player -->

      </div><!-- /game-main -->

      <!-- Right: log panel -->
      <div class="log-panel">
        <div class="log-info">
          <div class="log-info-row">
            <span class="hbadge">ラウンド {{ game.round }}/9</span>
            <span class="hbadge">山札 {{ game.buildingDeck.length }}枚</span>
          </div>
          <div class="log-info-row">
            <span class="hbadge">家計 ${{ game.household }}</span>
            <span class="hbadge">賃金 ${{ currentWage }}</span>
          </div>
          <button class="btn-restart" @click="emit('openManual')">📖 説明書</button>
          <button class="btn-restart" @click="emit('openSetup')">⚙️ ゲーム設定</button>
          <button class="btn-restart" @click="emit('openSummary')">📋 ラウンド毎の情報</button>
        </div>
        <div class="log-undo-bar">
          <button class="btn-undo" :disabled="!canUndo" @click="undo">◀ 戻る</button>
          <button v-if="(cpuPaused && !canRedo || settingsPaused) && game?.phase !== 'game-over'" class="btn-redo" @click="emit('resume')">▶ 続ける</button>
          <button v-else class="btn-redo" :disabled="!canRedo" @click="redo">進む ▶</button>
        </div>
        <div class="log-label">ログ</div>
        <div class="log-scroll">
          <div
            v-for="(msg, i) in [...game.log].reverse()"
            :key="i"
            :class="logLineClass(msg)"
            @mouseenter="onLogMouseenter(msg)"
            @mouseleave="onLogMouseleave"
            @click="onLogClick(msg)"
          >{{ msg }}</div>
        </div>
      </div>

    </div><!-- /game-body -->
  </div>
</template>

<style scoped>
.wp-section-header {
  display: flex;
  align-items: center;
  gap: 6px;
  line-height: 1;
}

.wp-section-header .section-label {
  margin: 0;
  line-height: 1;
}

.wp-sort-select {
  font-size: 0.72rem;
  padding: 1px 4px;
  border: 1px solid #ccc;
  border-radius: 3px;
  background: #fff;
  cursor: pointer;
  flex-shrink: 0;
  vertical-align: middle;
}
</style>
