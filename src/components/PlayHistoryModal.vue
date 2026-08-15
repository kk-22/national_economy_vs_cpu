<script setup lang="ts">
import { ref, computed } from 'vue'
import type { GameSeries, CpuStrategy, GameEffect } from '../game/types'
import type { PlaySummary } from '../game/historyStats'
import { usePlayHistory } from '../composables/usePlayHistory'
import { ROUND_CARDS } from '../game/constants'
import { ALL_BUILDING_CARDS } from '../game/primitives'
import { cardTooltip, workplaceTooltip } from '../utils/cardTooltip'

const props = defineProps<{
  tipEnter: (e: MouseEvent, text: string) => void
  tipLeave: () => void
  tipTouchStart: (e: TouchEvent, text: string) => void
  tipTouchEnd: () => void
  tipTouchMove: (e: TouchEvent) => void
}>()

const emit = defineEmits<{ close: [] }>()

const { loadPlayHistory, deletePlayRecord } = usePlayHistory()
const records = ref(loadPlayHistory())

// 施設名からツールチップ文言を引く。建物カードはALL_BUILDING_CARDS、
// 露店等のラウンド専用職場はROUND_CARDS（+グローリーの遺跡）から効果を引く。
const ROUND_WORKPLACE_EFFECTS = new Map<string, GameEffect>()
for (const rc of ROUND_CARDS) {
  for (const wp of rc.workplaces) {
    if (!ROUND_WORKPLACE_EFFECTS.has(wp.name)) ROUND_WORKPLACE_EFFECTS.set(wp.name, wp.effect)
  }
}
ROUND_WORKPLACE_EFFECTS.set('遺跡', { kind: 'draw-gain-vp', n: 1, drawType: 'consumption' })

function facilityTooltip(name: string): string {
  if (ALL_BUILDING_CARDS[name]) return cardTooltip(name)
  const effect = ROUND_WORKPLACE_EFFECTS.get(name)
  return effect ? workplaceTooltip(name, effect) : ''
}

function tipOn(text: string | false | null | undefined) {
  if (!text) return {}
  return {
    onMouseenter: (e: MouseEvent) => props.tipEnter(e, text),
    onMouseleave: props.tipLeave,
    onTouchstart: (e: TouchEvent) => props.tipTouchStart(e, text),
    onTouchend: props.tipTouchEnd,
    onTouchcancel: props.tipTouchEnd,
    onTouchmove: (e: TouchEvent) => props.tipTouchMove(e),
  }
}

const SERIES_LABEL: Record<GameSeries, string> = { progress: 'プログレス', mecenat: 'メセナ', glory: 'グローリー' }
// CPU戦略の表示名はゲーム設定画面（GameSetup.vue）の難易度表記に合わせる
const STRATEGY_LABEL: Record<CpuStrategy, string> = {
  greedy: '初級', disruptive: '中級', beam: '上級', random: 'ランダム', mcts: 'モンテカルロ',
}

function formatDate(ts: number): string {
  const d = new Date(ts)
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日\n${hh}時${mm}分`
}

function formatOpponents(o: PlaySummary['opponents']): string {
  if (o.count === 0) return 'なし'
  const counts = new Map<string, number>()
  for (const s of o.strategies) {
    const label = STRATEGY_LABEL[s]
    counts.set(label, (counts.get(label) ?? 0) + 1)
  }
  return [...counts.entries()].map(([label, n]) => n > 1 ? `${label}×${n}` : label).join('\n')
}

const seriesTab = ref<GameSeries | 'all'>('all')

interface Column {
  key: string
  label: string
  group: string
  sortable: boolean
  getValue?: (s: PlaySummary) => number
  render: (s: PlaySummary) => string
}

const columns: Column[] = [
  { key: 'date', label: '日時', group: '設定', sortable: true, getValue: s => s.date, render: s => formatDate(s.date) },
  { key: 'series', label: 'シリーズ', group: '設定', sortable: false, render: s => SERIES_LABEL[s.series] },
  { key: 'turnOrder', label: '手番', group: '設定', sortable: true, getValue: s => s.turnOrder, render: s => `${s.turnOrder}/${s.totalPlayers}` },
  { key: 'opponents', label: '対戦相手', group: '設定', sortable: false, render: s => formatOpponents(s.opponents) },

  { key: 'rank', label: '順位', group: '得点', sortable: true, getValue: s => s.rank, render: s => `${s.rank}/${s.totalPlayers}` },
  { key: 'total', label: '合計', group: '得点', sortable: true, getValue: s => s.total, render: s => `$${s.total}` },
  { key: 'money', label: '残金', group: '得点', sortable: true, getValue: s => s.money, render: s => `$${s.money}` },
  { key: 'unpaidPenalty', label: '未払い\n賃金', group: '得点', sortable: true, getValue: s => s.unpaidPenalty, render: s => s.unpaidPenalty ? `-${s.unpaidPenalty}` : '-' },
  { key: 'vpScore', label: '勝利点\n(点)', group: '得点', sortable: true, getValue: s => s.vpScore, render: s => s.vpScore ? `${s.vpScore}` : '-' },
  { key: 'buildingValue', label: '建物\n価値', group: '得点', sortable: true, getValue: s => s.buildingValue, render: s => `$${s.buildingValue}` },
  { key: 'bonuses', label: '建物\n効果', group: '得点', sortable: true, getValue: s => s.bonuses, render: s => `${s.bonuses}` },

  { key: 'actionsPlaced', label: '総手数', group: 'プレイ内容', sortable: true, getValue: s => s.actionsPlaced, render: s => `${s.actionsPlaced}` },
  { key: 'publicIncomeTotal', label: '露店等\n収入', group: 'プレイ内容', sortable: true, getValue: s => s.publicIncomeTotal, render: s => `$${s.publicIncomeTotal}` },
  { key: 'soldBuildingValueTotal', label: '売却建物\n価値', group: 'プレイ内容', sortable: true, getValue: s => s.soldBuildingValueTotal, render: s => `$${s.soldBuildingValueTotal}` },
  { key: 'drawnBuildingCount', label: '引いた\n建物', group: 'プレイ内容', sortable: true, getValue: s => s.drawnBuildingCount, render: s => `${s.drawnBuildingCount}枚` },
  { key: 'drawnConsumptionCount', label: '引いた\n消費財', group: 'プレイ内容', sortable: true, getValue: s => s.drawnConsumptionCount, render: s => `${s.drawnConsumptionCount}枚` },

  { key: 'topFacilities', label: 'よく使った\n施設', group: '盤面', sortable: false, render: () => '' },
  { key: 'finalBuildings', label: '最終盤面\nの建物', group: '盤面', sortable: false, render: () => '' },

  { key: 'delete', label: '削除', group: '操作', sortable: false, render: () => '' },
]

const headerGroups = computed(() => {
  const result: { name: string; span: number }[] = []
  for (const col of columns) {
    const last = result[result.length - 1]
    if (last && last.name === col.group) last.span++
    else result.push({ name: col.group, span: 1 })
  }
  return result
})

const sortKey = ref('date')
const sortDir = ref<'asc' | 'desc'>('desc')

function onHeaderClick(col: Column) {
  if (!col.sortable) return
  if (sortKey.value === col.key) {
    sortDir.value = sortDir.value === 'asc' ? 'desc' : 'asc'
  } else {
    sortKey.value = col.key
    sortDir.value = 'desc'
  }
}

const filtered = computed(() => seriesTab.value === 'all'
  ? records.value
  : records.value.filter(r => r.summary.series === seriesTab.value))

const sorted = computed(() => {
  const col = columns.find(c => c.key === sortKey.value)
  if (!col?.getValue) return filtered.value
  const dir = sortDir.value === 'asc' ? 1 : -1
  return [...filtered.value].sort((a, b) => (col.getValue!(a.summary) - col.getValue!(b.summary)) * dir)
})

const armedDeleteId = ref<string | null>(null)

function onDeleteClick(id: string) {
  if (armedDeleteId.value === id) {
    deletePlayRecord(id)
    records.value = records.value.filter(r => r.id !== id)
    armedDeleteId.value = null
  } else {
    armedDeleteId.value = id
  }
}
</script>

<template>
  <div class="history-overlay" @click.self="emit('close')">
    <div class="history-page">
      <div class="history-header">
        <div class="history-header-left">
          <button class="btn-restart" @click="emit('close')">← ゲームに戻る</button>
          <h2>プレイ履歴</h2>
        </div>
        <button class="modal-close-btn" @click="emit('close')">✕</button>
      </div>

      <div class="history-tabs">
        <button :class="{ active: seriesTab === 'all' }" @click="seriesTab = 'all'">すべて</button>
        <button :class="{ active: seriesTab === 'progress' }" @click="seriesTab = 'progress'">プログレス</button>
        <button :class="{ active: seriesTab === 'mecenat' }" @click="seriesTab = 'mecenat'">メセナ</button>
        <button :class="{ active: seriesTab === 'glory' }" @click="seriesTab = 'glory'">グローリー</button>
      </div>

      <p v-if="sorted.length === 0" class="history-empty">記録された対局はまだありません。</p>

      <div v-else class="history-table-wrap">
        <table class="history-table">
          <thead>
            <tr class="header-group-row">
              <th v-for="(g, i) in headerGroups" :key="i" :colspan="g.span">{{ g.name }}</th>
            </tr>
            <tr class="header-col-row">
              <th
                v-for="col in columns" :key="col.key"
                :class="{ sortable: col.sortable, sorted: sortKey === col.key }"
                @click="onHeaderClick(col)"
              >
                {{ col.label }}<span v-if="sortKey === col.key" class="sort-arrow">{{ sortDir === 'asc' ? '▲' : '▼' }}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="r in sorted" :key="r.id">
              <td v-for="col in columns" :key="col.key" class="pre-line" :class="{ 'col-center': col.key === 'delete' }">
                <template v-if="col.key === 'topFacilities'">
                  <span v-if="r.summary.topFacilities.length === 0">-</span>
                  <span v-else class="facility-chips">
                    <span
                      v-for="f in r.summary.topFacilities.slice(0, 5)" :key="f.name" class="facility-chip"
                      v-bind="tipOn(facilityTooltip(f.name))"
                    >{{ f.name }}×{{ f.count }}</span>
                  </span>
                </template>
                <template v-else-if="col.key === 'finalBuildings'">
                  <span v-if="r.summary.finalBuildings.length === 0">-</span>
                  <span v-else class="facility-chips">
                    <span
                      v-for="f in r.summary.finalBuildings" :key="f.name" class="facility-chip"
                      v-bind="tipOn(facilityTooltip(f.name))"
                    >{{ f.name }}×{{ f.count }}</span>
                  </span>
                </template>
                <template v-else-if="col.key === 'delete'">
                  <button class="history-delete-btn" :class="{ armed: armedDeleteId === r.id }" @click="onDeleteClick(r.id)">
                    {{ armedDeleteId === r.id ? '本当に削除？' : '🗑' }}
                  </button>
                </template>
                <template v-else>{{ col.render(r.summary) }}</template>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </div>
</template>

<style scoped>
.history-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.6);
  z-index: 200;
  display: flex;
}
.history-page {
  background: var(--panel-bg, #fff);
  color: var(--text-color, #222);
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  padding: 12px 16px;
  box-sizing: border-box;
}
.history-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
}
.history-header h2 { margin: 0; font-size: 1.2rem; white-space: nowrap; }
.history-header-left { display: flex; align-items: center; gap: 12px; flex-wrap: nowrap; }
.history-header-left .btn-restart { padding: 10px 14px; white-space: nowrap; }
.history-tabs { display: flex; gap: 6px; margin-bottom: 10px; flex-wrap: wrap; }
.history-tabs button {
  padding: 4px 12px;
  border-radius: 999px;
  border: 1px solid #999;
  background: transparent;
  cursor: pointer;
}
.history-tabs button.active { background: #444; color: #fff; border-color: #444; }
.history-empty { opacity: 0.7; }
.history-table-wrap { overflow: auto; flex: 1; }
.history-table { border-collapse: collapse; white-space: nowrap; font-size: 0.85rem; }
.history-table th, .history-table td {
  border: 1px solid #ccc;
  padding: 4px 8px;
  text-align: left;
}
.history-table th {
  white-space: pre-line;
  line-height: 1.3;
}
.header-col-row th {
  position: sticky;
  top: 0;
  background: var(--panel-bg, #fff);
  cursor: default;
  user-select: none;
}
.header-group-row th {
  text-align: center;
  font-size: 0.75rem;
  opacity: 0.75;
  background: var(--panel-bg-alt, rgba(128, 128, 128, 0.12));
}
.history-table th.sortable { cursor: pointer; }
.history-table th.sorted { color: #0a5; }
.sort-arrow { margin-left: 2px; font-size: 0.7em; }
.pre-line { white-space: pre-line; }
.col-center { text-align: center; }
.facility-chips { display: flex; flex-wrap: wrap; gap: 4px; }
.facility-chip {
  background: #eee;
  border-radius: 4px;
  padding: 1px 6px;
  font-size: 0.8em;
  white-space: nowrap;
}
.history-delete-btn {
  border: none;
  background: transparent;
  cursor: pointer;
  font-size: 1rem;
}
.history-delete-btn.armed {
  background: #c33;
  color: #fff;
  border-radius: 4px;
  padding: 2px 6px;
  font-size: 0.8rem;
  white-space: nowrap;
}
</style>
