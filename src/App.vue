<script setup lang="ts">
import { ref } from 'vue'
import { useGame } from './composables/useGame'

const {
  game, humanPlayer, currentPlayer, isHumanTurn, currentWage,
  availablePublicWorkplaces, availableOwnedBuildings,
  pendingAction, paymentSelected, buildableCards, scores, getBuildingDef,
  startGame, startDebugGame, clickPublicWorkplace, clickOwnedBuilding,
  clickBuildTarget, clickPaymentCard, clickCancelBuildChoice, clickCancelBuildPayment,
  clickCancelDoubleSecond, clickCancelDoublePayment,
  clickDiscardCard, confirmDiscardAction, clickCancelDiscardChoice,
  clickRevealedCard,
} = useGame()

const setupCpu = ref(1)

function begin() {
  startGame({ humanName: 'プレイヤー', cpuCount: setupCpu.value })
}

function cardLabel(card: { kind: string; name?: string }) {
  return card.kind === 'building' ? card.name! : '消費財'
}

function defStr(name: string) {
  const d = getBuildingDef(name)
  if (!d) return ''
  return `コスト${d.cost} / 資産$${d.assetValue}`
}

function workerNames(workerIds: string[]): string[] {
  if (!game.value) return []
  return workerIds.map(wid => {
    const p = game.value!.players.find(pl => pl.workers.some(w => w.id === wid))
    return p?.name ?? '?'
  })
}

function buildingWorkerName(workerHereId: string | null): string | null {
  if (!workerHereId || !game.value) return null
  const p = game.value.players.find(pl => pl.workers.some(w => w.id === workerHereId))
  return p?.name ?? null
}
</script>

<template>
  <!-- Setup screen -->
  <div v-if="!game" class="setup">
    <h1>ナショナルエコノミー</h1>
    <label>CPU数:
      <select v-model.number="setupCpu">
        <option :value="1">1</option>
        <option :value="2">2</option>
        <option :value="3">3</option>
      </select>
    </label><br/>
    <button @click="begin">ゲーム開始</button>
    <button class="debug-btn" @click="startDebugGame">デバッグスタート</button>
  </div>

  <!-- Game over screen -->
  <div v-else-if="game.phase === 'game-over'" class="gameover">
    <h1>ゲーム終了</h1>
    <table>
      <thead>
        <tr><th>プレイヤー</th><th>建物</th><th>残金</th><th>ボーナス</th><th>ペナルティ</th><th>合計</th></tr>
      </thead>
      <tbody>
        <tr v-for="sc in scores" :key="sc.playerId">
          <td>{{ game.players[sc.playerId].name }}</td>
          <td>${{ sc.buildingValue }}</td>
          <td>${{ sc.money }}</td>
          <td>+{{ sc.bonuses }}</td>
          <td>-{{ sc.unpaidPenalty }}</td>
          <td><strong>${{ sc.total }}</strong></td>
        </tr>
      </tbody>
    </table>
    <p>🏆 {{ game.players[scores!.reduce((a, b) => a.total > b.total ? a : b).playerId].name }} の勝利！</p>
    <button @click="startGame({ humanName: humanPlayer!.name, cpuCount: game!.players.filter(p => p.isCpu).length })">
      もう一度
    </button>
  </div>

  <!-- Game screen -->
  <div v-else class="game">
    <!-- Header -->
    <div class="header">
      <span>ラウンド {{ game.round }}/9</span>
      <span>賃金 ${{ currentWage }}</span>
      <span>家計 ${{ game.household }}</span>
      <span :class="{ myturn: isHumanTurn }">手番: {{ currentPlayer?.name }}</span>
    </div>

    <!-- Pending action panel -->
    <div v-if="pendingAction" class="pending-panel">
      <template v-if="pendingAction.kind === 'choose-build-target' || pendingAction.kind === 'choose-farm-build' || pendingAction.kind === 'choose-double-first'">
        <h3>
          {{ pendingAction.kind === 'choose-farm-build' ? '建設する農場を選んでください（無料）'
           : pendingAction.kind === 'choose-double-first' ? '1棟目を選んでください（同じコストの建物を2棟建設）'
           : '建設する建物を選んでください' }}
        </h3>
        <div class="card-row">
          <button
            v-for="card in buildableCards"
            :key="card.id"
            class="card selectable"
            @click="clickBuildTarget(card.id)"
          >
            {{ card.name }}<br/><small>{{ defStr(card.name) }}</small>
          </button>
        </div>
        <p v-if="buildableCards.length === 0" class="no-options">建設できる建物がありません</p>
        <button class="back-btn" @click="clickCancelBuildChoice">✕ キャンセル</button>
      </template>

      <template v-else-if="pendingAction.kind === 'choose-double-second'">
        <h3>2棟目を選んでください（コスト{{ pendingAction.firstCost }}の別の建物）</h3>
        <div class="card-row">
          <button
            v-for="card in humanPlayer!.hand.filter(c => c.kind === 'building' && getBuildingDef(c.name!)?.cost === (pendingAction as any).firstCost && c.id !== (pendingAction as any).firstId)"
            :key="card.id"
            class="card selectable"
            @click="clickBuildTarget(card.id)"
          >
            {{ card.kind === 'building' ? card.name : '' }}<br/><small>{{ card.kind === 'building' ? defStr(card.name!) : '' }}</small>
          </button>
        </div>
        <button class="back-btn" @click="clickCancelDoubleSecond">← 戻る</button>
      </template>

      <template v-else-if="pendingAction.kind === 'choose-build-payment' || pendingAction.kind === 'choose-double-payment'">
        <h3>支払い用カードを{{ (pendingAction as any).cost }}枚選んでください ({{ paymentSelected.length }}/{{ (pendingAction as any).cost }})</h3>
        <div class="card-row">
          <button
            v-for="card in humanPlayer!.hand.filter(c => c.id !== (pendingAction as any).targetId && c.id !== (pendingAction as any).firstId && c.id !== (pendingAction as any).secondId)"
            :key="card.id"
            :class="['card', 'selectable', { selected: paymentSelected.includes(card.id) }]"
            @click="clickPaymentCard(card.id)"
          >
            {{ cardLabel(card) }}
          </button>
        </div>
        <button class="back-btn" @click="pendingAction.kind === 'choose-build-payment' ? clickCancelBuildPayment() : clickCancelDoublePayment()">← 戻る</button>
      </template>

      <template v-else-if="pendingAction.kind === 'choose-discard'">
        <h3>カードを{{ pendingAction.count }}枚捨ててください ({{ pendingAction.selected.length }}/{{ pendingAction.count }})</h3>
        <div class="card-row">
          <button
            v-for="card in humanPlayer!.hand"
            :key="card.id"
            :class="['card', 'selectable', { selected: pendingAction.selected.includes(card.id) }]"
            @click="clickDiscardCard(card.id)"
          >
            {{ cardLabel(card) }}
          </button>
        </div>
        <button
          v-if="pendingAction.selected.length === pendingAction.count"
          class="confirm-btn"
          @click="confirmDiscardAction"
        >確定</button>
        <button class="back-btn" @click="clickCancelDiscardChoice">✕ キャンセル</button>
      </template>

      <template v-else-if="pendingAction.kind === 'choose-from-revealed'">
        <h3>1枚選んでください（残りは捨て札）</h3>
        <div class="card-row">
          <button
            v-for="card in pendingAction.revealed"
            :key="card.id"
            class="card selectable"
            @click="clickRevealedCard(card.id)"
          >
            {{ cardLabel(card) }}
          </button>
        </div>
      </template>
    </div>

    <div class="main">
      <!-- Public workplaces -->
      <section class="section workplaces">
        <h2>公共職場</h2>
        <div class="card-row">
          <div
            v-for="wp in game.publicWorkplaces"
            :key="wp.id"
            :class="['workplace', { available: !pendingAction && isHumanTurn && availablePublicWorkplaces.some(w => w.id === wp.id) }]"
            @click="!pendingAction && isHumanTurn && availablePublicWorkplaces.some(w => w.id === wp.id) && clickPublicWorkplace(wp.id)"
          >
            <div class="wp-name">{{ wp.name }}</div>
            <div class="wp-labels">
              <span
                v-for="(name, i) in workerNames(wp.workerIds)"
                :key="i"
                :class="['wp-label', { faded: wp.allowMultiple }]"
              >{{ name }}</span>
            </div>
          </div>
        </div>
      </section>

      <!-- Human player -->
      <section class="section player-area">
        <h2>{{ humanPlayer?.name }} — ${{ humanPlayer?.money }} | 未払い {{ humanPlayer?.unpaidWages }}枚</h2>

        <div class="subsection">
          <h3>手札 ({{ humanPlayer?.hand.length }}枚)</h3>
          <div class="card-row">
            <div v-for="card in humanPlayer?.hand" :key="card.id" class="card">
              <div>{{ cardLabel(card) }}</div>
              <div v-if="card.kind === 'building'" class="card-meta">{{ defStr(card.name!) }}</div>
            </div>
          </div>
        </div>

        <div class="subsection">
          <h3>建設済み ({{ humanPlayer?.ownedBuildings.length }}棟)</h3>
          <div class="card-row">
            <div
              v-for="b in humanPlayer?.ownedBuildings"
              :key="b.id"
              :class="['building', { available: !pendingAction && isHumanTurn && availableOwnedBuildings.some(x => x.id === b.id) }]"
              @click="!pendingAction && isHumanTurn && availableOwnedBuildings.some(x => x.id === b.id) && clickOwnedBuilding(b.id)"
            >
              <div>{{ b.name }}</div>
              <div class="card-meta">資産 ${{ getBuildingDef(b.name)?.assetValue }}</div>
              <span v-if="buildingWorkerName(b.workerHereId)" class="wp-label">{{ buildingWorkerName(b.workerHereId) }}</span>
            </div>
          </div>
        </div>

        <div class="subsection">
          <h3>労働者</h3>
          <div class="worker-row">
            <span v-for="w in humanPlayer?.workers" :key="w.id"
              :class="['worker', { training: w.isTraining, placed: !!w.placedAt }]"
            >{{ w.isTraining ? '📚' : w.placedAt ? '🔨' : '🧍' }}</span>
          </div>
        </div>
      </section>

      <!-- CPU players -->
      <section class="section cpu-area">
        <h2>CPU</h2>
        <div v-for="p in game.players.filter(p => p.isCpu)" :key="p.id" class="cpu-player">
          <div><strong>{{ p.name }}</strong></div>
          <div>${{ p.money }} | 未払い{{ p.unpaidWages }}枚</div>
          <div>手札{{ p.hand.length }}枚 | 建物{{ p.ownedBuildings.length }}棟</div>
          <div>
            <span v-for="w in p.workers" :key="w.id">
              {{ w.isTraining ? '📚' : w.placedAt ? '🔨' : '🧍' }}
            </span>
          </div>
        </div>
      </section>
    </div>

    <!-- Log -->
    <section class="log">
      <div class="log-inner">
        <div v-for="(msg, i) in [...game.log].reverse().slice(0, 40)" :key="i" class="log-line">{{ msg }}</div>
      </div>
    </section>
  </div>
</template>

<style scoped>
* { box-sizing: border-box; }

.setup { max-width: 360px; margin: 80px auto; text-align: center; }
.setup h1 { margin-bottom: 24px; }
.setup label { display: block; margin: 12px 0; text-align: left; }
.setup input, .setup select { margin-left: 8px; background: #2a2a3e; color: #eee; border: 1px solid #555; border-radius: 4px; padding: 4px 8px; }
.setup button { margin-top: 20px; padding: 10px 32px; font-size: 16px; background: #4fc3f7; border: none; border-radius: 6px; cursor: pointer; font-weight: bold; color: #111; }
.setup .debug-btn { display: block; margin: 10px auto 0; background: #374151; color: #9ca3af; font-size: 13px; padding: 6px 20px; }

.gameover { max-width: 680px; margin: 60px auto; text-align: center; }
.gameover table { width: 100%; border-collapse: collapse; margin: 20px 0; }
.gameover th, .gameover td { padding: 8px 12px; border: 1px solid #444; }
.gameover th { background: #1a1a2e; }

.game { display: flex; flex-direction: column; height: 100vh; background: #0d0d1a; color: #ddd; font-size: 13px; }

.header { display: flex; gap: 20px; padding: 8px 16px; background: #1a1a2e; border-bottom: 1px solid #333; font-weight: bold; align-items: center; }
.myturn { color: #4fc3f7; }

.pending-panel { background: #1e1a00; border-bottom: 2px solid #f59e0b; padding: 10px 16px; }
.pending-panel h3 { margin: 0 0 8px; color: #f59e0b; font-size: 13px; }

.main { display: flex; gap: 10px; padding: 10px; flex: 1; overflow: hidden; }

.section { background: #111827; border-radius: 8px; padding: 10px; }
.workplaces { flex: 0 0 auto; min-width: 140px; }
.player-area { flex: 1; overflow-y: auto; }
.cpu-area { flex: 0 0 180px; overflow-y: auto; }

.log { height: 120px; background: #0a0a14; border-top: 1px solid #222; padding: 6px 12px; overflow-y: auto; }
.log-line { font-size: 11px; color: #888; padding: 1px 0; }

h2 { font-size: 13px; margin: 0 0 8px; color: #9ca3af; }
h3 { font-size: 12px; margin: 8px 0 4px; color: #6b7280; }
.subsection { margin-bottom: 10px; }

.card-row { display: flex; flex-wrap: wrap; gap: 5px; }

.card, .workplace, .building {
  background: #1f2937; border: 1px solid #374151; border-radius: 5px;
  padding: 6px 8px; min-width: 72px; max-width: 120px;
}
.card-meta { font-size: 10px; color: #6b7280; }

.workplace { min-width: 80px; text-align: center; cursor: default; }
.wp-name { font-weight: 600; font-size: 12px; }
.wp-labels { display: flex; flex-wrap: wrap; gap: 2px; margin-top: 3px; justify-content: center; }
.wp-label { font-size: 10px; background: #374151; color: #d1d5db; border-radius: 3px; padding: 1px 5px; display: inline-block; }
.wp-label.faded { opacity: 0.45; }

.available { border-color: #3b82f6 !important; background: #172554 !important; cursor: pointer !important; }
.available:hover { background: #1e3a8a !important; }

.selectable { cursor: pointer; border: 1px solid #374151; }
.selectable:hover { border-color: #f59e0b; }
.selected { border-color: #f59e0b !important; background: #292007 !important; }

.confirm-btn { margin-top: 8px; padding: 5px 14px; background: #3b82f6; border: none; border-radius: 4px; cursor: pointer; color: #fff; font-weight: bold; font-size: 13px; }
.back-btn { margin-top: 8px; padding: 4px 12px; background: transparent; border: 1px solid #555; border-radius: 4px; cursor: pointer; color: #aaa; font-size: 12px; }
.back-btn:hover { border-color: #aaa; color: #eee; }
.no-options { font-size: 11px; color: #ef4444; margin: 4px 0 0; }

.worker-row { display: flex; gap: 4px; font-size: 18px; flex-wrap: wrap; }
.worker.training { opacity: 0.45; }
.worker.placed { opacity: 0.6; }

.cpu-player { margin-bottom: 10px; padding: 8px; background: #1f2937; border-radius: 6px; line-height: 1.6; }
.cpu-player strong { color: #c4b5fd; }

button { background: #1f2937; border: 1px solid #374151; color: #ddd; border-radius: 4px; padding: 4px 8px; font-size: 12px; }
</style>
